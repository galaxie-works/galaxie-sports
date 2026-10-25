import type { FastifyRequest } from 'fastify';
import {
  hashPublishableKey,
  isOriginAllowed,
  isPublishableKey,
  listActivePublishableOrigins,
  touchPublishableKey,
  verifyPublishableKey,
  WIDGET_KIND_MODULES,
  type Database,
  type VerifiedPublishableKey,
} from '@galaxie/db';
import { problems } from '../errors.js';
import type { AuthAttempt, TenantContext } from './authenticator.js';
import type { AuthThrottle } from './throttle.js';

/** Header da chave publicável (a que vai no código do navegador). */
export const PUBLISHABLE_KEY_HEADER = 'x-galaxie-publishable-key';

/** Fonte das chaves publicáveis (Postgres em produção; memória nos testes unitários). */
export interface PublishableStore {
  verify(key: string): Promise<VerifiedPublishableKey | null>;
  touch(keyId: string, at: Date): Promise<void>;
  /** Origens de todas as chaves ativas (preflight CORS, que chega sem chave). */
  activeOrigins(): Promise<string[]>;
}

export class PgPublishableStore implements PublishableStore {
  constructor(private readonly db: Database) {}
  verify(key: string) {
    return verifyPublishableKey(this.db, key);
  }
  touch(keyId: string, at: Date) {
    return touchPublishableKey(this.db, keyId, at);
  }
  activeOrigins() {
    return listActivePublishableOrigins(this.db);
  }
}

export interface PublishableAuthenticatorOptions {
  /** Cache da verificação (positiva e negativa) e da lista de origens (ms). Padrão 60 s. */
  cacheTtlMs?: number;
  /** Intervalo mínimo entre atualizações de last_used_at (ms). Padrão 5 min. */
  touchIntervalMs?: number;
  /** Limite por IP das verificações fora do cache (cada uma é uma consulta ao banco). */
  throttle?: AuthThrottle;
  now?: () => Date;
}

/**
 * Valida a chave publicável e a origem da página. A verificação é um sha256 + uma busca por índice;
 * o resultado (inclusive "não existe") fica em cache por `cacheTtlMs`, então revogar vale em até 60 s.
 */
export class PublishableAuthenticator {
  private readonly cache = new Map<string, { value: VerifiedPublishableKey | null; expiresAt: number }>();
  private readonly lastTouch = new Map<string, number>();
  private origins: { list: string[]; expiresAt: number } | undefined;
  private readonly cacheTtlMs: number;
  private readonly touchIntervalMs: number;
  private readonly throttle: AuthThrottle | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly store: PublishableStore,
    options: PublishableAuthenticatorOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.touchIntervalMs = options.touchIntervalMs ?? 5 * 60_000;
    this.throttle = options.throttle;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Contexto do tenant para uma chave publicável usada a partir de `origin`. Chave inválida ou
   * revogada → 401 `INVALID_KEY`; origem fora da lista (ou ausente) → 403 `ORIGIN_NOT_ALLOWED`.
   */
  async authenticate(
    rawKey: string,
    origin: string | undefined,
    attempt: AuthAttempt = {},
  ): Promise<TenantContext> {
    if (!isPublishableKey(rawKey)) throw problems.invalidKey('Formato de chave publicável inválido.');
    const now = this.now();
    const hash = hashPublishableKey(rawKey);
    let entry = this.cache.get(hash);
    if (!entry || entry.expiresAt <= now.getTime()) {
      // fora do cache: uma consulta ao banco por chave (chaves aleatórias não autenticadas) — limite por IP
      if (attempt.ip) await this.throttle?.check(`ip:${attempt.ip}`);
      entry = { value: await this.store.verify(rawKey), expiresAt: now.getTime() + this.cacheTtlMs };
      if (this.cache.size > 10_000) this.cache.clear();
      if (this.cacheTtlMs > 0) this.cache.set(hash, entry);
    }
    const key = entry.value;
    if (!key) throw problems.invalidKey('Chave publicável inválida ou revogada.');
    if (!isOriginAllowed(origin, key.allowedOrigins)) throw problems.originNotAllowed(origin);

    // chave presa a um widget: só os módulos que aquele tipo de widget consome
    const modules = key.widgetKind
      ? key.tenant.modules.filter((m) => WIDGET_KIND_MODULES[key.widgetKind!].includes(m))
      : key.tenant.modules;
    this.touch(key.keyId, now);
    return {
      tenantId: key.tenant.id,
      slug: key.tenant.slug,
      plan: key.tenant.plan,
      keyId: key.keyId,
      keyKind: 'publishable',
      widgetId: key.widgetId,
      modules,
      markets: key.tenant.markets,
      sports: key.tenant.sports,
      rateLimitPerMinute: key.tenant.rateLimitPerMinute,
    };
  }

  /** A origem está na lista de alguma chave ativa? Responde ao preflight CORS. */
  async isRegisteredOrigin(origin: string): Promise<boolean> {
    const now = this.now().getTime();
    if (!this.origins || this.origins.expiresAt <= now)
      this.origins = { list: await this.store.activeOrigins(), expiresAt: now + this.cacheTtlMs };
    return isOriginAllowed(origin, this.origins.list);
  }

  private touch(keyId: string, now: Date): void {
    const last = this.lastTouch.get(keyId) ?? 0;
    if (now.getTime() - last < this.touchIntervalMs) return;
    if (this.lastTouch.size > 10_000) this.lastTouch.clear();
    this.lastTouch.set(keyId, now.getTime());
    this.store.touch(keyId, now).catch(() => {});
  }
}

/** Valor do header `x-galaxie-publishable-key` (nunca por query: a URL vai para logs e Referer). */
export function publishableKeyFrom(request: FastifyRequest): string | undefined {
  const header = request.headers[PUBLISHABLE_KEY_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || undefined;
}

/** Origem da página que fez a requisição: `Origin` ou, na falta dele, a origem do `Referer`. */
export function requestOrigin(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin) return origin;
  const referer = request.headers.referer;
  if (typeof referer !== 'string' || !referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * A chave publicável só alcança leitura da API canônica: GET/HEAD em rota `/v1/*` que exige módulo.
 * Fora disso (escrita, `/v1/account`, SSE, espelho, rotas internas e administrativas) → 403.
 */
export function assertPublishableRoute(request: FastifyRequest): void {
  const config = request.routeOptions.config;
  const url = request.routeOptions.url ?? '';
  const readOnly = request.method === 'GET' || request.method === 'HEAD';
  if (!readOnly || !config?.module || !url.startsWith('/v1/') || config.allowQueryKey || config.admin)
    throw problems.publishableKeyNotAllowed();
}
