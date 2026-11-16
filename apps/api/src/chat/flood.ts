/**
 * Anti-flood do Chat ao vivo, por pessoa e por cliente (no lugar do modo escudo: torcida organizada faz parte do
 * jogo, o que se evita é a enxurrada). Quem passa de `maxPerMinute` mensagens em 60 s, ou manda o mesmo texto
 * `DUPLICATE_LIMIT` vezes em 60 s (robô e copia-e-cola), fica `blockSeconds` sem enviar. Vale em todas as salas do
 * cliente: trocar de sala não zera o contador.
 *
 * Com Valkey, um script faz a conta e o bloqueio de forma atômica entre instâncias; sem Valkey, o mesmo em memória.
 */
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

export const FLOOD_WINDOW_MS = 60_000;
export const DUPLICATE_LIMIT = 3;

export interface FloodRule {
  maxPerMinute: number;
  blockSeconds: number;
}

export interface FloodGuard {
  /** Conta a mensagem; devolve em quantos ms o envio volta (0 = pode enviar). */
  hit(tenantId: string, profileId: string, text: string, rule: FloodRule, now: number): Promise<number>;
}

/** Texto comparável: sem caixa, sem espaços repetidos (a mesma mensagem com outro espaço é a mesma). */
export const floodFingerprint = (text: string): string =>
  createHash('sha1').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('base64url').slice(0, 16);

// KEYS: bloqueio, contador, repetição. ARGV: limite, janela ms, bloqueio ms, limite de repetição
const HIT_SCRIPT = `
local left = redis.call('PTTL', KEYS[1])
if left > 0 then return left end
local n = redis.call('INCR', KEYS[2])
if n == 1 then redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[2])) end
local d = redis.call('INCR', KEYS[3])
if d == 1 then redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[2])) end
if n > tonumber(ARGV[1]) or d >= tonumber(ARGV[4]) then
  redis.call('SET', KEYS[1], '1', 'PX', tonumber(ARGV[3]))
  redis.call('DEL', KEYS[2], KEYS[3])
  return tonumber(ARGV[3])
end
return 0`;

export class RedisFloodGuard implements FloodGuard {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  async hit(tenantId: string, profileId: string, text: string, rule: FloodRule): Promise<number> {
    const who = `${this.prefix}chat:flood:${tenantId}:${profileId}`;
    const left = await this.redis.eval(
      HIT_SCRIPT,
      3,
      `${who}:block`,
      `${who}:n`,
      `${who}:d:${floodFingerprint(text)}`,
      rule.maxPerMinute,
      FLOOD_WINDOW_MS,
      rule.blockSeconds * 1000,
      DUPLICATE_LIMIT,
    );
    return Number(left) || 0;
  }
}

/** O mesmo desenho em memória, local à instância (desenvolvimento e testes). */
export class MemoryFloodGuard implements FloodGuard {
  private readonly blocks = new Map<string, number>();
  private readonly sent = new Map<string, Array<{ at: number; print: string }>>();

  async hit(
    tenantId: string,
    profileId: string,
    text: string,
    rule: FloodRule,
    now: number,
  ): Promise<number> {
    const who = `${tenantId}:${profileId}`;
    const until = this.blocks.get(who) ?? 0;
    if (until > now) return until - now;
    this.blocks.delete(who);
    const print = floodFingerprint(text);
    const recent = (this.sent.get(who) ?? []).filter((m) => now - m.at < FLOOD_WINDOW_MS);
    recent.push({ at: now, print });
    const same = recent.filter((m) => m.print === print).length;
    if (recent.length > rule.maxPerMinute || same >= DUPLICATE_LIMIT) {
      this.blocks.set(who, now + rule.blockSeconds * 1000);
      this.sent.delete(who);
      return rule.blockSeconds * 1000;
    }
    this.sent.set(who, recent);
    return 0;
  }
}
