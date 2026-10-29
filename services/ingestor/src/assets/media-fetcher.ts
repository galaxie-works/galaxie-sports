import { systemClock, type Clock } from '@galaxie/apisports-client';
import { guardedFetch, isNotPublicError } from '@galaxie/net-guard';

/** User-Agent genérico: nunca identifica pessoas (CONTRIBUTING, regra de privacidade). */
export const MEDIA_USER_AGENT = 'galaxie-sports-asset-mirror/0.1';

export type MediaFetchResult =
  | { status: 'ok'; body: Uint8Array; contentType: string | undefined; attempts: number }
  | { status: 'not_found'; httpStatus: number; attempts: number }
  | { status: 'error'; reason: string; rateLimited: boolean; attempts: number };

export type MediaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface MediaFetcherOptions {
  /**
   * Padrão: `guardedFetch` — a URL vem do fornecedor e cada redirecionamento da CDN é seguido com o DNS
   * conferido na conexão (IP privado, loopback e metadados da nuvem recusados).
   */
  fetch?: MediaFetch;
  clock?: Clock;
  /** Novas tentativas em 429/5xx/erro de rede. Padrão 4. */
  maxRetries?: number;
  /** Base do backoff exponencial (ms). Padrão 1 s → 1, 2, 4, 8 s... */
  backoffBaseMs?: number;
  /** Teto do backoff (ms). Padrão 60 s. */
  backoffMaxMs?: number;
  timeoutMs?: number;
}

/**
 * Baixa mídia da CDN da api-sports de forma educada: 404/410 é definitivo (não repete);
 * 429 e 5xx repetem com backoff exponencial (respeitando Retry-After) e, no 429, pausam
 * TODOS os downloads em andamento — evita rajadas de 429 quando a CDN começa a limitar.
 */
export class MediaFetcher {
  private readonly fetchFn: MediaFetch;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly timeoutMs: number;
  private pauseUntil = 0;

  constructor(options: MediaFetcherOptions = {}) {
    this.fetchFn = options.fetch ?? guardedFetch();
    this.clock = options.clock ?? systemClock;
    this.maxRetries = options.maxRetries ?? 4;
    this.backoffBaseMs = options.backoffBaseMs ?? 1_000;
    this.backoffMaxMs = options.backoffMaxMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(this.backoffMaxMs, seconds * 1000);
    return Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** (attempt - 1));
  }

  private async waitPause(): Promise<void> {
    for (;;) {
      const wait = this.pauseUntil - this.clock.now();
      if (wait <= 0) return;
      await this.clock.sleep(wait);
    }
  }

  async get(url: string): Promise<MediaFetchResult> {
    let lastReason = '';
    let rateLimited = false;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      await this.waitPause();
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          headers: { 'user-agent': MEDIA_USER_AGENT, accept: 'image/*,*/*;q=0.5' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        lastReason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        // endereço não público (na URL ou num redirecionamento): repetir não muda nada
        if (isNotPublicError(err))
          return { status: 'error', reason: lastReason, rateLimited: false, attempts: attempt };
        rateLimited = false;
        if (attempt <= this.maxRetries) await this.clock.sleep(this.backoff(attempt, null));
        continue;
      }

      if (response.ok) {
        const body = new Uint8Array(await response.arrayBuffer());
        return {
          status: 'ok',
          body,
          contentType: response.headers.get('content-type') ?? undefined,
          attempts: attempt,
        };
      }
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 || response.status === 410) {
        return { status: 'not_found', httpStatus: response.status, attempts: attempt };
      }
      lastReason = `HTTP ${response.status}`;
      rateLimited = response.status === 429;
      if (response.status !== 429 && response.status < 500) {
        // 401/403 e afins: repetir não ajuda; fica pendente para a próxima execução
        return { status: 'error', reason: lastReason, rateLimited: false, attempts: attempt };
      }
      if (attempt <= this.maxRetries) {
        const wait = this.backoff(attempt, response.headers.get('retry-after'));
        if (rateLimited) this.pauseUntil = Math.max(this.pauseUntil, this.clock.now() + wait);
        await this.clock.sleep(wait);
      }
    }
    return { status: 'error', reason: lastReason, rateLimited, attempts: this.maxRetries + 1 };
  }
}
