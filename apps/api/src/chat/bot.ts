/**
 * Detecção de robô no Chat ao vivo (#1290). O anti-flood (#1287) segura enxurrada e repetição por pessoa; aqui ficam
 * os sinais de máquina e de rede de contas, pela decisão do Wagner (18/11):
 *
 * - **Ritmo de máquina** (caso claro): as últimas `CADENCE_SAMPLES` mensagens da pessoa com intervalos quase iguais
 *   (variação abaixo de `CADENCE_MAX_CV`) e curtos (até `CADENCE_MAX_GAP_MS`). Trava o envio por `BOT_BLOCK_MS` em
 *   todas as salas do cliente e abre caso na fila humana. Quem verificou a idade com documento (`verified`, #1109)
 *   não é travado: só vai para a fila.
 * - **Vários Perfis da mesma Conta na mesma sala** (dúvida): `ACCOUNT_PROFILES` ou mais em `SIGNAL_WINDOW_MS`.
 * - **O mesmo link por Perfis diferentes** (dúvida): `LINK_PROFILES` ou mais Perfis com o mesmo domínio liberado em
 *   `SIGNAL_WINDOW_MS` (link fora da lista o filtro já barra).
 *
 * Dúvida publica e marca `suspect`: vai para a Cosmos e a fila, e uma pessoa decide. Torcida organizada cantando o
 * mesmo grito não é sinal: texto igual entre Perfis diferentes não conta.
 */
import type { Redis } from 'ioredis';

export const CADENCE_SAMPLES = 8;
export const CADENCE_MAX_CV = 0.08;
export const CADENCE_MAX_GAP_MS = 20_000;
export const BOT_BLOCK_MS = 30 * 60_000;
export const SIGNAL_WINDOW_MS = 10 * 60_000;
export const ACCOUNT_PROFILES = 3;
export const LINK_PROFILES = 3;
/** Pessoas e chaves acompanhadas na versão em memória antes de uma faxina. */
const MEMORY_SWEEP_AT = 20_000;

export type BotSignal = 'bot_cadence' | 'bot_shared_account' | 'bot_shared_link';

export interface BotInput {
  tenantId: string;
  roomId: string;
  profileId: string;
  accountId: string;
  /** Domínios dos links da mensagem (já normalizados). */
  hosts: readonly string[];
  /** Verificou a idade com documento: nunca travado, só sinalizado. */
  verified: boolean;
  now: number;
}

export interface BotVerdict {
  /** Já está travado: em quantos ms volta (0 = livre). */
  blockedMs: number;
  /** Travou agora (abrir caso na fila). */
  blockedNow: boolean;
  signals: BotSignal[];
}

export interface BotGuard {
  check(input: BotInput): Promise<BotVerdict>;
}

/** Ritmo de máquina: intervalos curtos e quase iguais. */
export function machineCadence(times: readonly number[]): boolean {
  if (times.length < CADENCE_SAMPLES) return false;
  const sorted = [...times].sort((a, b) => a - b).slice(-CADENCE_SAMPLES);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]!);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean <= 0 || mean > CADENCE_MAX_GAP_MS) return false;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  return sd / mean < CADENCE_MAX_CV;
}

function verdict(
  input: BotInput,
  times: number[],
  accountProfiles: number,
  linkProfiles: number[],
): BotVerdict {
  const signals: BotSignal[] = [];
  const cadence = machineCadence(times);
  if (cadence) signals.push('bot_cadence');
  if (accountProfiles >= ACCOUNT_PROFILES) signals.push('bot_shared_account');
  if (linkProfiles.some((n) => n >= LINK_PROFILES)) signals.push('bot_shared_link');
  const blockedNow = cadence && !input.verified;
  return { blockedMs: blockedNow ? BOT_BLOCK_MS : 0, blockedNow, signals };
}

// KEYS: bloqueio, tempos, perfis da conta na sala, perfis de cada domínio…
// ARGV: agora, amostras, janela, perfil, bloqueio ms (só lê o bloqueio quando já existe)
const CHECK_SCRIPT = `
local left = redis.call('PTTL', KEYS[1])
if left > 0 then return {left} end
redis.call('LPUSH', KEYS[2], ARGV[1])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[2]) - 1)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[3]))
local out = {0, redis.call('LRANGE', KEYS[2], 0, -1)}
for i = 3, #KEYS do
  redis.call('SADD', KEYS[i], ARGV[4])
  redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[3]))
  out[#out + 1] = redis.call('SCARD', KEYS[i])
end
return out`;

export class RedisBotGuard implements BotGuard {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  async check(input: BotInput): Promise<BotVerdict> {
    const base = `${this.prefix}chat:bot:${input.tenantId}`;
    const who = `${base}:p:${input.profileId}`;
    const hosts = [...new Set(input.hosts)].slice(0, 5);
    const res = (await this.redis.eval(
      CHECK_SCRIPT,
      3 + hosts.length,
      `${who}:block`,
      `${who}:t`,
      `${base}:a:${input.roomId}:${input.accountId}`,
      ...hosts.map((h) => `${base}:l:${h}`),
      input.now,
      CADENCE_SAMPLES,
      SIGNAL_WINDOW_MS,
      input.profileId,
    )) as [number, string[]?, ...number[]];
    if (Number(res[0]) > 0) return { blockedMs: Number(res[0]), blockedNow: false, signals: [] };
    const times = (res[1] ?? []).map(Number);
    const [accountProfiles = 0, ...links] = res.slice(2).map(Number);
    const v = verdict(input, times, accountProfiles, links);
    if (v.blockedNow) {
      await this.redis.set(`${who}:block`, '1', 'PX', BOT_BLOCK_MS);
      await this.redis.del(`${who}:t`);
    }
    return v;
  }
}

/** O mesmo desenho em memória, local à instância (desenvolvimento e testes). */
export class MemoryBotGuard implements BotGuard {
  private readonly blocks = new Map<string, number>();
  private readonly times = new Map<string, number[]>();
  private readonly sets = new Map<string, Map<string, number>>();

  async check(input: BotInput): Promise<BotVerdict> {
    const { now } = input;
    if (this.times.size + this.sets.size > MEMORY_SWEEP_AT) this.sweep(now);
    const who = `${input.tenantId}:${input.profileId}`;
    const until = this.blocks.get(who) ?? 0;
    if (until > now) return { blockedMs: until - now, blockedNow: false, signals: [] };
    this.blocks.delete(who);
    const times = [now, ...(this.times.get(who) ?? []).filter((t) => now - t < SIGNAL_WINDOW_MS)].slice(
      0,
      CADENCE_SAMPLES,
    );
    this.times.set(who, times);
    const count = (key: string) => {
      const set = this.sets.get(key) ?? new Map<string, number>();
      for (const [p, at] of set) if (now - at >= SIGNAL_WINDOW_MS) set.delete(p);
      set.set(input.profileId, now);
      this.sets.set(key, set);
      return set.size;
    };
    const accountProfiles = count(`${input.tenantId}:a:${input.roomId}:${input.accountId}`);
    const links = [...new Set(input.hosts)].slice(0, 5).map((h) => count(`${input.tenantId}:l:${h}`));
    const v = verdict(input, times, accountProfiles, links);
    if (v.blockedNow) {
      this.blocks.set(who, now + BOT_BLOCK_MS);
      this.times.delete(who);
    }
    return v;
  }

  private sweep(now: number): void {
    for (const [k, until] of this.blocks) if (until <= now) this.blocks.delete(k);
    for (const [k, list] of this.times)
      if (!list.some((t) => now - t < SIGNAL_WINDOW_MS)) this.times.delete(k);
    for (const [k, set] of this.sets)
      if (![...set.values()].some((t) => now - t < SIGNAL_WINDOW_MS)) this.sets.delete(k);
  }
}
