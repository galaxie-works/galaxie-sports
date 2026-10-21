export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Espaçamento por chave (uma por API/esporte): no máximo 1 chamada a cada 60/perMinute segundos
 * (6 s no free). Sem rajada inicial — um cliente novo não pode disparar o minuto inteiro de uma vez,
 * o que estouraria o limite e pode levar a bloqueio pelo firewall do fornecedor.
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
      tokens: 1,
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
      bucket.tokens = Math.min(1, bucket.tokens + (now - bucket.updatedAt) * ratePerMs);
      bucket.updatedAt = now;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }
      await this.clock.sleep(Math.ceil((1 - bucket.tokens) / ratePerMs));
    }
  }
}
