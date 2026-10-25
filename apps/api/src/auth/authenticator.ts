import { createHash } from 'node:crypto';
import type { ApiModule, ApiPlan } from '@galaxie/db';
import { problems } from '../errors.js';
import { parseApiKey, verifySecret } from './keys.js';
import type { TenantStore } from './tenant-store.js';
import type { AuthThrottle } from './throttle.js';

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
  /**
   * Por quanto tempo um segredo já verificado dispensa o scrypt (ms; padrão 1 h). O registro da chave
   * (revogação, validade, plano) continua sendo relido do banco a cada `cacheTtlMs`.
   */
  verifiedTtlMs?: number;
  /** Intervalo mínimo entre atualizações de last_used_at (ms). */
  touchIntervalMs?: number;
  /** Limite de tentativas não cacheadas por IP e por prefixo, antes do banco e do scrypt. */
  throttle?: AuthThrottle;
  now?: () => Date;
}

/** Contexto da requisição usado no limite de tentativas. */
export interface AuthAttempt {
  ip?: string | undefined;
}

const MAX_ENTRIES = 10_000;

/** Map limitado: passou do teto, recomeça (os caches abaixo são só otimização). */
function put<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MAX_ENTRIES) map.clear();
  map.set(key, value);
}

/**
 * Valida a chave `x-galaxie-key`. O scrypt é caro de propósito; para não pagá-lo a cada requisição,
 * o resultado positivo fica em cache por chave (indexado pelo sha256 da chave completa).
 * Revogações e mudanças de plano valem após `cacheTtlMs` (padrão 60 s).
 *
 * Ordem do trabalho numa chave fora do cache (auditoria API-2): limite por IP → banco (prefixo
 * desconhecido, revogado ou expirado fica em cache negativo por prefixo) → revogada/expirada/tenant
 * suspenso, ainda sem scrypt → limite por prefixo → scrypt. Um segredo já verificado pula os limites
 * e o scrypt, então um ataque a um prefixo não derruba a chave legítima.
 */
export class Authenticator {
  private readonly cache = new Map<string, { ctx: TenantContext; expiresAt: number }>();
  /** Chaves com prefixo existente mas segredo errado: evita recalcular o scrypt a cada tentativa. */
  private readonly rejected = new Map<string, number>();
  /** Prefixos inexistentes, revogados ou expirados: evita uma consulta ao banco por tentativa. */
  private readonly deadPrefixes = new Map<string, { detail: string | undefined; expiresAt: number }>();
  /** sha256 da chave completa → hash scrypt já conferido (dispensa o scrypt enquanto o hash for o mesmo). */
  private readonly verified = new Map<string, { secretHash: string; expiresAt: number }>();
  private readonly lastTouch = new Map<string, number>();
  private readonly cacheTtlMs: number;
  private readonly verifiedTtlMs: number;
  private readonly touchIntervalMs: number;
  private readonly throttle: AuthThrottle | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly store: TenantStore,
    options: AuthenticatorOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.verifiedTtlMs = options.verifiedTtlMs ?? 3_600_000;
    this.touchIntervalMs = options.touchIntervalMs ?? 5 * 60_000;
    this.throttle = options.throttle;
    this.now = options.now ?? (() => new Date());
  }

  async authenticate(rawKey: string | undefined, attempt: AuthAttempt = {}): Promise<TenantContext> {
    if (!rawKey) throw problems.invalidKey('Header x-galaxie-key ausente.');
    const parsed = parseApiKey(rawKey);
    if (!parsed) throw problems.invalidKey('Formato de chave inválido.');

    const now = this.now();
    const t = now.getTime();
    const cacheKey = createHash('sha256').update(rawKey.trim()).digest('base64url');
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > t) return cached.ctx;
    if ((this.rejected.get(cacheKey) ?? 0) > t) throw problems.invalidKey();
    const dead = this.deadPrefixes.get(parsed.prefix);
    if (dead && dead.expiresAt > t) throw problems.invalidKey(dead.detail);

    const known = this.verified.get(cacheKey);
    const isKnown = !!known && known.expiresAt > t;
    // chave nunca verificada: cada tentativa custa banco (e talvez scrypt) — limite por IP antes
    if (!isKnown && attempt.ip) await this.throttle?.check(`ip:${attempt.ip}`);

    const record = await this.store.findKeyByPrefix(parsed.prefix);
    const markDead = (detail?: string): never => {
      if (this.cacheTtlMs > 0)
        put(this.deadPrefixes, parsed.prefix, { detail, expiresAt: t + this.cacheTtlMs });
      throw problems.invalidKey(detail);
    };
    if (!record) return markDead();
    // estado da chave antes do scrypt: chave revogada/expirada não custa CPU a cada tentativa
    if (record.revokedAt && record.revokedAt <= now) return markDead('Chave revogada.');
    if (record.expiresAt && record.expiresAt <= now) return markDead('Chave expirada.');
    if (record.tenant.status !== 'active') throw problems.invalidKey('Tenant suspenso.');

    if (!isKnown || known.secretHash !== record.secretHash) {
      await this.throttle?.check(`prefix:${parsed.prefix}`);
      if (!(await verifySecret(parsed.secret, record.secretHash))) {
        put(this.rejected, cacheKey, t + this.cacheTtlMs);
        throw problems.invalidKey();
      }
      put(this.verified, cacheKey, { secretHash: record.secretHash, expiresAt: t + this.verifiedTtlMs });
    }

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
    put(this.cache, cacheKey, { ctx, expiresAt: t + this.cacheTtlMs });
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
