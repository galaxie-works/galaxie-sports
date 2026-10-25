import { isIP } from 'node:net';
import { ProblemError } from '../errors.js';
import { MemoryRateLimiter, type RateLimiter } from '../rate-limit.js';

/**
 * Chave do limite por IP: IPv4 inteiro; IPv6 agrupado por /64 (um cliente costuma ter o /64 inteiro e
 * trocaria de endereço a cada tentativa). IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`) vira o IPv4.
 */
export function ipBucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (isIP(ip) !== 6) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const tl = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - tl.length).fill('0'), ...tl] : h;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

export interface AuthThrottleOptions {
  /** Tentativas de autenticação que custam trabalho (banco/scrypt) por janela, por IP e por prefixo. Padrão 60. */
  attemptsPerMinute?: number;
  /** Janela (ms). Padrão 60 s. */
  windowMs?: number;
  /** Limitador indisponível (Valkey fora): registrado; a contagem segue local, em memória. */
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
  /** Com o Valkey fora, conta por instância: fail-open devolveria o DoS de scrypt. */
  private readonly fallback = new MemoryRateLimiter();

  constructor(
    private readonly limiter: RateLimiter,
    private readonly options: AuthThrottleOptions = {},
  ) {
    this.limit = options.attemptsPerMinute ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
  }

  /** Conta uma tentativa em cada chave (`ip:...`, `prefix:...`); alguma estourou → 429 RATE_LIMITED. */
  async check(...keys: string[]): Promise<void> {
    const hitAll = (limiter: RateLimiter) =>
      Promise.all(keys.map((k) => limiter.hit(`auth:${k}`, this.limit, this.windowMs)));
    let results;
    try {
      results = await hitAll(this.limiter);
    } catch (err) {
      this.options.onError?.(err);
      results = await hitAll(this.fallback);
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
