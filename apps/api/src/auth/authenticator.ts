import { createHash } from 'node:crypto';
import type { ApiModule, ApiPlan } from '@galaxie/db';
import { problems } from '../errors.js';
import { parseApiKey, verifySecret } from './keys.js';
import type { TenantStore } from './tenant-store.js';

/** Contexto do tenant anexado à requisição autenticada. */
export interface TenantContext {
  tenantId: string;
  slug: string;
  plan: ApiPlan;
  keyId: string;
  /** `secret` = `x-galaxie-key` (backend); `publishable` = `x-galaxie-publishable-key` (navegador). */
  keyKind: 'secret' | 'publishable';
  /** Chave publicável presa a um widget (null/ausente = qualquer). */
  widgetId?: string | null;
  /** Módulos efetivos: os do tenant, restritos pelos escopos da chave. */
  modules: ApiModule[];
  /** Países contratados; vazio = todos. */
  markets: string[];
  /** Esportes contratados; vazio = todos. */
  sports: string[];
  rateLimitPerMinute: number;
}

export interface AuthenticatorOptions {
  /** Por quanto tempo uma chave verificada fica em cache em memória (ms). */
  cacheTtlMs?: number;
  /** Intervalo mínimo entre atualizações de last_used_at (ms). */
  touchIntervalMs?: number;
  now?: () => Date;
}

/**
 * Valida a chave `x-galaxie-key`. O scrypt é caro de propósito; para não pagá-lo a cada requisição,
 * o resultado positivo fica em cache por chave (indexado pelo sha256 da chave completa).
 * Revogações e mudanças de plano valem após `cacheTtlMs` (padrão 60 s).
 */
export class Authenticator {
  private readonly cache = new Map<string, { ctx: TenantContext; expiresAt: number }>();
  /** Chaves com prefixo existente mas segredo errado: evita recalcular o scrypt a cada tentativa. */
  private readonly rejected = new Map<string, number>();
  private readonly lastTouch = new Map<string, number>();
  private readonly cacheTtlMs: number;
  private readonly touchIntervalMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: TenantStore,
    options: AuthenticatorOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.touchIntervalMs = options.touchIntervalMs ?? 5 * 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async authenticate(rawKey: string | undefined): Promise<TenantContext> {
    if (!rawKey) throw problems.invalidKey('Header x-galaxie-key ausente.');
    const parsed = parseApiKey(rawKey);
    if (!parsed) throw problems.invalidKey('Formato de chave inválido.');

    const now = this.now();
    const cacheKey = createHash('sha256').update(rawKey.trim()).digest('base64url');
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now.getTime()) return cached.ctx;
    if ((this.rejected.get(cacheKey) ?? 0) > now.getTime()) throw problems.invalidKey();

    const record = await this.store.findKeyByPrefix(parsed.prefix);
    if (!record) throw problems.invalidKey();
    if (!(await verifySecret(parsed.secret, record.secretHash))) {
      if (this.rejected.size > 10_000) this.rejected.clear();
      this.rejected.set(cacheKey, now.getTime() + this.cacheTtlMs);
      throw problems.invalidKey();
    }
    if (record.revokedAt && record.revokedAt <= now) throw problems.invalidKey('Chave revogada.');
    if (record.expiresAt && record.expiresAt <= now) throw problems.invalidKey('Chave expirada.');
    if (record.tenant.status !== 'active') throw problems.invalidKey('Tenant suspenso.');

    const modules = record.scopes
      ? record.tenant.modules.filter((m) => record.scopes!.includes(m))
      : record.tenant.modules;
    const ctx: TenantContext = {
      tenantId: record.tenant.id,
      slug: record.tenant.slug,
      plan: record.tenant.plan,
      keyId: record.keyId,
      keyKind: 'secret',
      modules,
      markets: record.tenant.markets,
      sports: record.tenant.sports,
      rateLimitPerMinute: record.tenant.rateLimitPerMinute,
    };
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(cacheKey, { ctx, expiresAt: now.getTime() + this.cacheTtlMs });
    this.touch(record.keyId, now);
    return ctx;
  }

  private touch(keyId: string, now: Date): void {
    const last = this.lastTouch.get(keyId) ?? 0;
    if (now.getTime() - last < this.touchIntervalMs) return;
    this.lastTouch.set(keyId, now.getTime());
    this.store.touchKey(keyId, now).catch(() => {});
  }
}

export function assertModule(ctx: TenantContext, module: ApiModule): void {
  if (!ctx.modules.includes(module)) throw problems.moduleNotInPlan(module);
}

/** Mercados: lista vazia no tenant = todos os países. */
export function assertMarket(ctx: TenantContext, country: string): void {
  if (ctx.markets.length && !ctx.markets.includes(country.toUpperCase()))
    throw problems.marketNotInPlan(country.toUpperCase());
}

export function assertSport(ctx: TenantContext, sport: string): void {
  if (ctx.sports.length && !ctx.sports.includes(sport)) throw problems.sportNotInPlan(sport);
}
