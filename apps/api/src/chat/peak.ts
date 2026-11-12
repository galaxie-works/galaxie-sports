/**
 * Pico do Chat ao vivo (D6 do #1017, #964): cada cliente tem uma faixa de conexões simultâneas
 * (`live_chat.peak_connections`, #1018). Acima dela ninguém fica sem ler: a conexão entra, mas a sala vira só
 * leitura para quem chega depois, com aviso no painel.
 *
 * - **Conexões**: o mesmo lease por conexão do `/v1/stream` (`ConnectionLimiter`), num espaço próprio do chat.
 * - **Pico**: conexão recusada pela faixa marca o cliente em pico (`<prefixo>chat:peak:<tenant>`, 90 s, renovado
 *   pelo heartbeat de cada conexão excedente). Some sozinho quando elas fecham.
 * - **Lugar**: quem enviou mensagem há pouco (10 min) tem lugar (`chat:seat:<tenant>`, score = validade). Em pico,
 *   só quem tem lugar continua escrevendo; quem chegou depois lê.
 */
import type { Redis } from 'ioredis';
import {
  MemoryConnectionLimiter,
  RedisConnectionLimiter,
  type ConnectionLimiter,
} from '../realtime/connection-limiter.js';

export const PEAK_FLAG_MS = 90_000;
export const SEAT_MS = 10 * 60_000;

export interface ChatPeak {
  readonly connections: ConnectionLimiter;
  markPeak(tenantId: string): Promise<void>;
  inPeak(tenantId: string): Promise<boolean>;
  /** Guarda (ou renova) o lugar do torcedor. */
  seat(tenantId: string, profileId: string): Promise<void>;
  hasSeat(tenantId: string, profileId: string): Promise<boolean>;
}

export class RedisChatPeak implements ChatPeak {
  readonly connections: ConnectionLimiter;
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
    private readonly now: () => number = Date.now,
  ) {
    this.connections = new RedisConnectionLimiter(redis, `${prefix}chat:`, 60_000, now);
  }
  async markPeak(tenantId: string): Promise<void> {
    await this.redis.set(`${this.prefix}chat:peak:${tenantId}`, String(this.now()), 'PX', PEAK_FLAG_MS);
  }
  async inPeak(tenantId: string): Promise<boolean> {
    return (await this.redis.exists(`${this.prefix}chat:peak:${tenantId}`)) === 1;
  }
  async seat(tenantId: string, profileId: string): Promise<void> {
    const k = `${this.prefix}chat:seat:${tenantId}`;
    const t = this.now();
    await this.redis
      .multi()
      .zadd(k, t + SEAT_MS, profileId)
      .zremrangebyscore(k, '-inf', t)
      .pexpire(k, SEAT_MS * 2)
      .exec();
  }
  async hasSeat(tenantId: string, profileId: string): Promise<boolean> {
    const score = await this.redis.zscore(`${this.prefix}chat:seat:${tenantId}`, profileId);
    return score !== null && Number(score) > this.now();
  }
}

export class MemoryChatPeak implements ChatPeak {
  readonly connections = new MemoryConnectionLimiter();
  private readonly peaks = new Map<string, number>();
  private readonly seats = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async markPeak(tenantId: string): Promise<void> {
    this.peaks.set(tenantId, this.now() + PEAK_FLAG_MS);
  }
  async inPeak(tenantId: string): Promise<boolean> {
    return (this.peaks.get(tenantId) ?? 0) > this.now();
  }
  async seat(tenantId: string, profileId: string): Promise<void> {
    if (this.seats.size > 100_000) this.seats.clear();
    this.seats.set(`${tenantId}:${profileId}`, this.now() + SEAT_MS);
  }
  async hasSeat(tenantId: string, profileId: string): Promise<boolean> {
    return (this.seats.get(`${tenantId}:${profileId}`) ?? 0) > this.now();
  }
}
