import { createHash } from 'node:crypto';
import type { AccessErrorReason, ApiModule, ApiPlan } from '@galaxie/db';
import { problems } from '../errors.js';
import { parseApiKey, verifySecret } from './keys.js';
import type { KeyRecord, TenantStore } from './tenant-store.js';
import { ipBucket, type AuthThrottle } from './throttle.js';
import type { VerifiedKeyStore } from './verified-keys.js';

/** Contexto do tenant anexado à requisição autenticada. */
export interface TenantContext {
  tenantId: string;
  slug: string;
  plan: ApiPlan;
  keyId: string;
  /** Prefixo público da chave (o token curto do SSE leva o da secreta para reler a chave; a publicável, só no diagnóstico). */
  keyPrefix?: string;
  /** `secret` = `x-galaxie-key` (backend); `publishable` = `x-galaxie-publishable-key` (navegador). */
  keyKind: 'secret' | 'publishable';
  /** Ambiente da chave: `test` tem limite próprio e uso contado à parte (docs/politica-de-chaves.md §1). */
  env: 'live' | 'test';
  /** Chave publicável presa a um widget (null/ausente = qualquer). */
  widgetId?: string | null;
  /** Módulos efetivos: os do tenant, restritos pelos escopos da chave. */
  modules: ApiModule[];
  /** Países contratados; vazio = todos. */
  markets: string[];
  /** Esportes contratados; vazio = todos. */
  sports: string[];
  rateLimitPerMinute: number;
  /** Cota diária de produção do tenant; null/ausente = sem cota (docs/politica-de-chaves.md §4). */
  dailyRequestQuota?: number | null;
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
  /** Chaves já verificadas em qualquer instância (Valkey): não passam pelos limites de tentativa. */
  verifiedKeys?: VerifiedKeyStore;
  /** TTL (deslizante) do registro em `verifiedKeys` (ms; padrão 24 h). */
  rememberTtlMs?: number;
  /**
   * Recusa atribuível a um tenant (chave existente: segredo errado, revogada, expirada, ambiente trocado,
   * tenant suspenso), para o diagnóstico no painel (#1007). Prefixo desconhecido e limite de tentativas não
   * chamam: sem tenant, ou é ataque. Não pode lançar nem bloquear (roda na requisição).
   */
  onDenied?: (denied: { tenantId: string; reason: AccessErrorReason; keyPrefix: string }) => void;
  now?: () => Date;
}

/** Contexto da requisição usado no limite de tentativas. */
export interface AuthAttempt {
  ip?: string | undefined;
  /**
   * Idade máxima do contexto em cache (ms). Conexões longas (SSE) usam para que revogação e suspensão
   * valham dentro do mesmo prazo de 60 s das requisições comuns.
   */
  maxAgeMs?: number | undefined;
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
  private readonly cache = new Map<string, { ctx: TenantContext; at: number; expiresAt: number }>();
  /** Chaves com prefixo existente mas segredo errado: evita recalcular o scrypt a cada tentativa. */
  private readonly rejected = new Map<string, { until: number; tenantId: string; prefix: string }>();
  /** Prefixos inexistentes, revogados ou expirados: evita uma consulta ao banco por tentativa. */
  private readonly deadPrefixes = new Map<
    string,
    { detail: string | undefined; expiresAt: number; tenantId?: string; reason?: AccessErrorReason }
  >();
  /** sha256 da chave completa → hash scrypt já conferido (dispensa o scrypt enquanto o hash for o mesmo). */
  private readonly verified = new Map<string, { secretHash: string; expiresAt: number }>();
  private readonly lastTouch = new Map<string, number>();
  private readonly cacheTtlMs: number;
  private readonly verifiedTtlMs: number;
  private readonly touchIntervalMs: number;
  private readonly throttle: AuthThrottle | undefined;
  private readonly verifiedKeys: VerifiedKeyStore | undefined;
  private readonly rememberTtlMs: number;
  private readonly now: () => Date;
  private readonly onDenied: AuthenticatorOptions['onDenied'];

  constructor(
    private readonly store: TenantStore,
    options: AuthenticatorOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.verifiedTtlMs = options.verifiedTtlMs ?? 3_600_000;
    this.touchIntervalMs = options.touchIntervalMs ?? 5 * 60_000;
    this.throttle = options.throttle;
    this.verifiedKeys = options.verifiedKeys;
    this.rememberTtlMs = options.rememberTtlMs ?? 86_400_000;
    this.now = options.now ?? (() => new Date());
    this.onDenied = options.onDenied;
  }

  private denied(
    tenantId: string | undefined,
    reason: AccessErrorReason | undefined,
    keyPrefix: string,
  ): void {
    if (!tenantId || !reason || !this.onDenied) return;
    try {
      this.onDenied({ tenantId, reason, keyPrefix });
    } catch {
      // diagnóstico nunca derruba a autenticação
    }
  }

  async authenticate(rawKey: string | undefined, attempt: AuthAttempt = {}): Promise<TenantContext> {
    if (!rawKey) throw problems.invalidKey('Header x-galaxie-key ausente.');
    const parsed = parseApiKey(rawKey);
    if (!parsed) throw problems.invalidKey('Formato de chave inválido.');

    const now = this.now();
    const t = now.getTime();
    const cacheKey = createHash('sha256').update(rawKey.trim()).digest('base64url');
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > t && (attempt.maxAgeMs == null || t - cached.at <= attempt.maxAgeMs))
      return cached.ctx;
    const rejected = this.rejected.get(cacheKey);
    if (rejected && rejected.until > t) {
      this.denied(rejected.tenantId, 'invalid_secret', rejected.prefix);
      throw problems.invalidKey();
    }

    const known = this.verified.get(cacheKey);
    const isKnown = !!known && known.expiresAt > t;
    const dead = this.deadPrefixes.get(parsed.prefix);
    // o motivo (revogada, expirada, suspensa) só para quem já provou ter a chave: o prefixo é público
    if (dead && dead.expiresAt > t) {
      this.denied(dead.tenantId, dead.reason, parsed.prefix);
      throw problems.invalidKey(isKnown ? dead.detail : undefined);
    }

    // segredo já verificado aqui ou em outra instância (Valkey): fora dos limites de tentativa, para que um
    // ataque ao prefixo (ou ao IP, atrás de NAT) não derrube a chave legítima — nem após deploy/restart
    const remembered = isKnown || ((await this.verifiedKeys?.has(cacheKey).catch(() => false)) ?? false);
    if (!remembered && attempt.ip) await this.throttle?.check(`ip:${ipBucket(attempt.ip)}`);

    const record = await this.store.findKeyByPrefix(parsed.prefix);
    const reveal = (detail: string) => (remembered ? detail : undefined);
    const markDead = (detail?: string, reason?: AccessErrorReason): never => {
      const tenantId = record?.tenant.id;
      if (this.cacheTtlMs > 0)
        put(this.deadPrefixes, parsed.prefix, {
          detail,
          expiresAt: t + this.cacheTtlMs,
          ...(tenantId && reason ? { tenantId, reason } : {}),
        });
      this.denied(tenantId, reason, parsed.prefix);
      throw problems.invalidKey(detail ? reveal(detail) : undefined);
    };
    if (!record) return markDead();
    // estado da chave antes do scrypt: chave revogada/expirada não custa CPU a cada tentativa
    if (record.revokedAt && record.revokedAt <= now) return markDead('Chave revogada.', 'revoked');
    if (record.expiresAt && record.expiresAt <= now) return markDead('Chave expirada.', 'expired');
    this.assertKeyState(record, now, parsed.env, reveal, (reason) =>
      this.denied(record.tenant.id, reason, parsed.prefix),
    );
    if (record.keyFormat >= 2 && parsed.format < 2) {
      this.denied(record.tenant.id, 'invalid_secret', parsed.prefix);
      throw problems.invalidKey();
    }

    if (isKnown && known.secretHash === record.secretHash) {
      // TTL deslizante: chave em uso nunca cai de volta nos limites de tentativa
      known.expiresAt = t + this.verifiedTtlMs;
    } else {
      if (!remembered) await this.throttle?.check(`prefix:${parsed.prefix}`);
      if (!(await verifySecret(parsed.secret, record.secretHash))) {
        put(this.rejected, cacheKey, {
          until: t + this.cacheTtlMs,
          tenantId: record.tenant.id,
          prefix: parsed.prefix,
        });
        this.denied(record.tenant.id, 'invalid_secret', parsed.prefix);
        throw problems.invalidKey();
      }
      put(this.verified, cacheKey, { secretHash: record.secretHash, expiresAt: t + this.verifiedTtlMs });
    }
    // renovado a cada releitura do registro (uma por chave e instância a cada `cacheTtlMs`)
    this.verifiedKeys?.add(cacheKey, this.rememberTtlMs).catch(() => {});

    const ctx = contextOf(record, parsed.prefix);
    put(this.cache, cacheKey, { ctx, at: t, expiresAt: t + this.cacheTtlMs });
    this.touch(record.keyId, now);
    return ctx;
  }

  /**
   * Contexto de uma chave secreta que o cliente JÁ provou ter (o token curto do SSE, assinado pela API ao
   * receber a chave no header): relê o registro pelo prefixo e aplica as mesmas checagens de estado
   * (revogada, expirada, tenant suspenso, fim do trial), sem o segredo nem o scrypt. Prefixo de outra
   * chave (`keyId` diferente) não autentica. Mesmo cache de `cacheTtlMs` e `maxAgeMs` da chave.
   */
  async authenticateProvenKey(
    prefix: string,
    keyId: string,
    attempt: Pick<AuthAttempt, 'maxAgeMs'> = {},
  ): Promise<TenantContext> {
    const now = this.now();
    const t = now.getTime();
    const cacheKey = `proven:${prefix}:${keyId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > t && (attempt.maxAgeMs == null || t - cached.at <= attempt.maxAgeMs))
      return cached.ctx;
    const record = await this.store.findKeyByPrefix(prefix);
    if (!record || record.keyId !== keyId) throw problems.invalidKey();
    if (record.revokedAt && record.revokedAt <= now) throw problems.invalidKey('Chave revogada.');
    if (record.expiresAt && record.expiresAt <= now) throw problems.invalidKey('Chave expirada.');
    this.assertKeyState(record, now, record.env, (d) => d);
    const ctx = contextOf(record, prefix);
    put(this.cache, cacheKey, { ctx, at: t, expiresAt: t + this.cacheTtlMs });
    this.touch(record.keyId, now);
    return ctx;
  }

  /** Tenant ativo, dentro do trial e ambiente da chave igual ao do prefixo. */
  private assertKeyState(
    record: KeyRecord,
    now: Date,
    env: 'live' | 'test',
    reveal: (detail: string) => string | undefined,
    denied: (reason: AccessErrorReason) => void = () => {},
  ): void {
    if (record.tenant.status !== 'active') {
      denied('tenant_inactive');
      throw problems.invalidKey(reveal('Tenant suspenso.'));
    }
    // fim do trial vale para todas as chaves do tenant
    if (record.tenant.trialEndsAt && record.tenant.trialEndsAt <= now) {
      denied('tenant_inactive');
      throw problems.invalidKey(
        reveal('O trial terminou: fale com o time da Galaxie para contratar um plano.'),
      );
    }
    // o prefixo vale: `gs_test_` de uma chave de produção (ou o contrário) não autentica. Sem cache negativo
    // por prefixo aqui, para não bloquear a chave certa do mesmo prefixo
    if (env !== record.env) {
      denied('wrong_env');
      throw problems.invalidKey(reveal('O ambiente da chave (live/test) não confere com o prefixo.'));
    }
  }

  private touch(keyId: string, now: Date): void {
    const last = this.lastTouch.get(keyId) ?? 0;
    if (now.getTime() - last < this.touchIntervalMs) return;
    this.lastTouch.set(keyId, now.getTime());
    this.store.touchKey(keyId, now).catch(() => {});
  }
}

/** Contexto da requisição a partir do registro da chave secreta. */
/**
 * Módulos fechados até decisão do dono: sem eles, as rotas respondem 403 e o tempo real não entrega o tópico.
 * Só a chave secreta dos tenants listados passa (a vitrine do próprio site lê por ela).
 * - `related_content` (vídeos): `RELATED_CONTENT_TENANTS`.
 */
const CLOSED_MODULES: { module: ApiModule; env: string; tenants: readonly string[] }[] = [
  { module: 'related_content', env: 'RELATED_CONTENT_TENANTS', tenants: ['demo-vps', 'demo-local'] },
];

export function withoutClosedModules(
  modules: readonly ApiModule[],
  slug: string,
  kind: TenantContext['keyKind'],
) {
  const closed = new Set(
    CLOSED_MODULES.filter(
      (c) => !(kind === 'secret' && (process.env[c.env]?.split(',') ?? c.tenants).includes(slug)),
    ).map((c) => c.module),
  );
  return modules.filter((m) => !closed.has(m));
}

function contextOf(record: KeyRecord, prefix: string): TenantContext {
  const modules = withoutClosedModules(
    record.scopes ? record.tenant.modules.filter((m) => record.scopes!.includes(m)) : record.tenant.modules,
    record.tenant.slug,
    'secret',
  );
  return {
    tenantId: record.tenant.id,
    slug: record.tenant.slug,
    plan: record.tenant.plan,
    keyId: record.keyId,
    keyPrefix: prefix,
    keyKind: 'secret',
    env: record.env,
    modules,
    markets: record.tenant.markets,
    sports: record.tenant.sports,
    rateLimitPerMinute: record.tenant.rateLimitPerMinute,
    dailyRequestQuota: record.tenant.dailyRequestQuota ?? null,
  };
}

export function assertModule(ctx: TenantContext, module: ApiModule): void {
  if (!ctx.modules.includes(module)) throw problems.moduleNotInPlan(module);
}

/**
 * Guarda única dos módulos (#1018), para o que não passa pelo `config.module` das rotas (worker, serviços,
 * telas): tenant sem o módulo recebe o mesmo 403 MODULE_NOT_IN_PLAN.
 */
export const requireModule = (ctx: Pick<TenantContext, 'modules'>, module: ApiModule): void => {
  if (!ctx.modules.includes(module)) throw problems.moduleNotInPlan(module);
};

/** Mercados: lista vazia no tenant = todos os países. */
export function assertMarket(ctx: TenantContext, country: string): void {
  if (ctx.markets.length && !ctx.markets.includes(country.toUpperCase()))
    throw problems.marketNotInPlan(country.toUpperCase());
}

export function assertSport(ctx: TenantContext, sport: string): void {
  if (ctx.sports.length && !ctx.sports.includes(sport)) throw problems.sportNotInPlan(sport);
}
