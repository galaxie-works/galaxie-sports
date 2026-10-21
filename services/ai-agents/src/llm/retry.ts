import { LlmError } from './errors.js';

export interface RetryOptions {
  /** Tentativas extras (além da primeira). */
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injetável nos testes. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (err: LlmError, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Executa `fn` com backoff exponencial com jitter ("full jitter") enquanto o erro for retentável
 * (LlmError.retryable: 429, 5xx, timeout, conexão, saída fora do schema).
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const base = options.baseDelayMs ?? 1_000;
  const max = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const retryable = err instanceof LlmError && err.retryable;
      if (!retryable || attempt >= options.retries) throw err;
      const delay = Math.round(random() * Math.min(max, base * 2 ** attempt));
      options.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
