import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { pingDb, type Database } from '@galaxie/db';
import { assertModule, Authenticator, type AuthenticatorOptions } from './auth/authenticator.js';
import { PgTenantStore, type TenantStore } from './auth/tenant-store.js';
import { ChangeFeedListener, type ChangeFeedOptions } from './cache/change-feed.js';
import { NoopCdnPurger, type CdnPurger } from './cache/purger.js';
import { MemoryResponseCache, RedisResponseCache, type ResponseCache } from './cache/store.js';
import type { AppContext, SemanticConfig } from './context.js';
import { ProblemError, problems, registerErrorHandling } from './errors.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './rate-limit.js';
import { docsRoutes } from './routes/docs.js';
import { mirrorRoutes } from './routes/mirror.js';
import { v1Routes } from './routes/v1/index.js';

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
  /** Piso editorial da semântica e pasta da base (SEMANTIC_MIN_REVIEW_STATUS, KNOWLEDGE_DIR). */
  semantic?: SemanticConfig;
}

/** Monta a API sem iniciar o listener — usado pelo main.ts e pelos testes (inject). */
export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
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
    ...(options.semantic ? { semantic: options.semantic } : {}),
  };

  registerErrorHandling(app);
  app.decorateRequest('tenant', null);

  // Autenticação, módulo do plano e rate limit — só para rotas que declaram `config.module`.
  app.addHook('onRequest', async (request, reply) => {
    const module = request.routeOptions.config?.module;
    if (!module) return;
    if (!authenticator) throw problems.degraded('Autenticação indisponível: banco de dados não configurado.');
    const header = request.headers['x-galaxie-key'];
    const tenant = await authenticator.authenticate(Array.isArray(header) ? header[0] : header);
    request.tenant = tenant;
    assertModule(tenant, module);

    const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
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
  });

  if (options.changeFeed && options.db) {
    const listener = new ChangeFeedListener(options.db, cache, options.cdnPurger ?? new NoopCdnPurger(), {
      ...(typeof options.changeFeed === 'object' ? options.changeFeed : {}),
      logger: app.log,
    });
    app.decorate('changeFeed', listener);
    app.addHook('onReady', async () => listener.start());
    app.addHook('onClose', async () => listener.stop());
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    changeFeed?: ChangeFeedListener;
  }
}
