import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** ms até a janela reiniciar. */
  resetMs: number;
}

/** Janela fixa por chave (tenant × rota). */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

const result = (count: number, limit: number, resetMs: number): RateLimitResult => ({
  allowed: count <= limit,
  limit,
  remaining: Math.max(0, limit - count),
  resetMs: Math.max(0, resetMs),
});

/** Contadores no Valkey/Redis: compartilhados entre instâncias da API. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const k = `${this.prefix}rl:${key}`;
    const res = await this.redis.multi().set(k, 0, 'PX', windowMs, 'NX').incr(k).pttl(k).exec();
    if (!res) throw new Error('transação do rate limit abortada');
    const count = Number(res[1]?.[1] ?? 0);
    const ttl = Number(res[2]?.[1] ?? windowMs);
    return result(count, limit, ttl < 0 ? windowMs : ttl);
  }
}

/** Implementação em memória (testes e desenvolvimento sem Valkey; não compartilha entre instâncias). */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      // limite de memória: chaves aleatórias (IPs, prefixos) não acumulam janelas vencidas sem fim
      if (this.windows.size >= 50_000) {
        for (const [k, v] of this.windows) if (v.resetAt <= t) this.windows.delete(k);
        if (this.windows.size >= 50_000) this.windows.clear();
      }
      w = { count: 0, resetAt: t + windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return result(w.count, limit, w.resetAt - t);
  }
}
