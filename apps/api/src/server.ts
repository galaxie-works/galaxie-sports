import Fastify, { type FastifyContextConfig, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { MediaDenylist } from '@galaxie/apisports-client';
import { pingDb, type Database } from '@galaxie/db';
import { AdminGuard, type AdminGuardOptions } from './admin/guard.js';
import { loadPlans, type PlanCatalog } from './admin/plans.js';
import { adminRoutes } from './admin/routes.js';
import { assertModule, Authenticator, type AuthenticatorOptions } from './auth/authenticator.js';
import { PgTenantStore, type TenantStore } from './auth/tenant-store.js';
import { ChangeFeedListener, type ChangeFeedOptions } from './cache/change-feed.js';
import { NoopCdnPurger, type CdnPurger } from './cache/purger.js';
import { MemoryResponseCache, RedisResponseCache, type ResponseCache } from './cache/store.js';
import type { AppContext, SemanticConfig } from './context.js';
import { ProblemError, problems, registerErrorHandling } from './errors.js';
import { RulesRegistry } from './events/rules-registry.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './rate-limit.js';
import { apiKeyFrom, registerRealtime, type RealtimeOptions } from './realtime/index.js';
import { docsRoutes } from './routes/docs.js';
import { mirrorRoutes } from './routes/mirror.js';
import { apiLoggerOptions, registerObservability } from './observability.js';
import { accountRoutes } from './routes/v1/account.js';
import { v1Routes } from './routes/v1/index.js';
import { registerCors, type CorsOptions } from './security/cors.js';
import { registerSecurityHeaders, type SecurityHeadersOptions } from './security/headers.js';
import { MemoryUsageBackend, RedisUsageBackend, UsageCounter, type UsageBackend } from './usage/counter.js';
import { UsagePersister } from './usage/store.js';

export interface ServerOptions {
  db?: Database;
  /** Valkey/Redis: cache de respostas e rate limit compartilhados. Sem ele, usa memória. */
  redis?: Redis;
  /** Prefixo das chaves no Valkey (permite isolar ambientes/testes). Padrão `gs:`. */
  keyPrefix?: string;
  logger?: boolean;
  tenantStore?: TenantStore;
  authenticator?: AuthenticatorOptions;
  cache?: ResponseCache;
  rateLimiter?: RateLimiter;
  /** Janela do rate limit (ms). Padrão 60 s; o limite vem do tenant (rate_limit_per_minute). */
  rateLimitWindowMs?: number;
  cdnPurger?: CdnPurger;
  /** Escuta `ops.change_feed` e purga o cache (requer db). */
  changeFeed?: boolean | ChangeFeedOptions;
  /** ASSETS_PUBLIC_BASE_URL. */
  assetsBaseUrl?: string;
  /** URL pública anunciada no OpenAPI. */
  publicUrl?: string;
  /** Tempo real: `GET /v1/stream` (SSE) com fan-out via Valkey (requer db). */
  realtime?: boolean | RealtimeOptions;
  /** Tamanho máximo do corpo das requisições (bytes). Padrão 64 KiB. */
  bodyLimit?: number;
  /** `trustProxy` do Fastify (IP real atrás de proxy/CDN; ver TRUST_PROXY). Padrão false. */
  trustProxy?: boolean | string | string[];
  /** Headers de segurança (HSTS etc.). */
  security?: SecurityHeadersOptions;
  /** CORS estrito; ausente ou sem origens = nenhum header CORS. */
  cors?: CorsOptions;
  /** Rotas /internal/admin/* (só registradas com ao menos um hash de chave administrativa e banco). */
  admin?: AdminGuardOptions & { plans?: PlanCatalog };
  /** Contadores de uso por tenant × dia × rota. Padrão: Valkey (ou memória sem Valkey); false desliga. */
  usage?: UsageBackend | false;
  /** Envio do buffer de uso ao backend (ms; padrão 1000) e consolidação no Postgres (ms; padrão 60000). */
  usageFlushIntervalMs?: number;
  usagePersistIntervalMs?: number;
  /** Diretório dos regulamentos (padrão: config/rules do monorepo). */
  rulesDir?: string;
  /** URLs de mídia bloqueadas (config/assets/denylist.yaml). */
  mediaDenylist?: MediaDenylist;
  /** Relógio injetável (testes de momentum/agenda). */
  now?: () => Date;
  /** Piso editorial da semântica e pasta da base (SEMANTIC_MIN_REVIEW_STATUS, KNOWLEDGE_DIR). */
  semantic?: SemanticConfig;
}

/** Monta a API sem iniciar o listener — usado pelo main.ts e pelos testes (inject). */
export function buildServer(options: ServerOptions = {}): FastifyInstance {
  // o serializer de requisição (apiLoggerOptions) não inclui headers: chaves nunca vão para o log
  const app = Fastify({
    logger: options.logger ? apiLoggerOptions() : false,
    bodyLimit: options.bodyLimit ?? 64 * 1024,
    trustProxy: options.trustProxy ?? false,
    requestTimeout: 30_000,
  });
  // Tabela de rotas para a auditoria de autenticação/validação (security.test.ts).
  const routeTable: { method: string; url: string; config: FastifyContextConfig }[] = [];
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) routeTable.push({ method, url: r.url, config: r.config ?? {} });
  });
  app.decorate('routeTable', routeTable);
  registerObservability(app, { db: options.db });
  const prefix = options.keyPrefix ?? 'gs:';

  const cache =
    options.cache ??
    (options.redis ? new RedisResponseCache(options.redis, prefix) : new MemoryResponseCache());
  const limiter =
    options.rateLimiter ??
    (options.redis ? new RedisRateLimiter(options.redis, prefix) : new MemoryRateLimiter());
  const windowMs = options.rateLimitWindowMs ?? 60_000;
  const store = options.tenantStore ?? (options.db ? new PgTenantStore(options.db) : undefined);
  const authenticator = store ? new Authenticator(store, options.authenticator) : undefined;
  const ctx: AppContext = {
    db: options.db,
    cache,
    assetsBaseUrl: options.assetsBaseUrl,
    rules: new RulesRegistry(options.rulesDir),
    mediaDenylist: options.mediaDenylist,
    now: options.now ?? (() => new Date()),
    ...(options.semantic ? { semantic: options.semantic } : {}),
  };
  const usageBackend =
    options.usage === false
      ? undefined
      : (options.usage ??
        (options.redis ? new RedisUsageBackend(options.redis, prefix) : new MemoryUsageBackend()));
  const usage = usageBackend
    ? new UsageCounter(usageBackend, {
        flushIntervalMs: options.usageFlushIntervalMs ?? 1000,
        onError: (err) => app.log.warn({ err }, 'contadores de uso indisponíveis'),
      })
    : undefined;

  registerErrorHandling(app);
  registerSecurityHeaders(app, options.security);
  if (options.cors?.origins.length) registerCors(app, options.cors);
  app.decorateRequest('tenant', null);

  // Autenticação, módulo do plano, uso e rate limit — rotas com `config.module` ou `config.authenticated`.
  app.addHook('onRequest', async (request, reply) => {
    const module = request.routeOptions.config?.module;
    if (!module && !request.routeOptions.config?.authenticated) return;
    if (!authenticator) throw problems.degraded('Autenticação indisponível: banco de dados não configurado.');
    const tenant = await authenticator.authenticate(apiKeyFrom(request));
    request.tenant = tenant;
    if (module) assertModule(tenant, module);

    const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
    usage?.record(tenant.tenantId, route);
    try {
      const r = await limiter.hit(`${tenant.tenantId}:${route}`, tenant.rateLimitPerMinute, windowMs);
      const resetSec = Math.ceil(r.resetMs / 1000);
      reply
        .header('x-ratelimit-limit', String(r.limit))
        .header('x-ratelimit-remaining', String(r.remaining))
        .header('x-ratelimit-reset', String(resetSec));
      if (!r.allowed) throw problems.rateLimited(resetSec);
    } catch (err) {
      if (err instanceof ProblemError) throw err;
      // rate limit indisponível não derruba a API (fail-open), mas fica registrado
      request.log.warn({ err }, 'rate limit indisponível');
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'galaxie-sports-api' }));

  app.get('/health/db', async (_req, reply) => {
    if (!options.db)
      return reply.code(503).send({ status: 'unavailable', reason: 'database not configured' });
    await pingDb(options.db);
    return { status: 'ok' };
  });

  app.register(async (instance) => {
    await docsRoutes(instance, { publicUrl: options.publicUrl });
    await v1Routes(instance, ctx);
    await mirrorRoutes(instance, ctx);
    await accountRoutes(instance, { db: options.db, usage: usageBackend });
  });

  if (options.admin?.keyHashes.length && options.db) {
    const guard = new AdminGuard(options.admin);
    const plans = options.admin.plans ?? loadPlans();
    app.register(adminRoutes, { db: options.db, guard, plans, usage: usageBackend });
  }

  if (usage) {
    const persister =
      options.db && usageBackend
        ? new UsagePersister(options.db, usageBackend, {
            intervalMs: options.usagePersistIntervalMs ?? 60_000,
            onError: (err) => app.log.warn({ err }, 'falha ao consolidar uso'),
          })
        : undefined;
    app.addHook('onReady', async () => {
      usage.start();
      persister?.start();
    });
    app.addHook('onClose', async () => {
      persister?.stop();
      await usage.stop();
    });
  }

  if (options.changeFeed && options.db) {
    const listener = new ChangeFeedListener(options.db, cache, options.cdnPurger ?? new NoopCdnPurger(), {
      ...(typeof options.changeFeed === 'object' ? options.changeFeed : {}),
      logger: app.log,
    });
    app.decorate('changeFeed', listener);
    app.addHook('onReady', async () => listener.start());
    app.addHook('onClose', async () => listener.stop());
  }

  if (options.realtime && options.db) {
    registerRealtime(app, {
      db: options.db,
      ...(options.redis ? { redis: options.redis } : {}),
      keyPrefix: prefix,
      options: typeof options.realtime === 'object' ? options.realtime : {},
    });
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    changeFeed?: ChangeFeedListener;
    routeTable: { method: string; url: string; config: FastifyContextConfig }[];
  }
}
