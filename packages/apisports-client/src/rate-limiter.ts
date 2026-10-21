export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Token bucket por chave (uma por API/esporte). Respeita o limite por minuto do plano —
 * estourá-lo pode levar a bloqueio pelo firewall do fornecedor.
 * As chamadas são serializadas por chave para que a ordem de espera seja justa.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number; queue: Promise<void> }>();

  constructor(
    private perMinute: number,
    private readonly clock: Clock = systemClock,
  ) {}

  setPerMinute(perMinute: number): void {
    this.perMinute = perMinute;
  }

  take(key: string): Promise<void> {
    const bucket = this.buckets.get(key) ?? {
      tokens: this.perMinute,
      updatedAt: this.clock.now(),
      queue: Promise.resolve(),
    };
    this.buckets.set(key, bucket);
    const next = bucket.queue.then(() => this.acquire(bucket));
    bucket.queue = next.catch(() => {});
    return next;
  }

  private async acquire(bucket: { tokens: number; updatedAt: number }): Promise<void> {
    const ratePerMs = this.perMinute / 60_000;
    for (;;) {
      const now = this.clock.now();
      bucket.tokens = Math.min(this.perMinute, bucket.tokens + (now - bucket.updatedAt) * ratePerMs);
      bucket.updatedAt = now;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }
      await this.clock.sleep(Math.ceil((1 - bucket.tokens) / ratePerMs));
    }
  }
}
