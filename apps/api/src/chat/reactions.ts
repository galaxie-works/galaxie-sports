/**
 * Contador de reações do Chat ao vivo (#967). A reação não vira mensagem: soma num contador da sala no Valkey e sai
 * agregada no lote de 1 s (o que entrou no segundo e o total do jogo). Custo previsível: mil reações por segundo numa
 * sala viram um evento por segundo por tela.
 *
 * Com Valkey (várias instâncias):
 *
 * - `add`: um script faz o limite por pessoa (`chat:rr:<sala>:<perfil>`, janela de 1 s) e soma no delta do segundo
 *   (`chat:rd:<sala>`) e no total do jogo (`chat:rt:<sala>`, 24 h), marcando a sala como pendente;
 * - `flush`: toda instância roda o relógio; o script tira o delta inteiro da sala de forma atômica, então duas
 *   instâncias no mesmo segundo nunca contam a mesma reação duas vezes (a segunda acha o delta vazio).
 *
 * Sem Valkey, o mesmo desenho em memória, local à instância.
 */
import type { Redis } from 'ioredis';
import { REACTIONS_PER_SECOND, type ChatReaction, type ReactionTally } from '@galaxie/engage';

export interface ReactionFlush {
  room: string;
  tally: ReactionTally;
}

export interface ReactionCounter {
  /** Soma a reação; `false` quando a pessoa passou do limite por segundo (a reação é descartada). */
  add(room: string, profileId: string, reaction: ChatReaction): Promise<boolean>;
  /** Fecha o segundo de todas as salas com reação pendente. */
  flush(): Promise<ReactionFlush[]>;
  /** Total do jogo até agora (para quem entra na sala). */
  totals(room: string): Promise<ReactionTally['total']>;
}

const TOTAL_TTL_MS = 24 * 3600_000;

// KEYS: limite da pessoa, delta, total, salas pendentes. ARGV: reação, limite, ttl do total, sala
const ADD_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], 1000) end
if n > tonumber(ARGV[2]) then return 0 end
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('PEXPIRE', KEYS[2], 60000)
redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[3]))
redis.call('SADD', KEYS[4], ARGV[4])
return 1`;

// KEYS: delta, total, salas pendentes. ARGV: sala
const TAKE_SCRIPT = `
local delta = redis.call('HGETALL', KEYS[1])
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[3], ARGV[1])
if #delta == 0 then return {} end
return {delta, redis.call('HGETALL', KEYS[2])}`;

const toRecord = (flat: string[]): Partial<Record<ChatReaction, number>> => {
  const out: Partial<Record<ChatReaction, number>> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i] as ChatReaction] = Number(flat[i + 1]);
  return out;
};

export class RedisReactionCounter implements ReactionCounter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
    private readonly perSecond = REACTIONS_PER_SECOND,
  ) {}

  private k(name: string, room?: string, who?: string): string {
    return [`${this.prefix}chat:${name}`, room, who].filter(Boolean).join(':');
  }

  async add(room: string, profileId: string, reaction: ChatReaction): Promise<boolean> {
    const ok = await this.redis.eval(
      ADD_SCRIPT,
      4,
      this.k('rr', room, profileId),
      this.k('rd', room),
      this.k('rt', room),
      this.k('rd:rooms'),
      reaction,
      this.perSecond,
      TOTAL_TTL_MS,
      room,
    );
    return ok === 1;
  }

  async flush(): Promise<ReactionFlush[]> {
    const rooms = await this.redis.smembers(this.k('rd:rooms'));
    const out: ReactionFlush[] = [];
    for (const room of rooms) {
      const r = (await this.redis.eval(
        TAKE_SCRIPT,
        3,
        this.k('rd', room),
        this.k('rt', room),
        this.k('rd:rooms'),
        room,
      )) as [string[], string[]] | [];
      if (r.length) out.push({ room, tally: { delta: toRecord(r[0]), total: toRecord(r[1]) } });
    }
    return out;
  }

  async totals(room: string): Promise<ReactionTally['total']> {
    return toRecord(await this.redis.hgetall(this.k('rt', room)).then((h) => Object.entries(h).flat()));
  }
}

export class MemoryReactionCounter implements ReactionCounter {
  private readonly delta = new Map<string, Partial<Record<ChatReaction, number>>>();
  private readonly total = new Map<string, Partial<Record<ChatReaction, number>>>();
  private readonly rate = new Map<string, { at: number; n: number }>();

  constructor(
    private readonly perSecond = REACTIONS_PER_SECOND,
    private readonly now: () => number = Date.now,
  ) {}

  async add(room: string, profileId: string, reaction: ChatReaction): Promise<boolean> {
    const key = `${room}:${profileId}`;
    const t = this.now();
    const r = this.rate.get(key);
    const cur = r && t - r.at < 1000 ? r : { at: t, n: 0 };
    cur.n += 1;
    if (this.rate.size > 100_000) this.rate.clear();
    this.rate.set(key, cur);
    if (cur.n > this.perSecond) return false;
    for (const map of [this.delta, this.total]) {
      const m = map.get(room) ?? {};
      m[reaction] = (m[reaction] ?? 0) + 1;
      map.set(room, m);
    }
    return true;
  }

  async flush(): Promise<ReactionFlush[]> {
    const out: ReactionFlush[] = [];
    for (const [room, delta] of this.delta)
      out.push({ room, tally: { delta, total: { ...(this.total.get(room) ?? {}) } } });
    this.delta.clear();
    return out;
  }

  async totals(room: string): Promise<ReactionTally['total']> {
    return { ...(this.total.get(room) ?? {}) };
  }
}
