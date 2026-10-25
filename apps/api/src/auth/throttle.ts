import { ProblemError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';

export interface AuthThrottleOptions {
  /** Tentativas de autenticação que custam trabalho (banco/scrypt) por janela, por IP e por prefixo. Padrão 60. */
  attemptsPerMinute?: number;
  /** Janela (ms). Padrão 60 s. */
  windowMs?: number;
  /** Limitador indisponível: a autenticação segue (fail-open), mas o erro é registrado. */
  onError?: (err: unknown) => void;
}

/**
 * Limite de tentativas de autenticação **antes** do trabalho caro. O rate limit do tenant só existe
 * depois de autenticar; sem este, chaves aleatórias (o prefixo é público) custariam uma consulta ao
 * banco e um scrypt (~16 MiB) cada, saturando o threadpool sem autenticação. Só contam tentativas que
 * não estão em cache: uma chave já verificada nunca passa por aqui.
 */
export class AuthThrottle {
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(
    private readonly limiter: RateLimiter,
    private readonly options: AuthThrottleOptions = {},
  ) {
    this.limit = options.attemptsPerMinute ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
  }

  /** Conta uma tentativa em cada chave (`ip:...`, `prefix:...`); alguma estourou → 429 RATE_LIMITED. */
  async check(...keys: string[]): Promise<void> {
    let results;
    try {
      results = await Promise.all(keys.map((k) => this.limiter.hit(`auth:${k}`, this.limit, this.windowMs)));
    } catch (err) {
      this.options.onError?.(err);
      return;
    }
    const blocked = results.find((r) => !r.allowed);
    if (blocked) {
      const retryAfter = Math.max(1, Math.ceil(blocked.resetMs / 1000));
      throw new ProblemError(
        429,
        'RATE_LIMITED',
        'Muitas tentativas de autenticação',
        'Muitas chaves inválidas ou não verificadas a partir deste IP ou para este prefixo; aguarde.',
        { headers: { 'retry-after': String(retryAfter) } },
      );
    }
  }
}
