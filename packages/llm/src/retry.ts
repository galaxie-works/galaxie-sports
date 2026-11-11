import { LlmError } from './errors.js';

export interface RetryOptions {
  /** Tentativas extras (além da primeira). */
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injetável nos testes. Recebe o sinal de quem chamou: a espera termina quando ele cancela. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  onRetry?: (err: LlmError, attempt: number, delayMs: number) => void;
  /**
   * Chamado antes de cada nova tentativa (depois da espera). Se lançar, não tenta de novo e o erro sobe:
   * é onde o orçamento confere o gasto parcial antes de pagar mais uma tentativa.
   */
  beforeRetry?: (attempt: number) => void | Promise<void>;
  /**
   * Sinal de quem chamou (ex.: o usuário fechou o chat). Cancelado, nada é tentado de novo, seja qual
   * for o motivo do cancelamento (inclusive um `AbortSignal.timeout` do próprio chamador).
   */
  signal?: AbortSignal | undefined;
  /** Nome do provedor na mensagem do cancelamento. */
  provider?: string;
}

/** Cancelamento por quem chamou: não é retentável. */
export function cancelledError(provider: string, signal?: AbortSignal): LlmError {
  return new LlmError(`${provider}: chamada cancelada por quem chamou.`, 'provider', false, {
    cause: signal?.reason,
  });
}

/** Espera `ms`; termina antes (com erro) se o sinal cancelar. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Executa `fn` com backoff exponencial com jitter ("full jitter") enquanto o erro for retentável
 * (LlmError.retryable: 429, 5xx, timeout, conexão, saída fora do schema). Com `signal` cancelado, sobe
 * um erro de cancelamento não retentável (antes de tentar, durante a espera ou no lugar do erro da tentativa).
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const base = options.baseDelayMs ?? 1_000;
  const max = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;
  const { signal } = options;
  const cancelled = () => cancelledError(options.provider ?? 'llm', signal);
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw cancelled();
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted) throw cancelled();
      const retryable = err instanceof LlmError && err.retryable;
      if (!retryable || attempt >= options.retries) throw err;
      const delay = Math.round(random() * Math.min(max, base * 2 ** attempt));
      options.onRetry?.(err, attempt + 1, delay);
      try {
        await sleep(delay, signal);
      } catch (sleepErr) {
        if (signal?.aborted) throw cancelled();
        throw sleepErr;
      }
      if (signal?.aborted) throw cancelled();
      await options.beforeRetry?.(attempt + 1);
    }
  }
}
