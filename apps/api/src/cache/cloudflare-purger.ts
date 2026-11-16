import { isCdnTag } from './http.js';
import type { CdnPurger } from './purger.js';

/** API da Cloudflare (purge: `POST /zones/{zone_id}/purge_cache`). */
export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

/** Tags por chamada de purge: 100 em todos os planos menos o Enterprise (documentação, nov/2026). */
export const CLOUDFLARE_TAGS_PER_PURGE = 100;

/**
 * Chamadas de purge por tag por minuto no plano Free: 5, com balde de 25 (documentação, nov/2026). O limite é da
 * conta e vale para todas as zonas dela no mesmo plano, então o balde daqui é menor que o da Cloudflare.
 */
export const CLOUDFLARE_FREE_PURGES_PER_MINUTE = 5;
export const CLOUDFLARE_PURGE_BURST = 5;

interface PurgeLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface CloudflarePurgerOptions {
  zoneId: string;
  /** Token da API com permissão só de purge (Zone → Cache Purge) na zona. Nunca vai para o log. */
  token: string;
  fetch?: typeof fetch;
  logger?: PurgeLogger;
  /** Padrão 100 (`CLOUDFLARE_TAGS_PER_PURGE`). */
  tagsPerRequest?: number;
  /** Ritmo do balde de chamadas. Padrão 5 por minuto (plano Free). */
  requestsPerMinute?: number;
  /** Chamadas seguidas antes de o ritmo valer. Padrão 5. */
  burst?: number;
  /** Timeout de cada chamada (ms). Padrão 10 s. */
  timeoutMs?: number;
  /**
   * Teto de tags na fila. Acima dele, as tags de entidade mais antigas saem (as de coleção ficam) e um aviso vai
   * para o log: a cópia da borda ainda vence pelo teto de 15 min (`EDGE_MAX_TTL_SEC`). Padrão 10 000.
   */
  maxPendingTags?: number;
  apiBase?: string;
  now?: () => number;
}

interface CloudflareEnvelope {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
}

/** Espera depois de uma falha de rede, timeout ou 5xx: 5 s, 10 s, 20 s... até 5 min. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
/** Espera depois de um 429 sem `Retry-After`. */
const RATE_LIMITED_DEFAULT_MS = 60_000;

/**
 * Purge por tag na Cloudflare (#1257). O change feed chama `purgeTags` a cada lote de mudanças; aqui as tags entram
 * numa fila sem repetição e saem em chamadas de até 100 tags, no ritmo do plano (5 por minuto no Free). Enquanto
 * espera a vez, a fila junta as mudanças seguintes: muitas mudanças viram poucas chamadas.
 *
 * Nunca lança: falha da Cloudflare não pode travar o purge do Valkey nem o cursor do change feed. Rede, timeout e
 * 5xx voltam para a fila com espera crescente; 429 espera o `Retry-After`; os demais 4xx (token sem permissão, tag
 * recusada) descartam o lote com o erro no log. O token nunca vai para o log.
 */
export class CloudflareCdnPurger implements CdnPurger {
  private readonly pending = new Set<string>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly tagsPerRequest: number;
  private readonly ratePerMs: number;
  private readonly burst: number;
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private readonly url: string;
  private tokens: number;
  private refilledAt: number;
  private blockedUntil = 0;
  private failures = 0;
  private timer: NodeJS.Timeout | undefined;
  private inflight: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: CloudflarePurgerOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.tagsPerRequest = options.tagsPerRequest ?? CLOUDFLARE_TAGS_PER_PURGE;
    this.ratePerMs = (options.requestsPerMinute ?? CLOUDFLARE_FREE_PURGES_PER_MINUTE) / 60_000;
    this.burst = Math.max(1, options.burst ?? CLOUDFLARE_PURGE_BURST);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxPending = options.maxPendingTags ?? 10_000;
    this.url = `${options.apiBase ?? CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(options.zoneId)}/purge_cache`;
    this.tokens = this.burst;
    this.refilledAt = this.now();
  }

  /** Tags na fila, ainda não enviadas. */
  get pendingTags(): number {
    return this.pending.size;
  }

  async purgeTags(tags: string[]): Promise<void> {
    if (this.closed) return;
    for (const tag of tags) if (isCdnTag(tag)) this.pending.add(tag);
    this.trim();
    this.schedule();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inflight;
    // um último lote, se o balde deixar; o resto vence pelo teto da borda
    if (this.pending.size && this.waitMs(this.now()) === 0) {
      this.tokens -= 1;
      await this.send(this.takeBatch());
    }
    if (this.pending.size)
      this.options.logger?.warn(
        { pending: this.pending.size },
        'CDN: API fechando com tags na fila do purge (a borda as descarta pelo teto de 15 min)',
      );
  }

  private trim(): void {
    let excess = this.pending.size - this.maxPending;
    if (excess <= 0) return;
    let dropped = 0;
    for (const tag of this.pending) {
      if (excess <= 0) break;
      if (!tag.includes(':')) continue;
      this.pending.delete(tag);
      excess -= 1;
      dropped += 1;
    }
    if (dropped)
      this.options.logger?.warn(
        { dropped, pending: this.pending.size },
        'CDN: fila do purge cheia; tags de entidade mais antigas descartadas (a borda as vence pelo teto de 15 min)',
      );
  }

  /** Quanto falta para a próxima chamada: balde de chamadas e espera de um 429 ou de uma falha. */
  private waitMs(now: number): number {
    this.tokens = Math.min(this.burst, this.tokens + (now - this.refilledAt) * this.ratePerMs);
    this.refilledAt = now;
    const blocked = Math.max(0, this.blockedUntil - now);
    const forToken = this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.ratePerMs);
    return Math.max(blocked, forToken);
  }

  private schedule(): void {
    if (this.closed || this.timer || this.inflight || !this.pending.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.waitMs(this.now()));
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.closed || this.inflight || !this.pending.size) return;
    if (this.waitMs(this.now()) > 0) return this.schedule();
    this.tokens -= 1;
    this.inflight = this.send(this.takeBatch()).finally(() => {
      this.inflight = undefined;
      this.schedule();
    });
  }

  /** Lote de até `tagsPerRequest`: coleções primeiro (cobrem mais respostas), depois entidades por ordem de chegada. */
  private takeBatch(): string[] {
    const batch: string[] = [];
    for (const pass of [false, true])
      for (const tag of this.pending) {
        if (batch.length >= this.tagsPerRequest) break;
        if (tag.includes(':') === pass) batch.push(tag);
      }
    for (const tag of batch) this.pending.delete(tag);
    return batch;
  }

  private async send(batch: string[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          'user-agent': 'galaxie-sports/0.1',
        },
        body: JSON.stringify({ tags: batch }),
        signal: controller.signal,
      });
    } catch (err) {
      // só o tipo do erro: a mensagem de um erro de rede não traz o token, mas o objeto da requisição poderia
      const reason = controller.signal.aborted ? 'timeout' : err instanceof Error ? err.name : 'erro';
      return this.retryLater(batch, { reason });
    } finally {
      clearTimeout(timeout);
    }
    const body = (await res.json().catch(() => undefined)) as CloudflareEnvelope | undefined;
    if (res.ok && body?.success !== false) {
      this.failures = 0;
      this.options.logger?.info(
        { tags: batch.length, pending: this.pending.size },
        'CDN: purge por tag enviado',
      );
      return;
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RATE_LIMITED_DEFAULT_MS;
      this.blockedUntil = this.now() + waitMs;
      this.requeue(batch);
      this.options.logger?.warn(
        { status: 429, retryInSec: Math.ceil(waitMs / 1000), tags: batch.length },
        'CDN: limite de purge da Cloudflare; o lote volta para a fila',
      );
      return;
    }
    if (res.status >= 500) return this.retryLater(batch, { status: res.status, errors: cfErrors(body) });
    this.options.logger?.warn(
      { status: res.status, errors: cfErrors(body), tags: batch.length },
      'CDN: purge recusado pela Cloudflare; lote descartado (confira o token e a zona)',
    );
  }

  private retryLater(batch: string[], detail: object): void {
    this.failures += 1;
    const waitMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.failures - 1));
    this.blockedUntil = this.now() + waitMs;
    this.requeue(batch);
    this.options.logger?.warn(
      { ...detail, retryInSec: Math.ceil(waitMs / 1000), tags: batch.length },
      'CDN: purge na Cloudflare falhou; o lote volta para a fila',
    );
  }

  private requeue(batch: string[]): void {
    for (const tag of batch) this.pending.add(tag);
    this.trim();
  }
}

/** Código e mensagem dos erros da Cloudflare (no máximo 3), para o log. */
function cfErrors(body: CloudflareEnvelope | undefined): Array<{ code?: number; message?: string }> {
  return (body?.errors ?? []).slice(0, 3).map((e) => ({
    ...(e.code !== undefined ? { code: e.code } : {}),
    ...(e.message ? { message: e.message.slice(0, 200) } : {}),
  }));
}

/**
 * Configuração do purge a partir do ambiente: `CLOUDFLARE_ZONE_ID` (id da zona, 32 hexadecimais) e
 * `CLOUDFLARE_PURGE_TOKEN` (token só com Cache Purge), e o opcional `CLOUDFLARE_PURGE_REQUESTS_PER_MINUTE` (padrão
 * 5, o do plano Free). Sem as duas, nada (vale o `NoopCdnPurger`); com só uma ou com o id malformado, um aviso.
 */
export function cloudflarePurgeConfig(env: NodeJS.ProcessEnv = process.env): {
  config?: Pick<CloudflarePurgerOptions, 'zoneId' | 'token' | 'requestsPerMinute'>;
  warning?: string;
} {
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim() ?? '';
  const token = env.CLOUDFLARE_PURGE_TOKEN?.trim() ?? '';
  if (!zoneId && !token) return {};
  if (!zoneId || !token)
    return {
      warning: `purge da CDN desligado: falta ${zoneId ? 'CLOUDFLARE_PURGE_TOKEN' : 'CLOUDFLARE_ZONE_ID'} (precisa das duas)`,
    };
  if (!/^[0-9a-f]{32}$/i.test(zoneId))
    return { warning: 'purge da CDN desligado: CLOUDFLARE_ZONE_ID não é um id de zona (32 hexadecimais)' };
  const rpmRaw = env.CLOUDFLARE_PURGE_REQUESTS_PER_MINUTE?.trim();
  const rpm = rpmRaw ? Number(rpmRaw) : undefined;
  if (rpm !== undefined && !(rpm > 0))
    return { warning: 'purge da CDN desligado: CLOUDFLARE_PURGE_REQUESTS_PER_MINUTE deve ser um número > 0' };
  return { config: { zoneId, token, ...(rpm ? { requestsPerMinute: rpm } : {}) } };
}
