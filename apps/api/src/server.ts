import Fastify, { type FastifyContextConfig, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { MediaDenylist } from '@galaxie/apisports-client';
import { pingDb, type Database } from '@galaxie/db';
import { loadWtwConfig, type WtwConfig } from '@galaxie/where-to-watch';
import { AdminGuard, type AdminGuardOptions } from './admin/guard.js';
import { loadPlans, type PlanCatalog } from './admin/plans.js';
import { adminRoutes } from './admin/routes.js';
import {
  assertModule,
  Authenticator,
  type AuthenticatorOptions,
  type TenantContext,
} from './auth/authenticator.js';
import {
  assertPublishableRoute,
  PgPublishableStore,
  PublishableAuthenticator,
  publishableKeyFrom,
  requestOrigin,
  type PublishableAuthenticatorOptions,
  type PublishableStore,
} from './auth/publishable.js';
import { PgTenantStore, type TenantStore } from './auth/tenant-store.js';
import { AuthThrottle, type AuthThrottleOptions } from './auth/throttle.js';
import { RedisVerifiedKeyStore } from './auth/verified-keys.js';
import { ChangeFeedListener, type ChangeFeedOptions } from './cache/change-feed.js';
import { NoopCdnPurger, type CdnPurger } from './cache/purger.js';
import { MemoryResponseCache, RedisResponseCache, type ResponseCache } from './cache/store.js';
import type { AppContext, SemanticConfig } from './context.js';
import {
  DbCustomLogos,
  StaticCustomLogos,
  VariantResponseCache,
  type CustomLogos,
} from './assets/custom-logos.js';
import { ProblemError, problems, registerErrorHandling } from './errors.js';
import { RulesRegistry } from './events/rules-registry.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './rate-limit.js';
import {
  apiKeyFrom,
  queryKeyUsed,
  QUERY_KEY_DEPRECATION_HEADERS,
  registerRealtime,
  streamTokenFrom,
  type RealtimeOptions,
} from './realtime/index.js';
import { StreamTokenSigner } from './realtime/stream-token.js';
import { docsRoutes } from './routes/docs.js';
import { internalWhereToWatchRoutes } from './routes/internal/where-to-watch.js';
import { Lineup, type LineupOptions } from './lineup/availability.js';
import { ClientChannelLists } from './channel-list/lists.js';
import { mirrorRoutes } from './routes/mirror.js';
import { apiLoggerOptions, registerObservability } from './observability.js';
import { accountRoutes } from './routes/v1/account.js';
import { v1Routes } from './routes/v1/index.js';
import { registerCors, type CorsOptions } from './security/cors.js';
import { registerSecurityHeaders, type SecurityHeadersOptions } from './security/headers.js';
import {
  MemoryUsageBackend,
  RedisUsageBackend,
  UsageCounter,
  utcDay,
  type UsageBackend,
} from './usage/counter.js';
import { QuotaGuard } from './usage/quota.js';
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
  /** Chaves publicáveis (`x-galaxie-publishable-key`); padrão: Postgres, quando há db. */
  publishableStore?: PublishableStore;
  publishableAuthenticator?: PublishableAuthenticatorOptions;
  /**
   * Limite de tentativas de autenticação fora do cache, por IP e por prefixo, antes do banco e do
   * scrypt (AUTH_ATTEMPTS_PER_MINUTE, padrão 60). `false` desliga (só testes).
   */
  authThrottle?: AuthThrottleOptions | false;
  /**
   * Rate limit da chave publicável, por chave × IP (todas as rotas somadas), por janela.
   * Padrão 60 (PUBLISHABLE_RATE_LIMIT_PER_MINUTE); nunca acima do limite do tenant.
   */
  publishableRateLimitPerMinute?: number;
  cache?: ResponseCache;
  rateLimiter?: RateLimiter;
  /** Janela do rate limit (ms). Padrão 60 s; o limite vem do tenant (rate_limit_per_minute). */
  rateLimitWindowMs?: number;
  cdnPurger?: CdnPurger;
  /** Escuta `ops.change_feed` e purga o cache (requer db). */
  changeFeed?: boolean | ChangeFeedOptions;
  /** ASSETS_PUBLIC_BASE_URL. */
  assetsBaseUrl?: string;
  /**
   * Flag ASSETS_CUSTOM_LOGOS (acervo customizado de logos): `true` relê do banco a cada 15 s (requer db);
   * um `CustomLogos` fixo nos testes. Ausente = desligada.
   */
  customLogos?: boolean | CustomLogos;
  /** URL pública anunciada no OpenAPI. */
  publicUrl?: string;
  /** Configuração do onde assistir (padrão: carregada de config/ na primeira rota interna que usar). */
  wtwConfig?: WtwConfig;
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
  /** Grade de canais e ofertas: piso editorial (LINEUP_MIN_REVIEW_STATUS) e consultas (fixas nos testes). */
  lineup?: LineupOptions;
}

/** Limite fixo da chave secreta de teste, por rota (docs/politica-de-chaves.md §1). */
export const TEST_KEY_RATE_LIMIT_PER_MINUTE = 60;

/** Rota no contador de uso: as de chave de teste ganham o prefixo `test:` (contadas à parte). */
export const usageRoute = (env: 'live' | 'test', route: string) => (env === 'test' ? `test:${route}` : route);

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

  const baseCache =
    options.cache ??
    (options.redis ? new RedisResponseCache(options.redis, prefix) : new MemoryResponseCache());
  const logos: CustomLogos =
    typeof options.customLogos === 'object'
      ? options.customLogos
      : options.customLogos && options.db
        ? new DbCustomLogos(options.db, {
            onError: (err) =>
              app.log.warn({ err }, 'flag ASSETS_CUSTOM_LOGOS indisponível; mantendo a última'),
          })
        : new StaticCustomLogos(false);
  if (logos instanceof DbCustomLogos) {
    app.addHook('onReady', async () => logos.start());
    app.addHook('onClose', async () => logos.stop());
  }
  // a versão da flag dos logos entra na chave: trocar a flag não serve resposta velha
  const cache = new VariantResponseCache(baseCache, logos);
  const limiter =
    options.rateLimiter ??
    (options.redis ? new RedisRateLimiter(options.redis, prefix) : new MemoryRateLimiter());
  const windowMs = options.rateLimitWindowMs ?? 60_000;
  const throttle =
    options.authThrottle === false
      ? undefined
      : new AuthThrottle(limiter, {
          windowMs,
          ...options.authThrottle,
          onError: (err) => app.log.warn({ err }, 'limite de tentativas de autenticação indisponível'),
        });
  const store = options.tenantStore ?? (options.db ? new PgTenantStore(options.db) : undefined);
  const authenticator = store
    ? new Authenticator(store, {
        ...(throttle ? { throttle } : {}),
        // chaves já verificadas, compartilhadas entre instâncias: instância nova não as trata como ataque
        ...(options.redis ? { verifiedKeys: new RedisVerifiedKeyStore(options.redis, prefix) } : {}),
        ...options.authenticator,
      })
    : undefined;
  const realtimeOptions: RealtimeOptions = typeof options.realtime === 'object' ? options.realtime : {};
  // token curto do SSE (POST /v1/stream/token → /v1/stream?token=): só com o tempo real ligado
  const streamTokens =
    options.realtime && options.db
      ? new StreamTokenSigner({ secret: realtimeOptions.streamTokenSecret })
      : undefined;
  // `?key=` no SSE (obsoleto): um aviso por tenant por dia UTC
  const queryKeyWarned = new Set<string>();
  const publishableStore =
    options.publishableStore ?? (options.db ? new PgPublishableStore(options.db) : undefined);
  const publishable = publishableStore
    ? new PublishableAuthenticator(publishableStore, {
        ...(throttle ? { throttle } : {}),
        ...options.publishableAuthenticator,
      })
    : undefined;
  const publishableLimit = options.publishableRateLimitPerMinute ?? 60;
  let wtwConfig = options.wtwConfig;
  const adminGuard = options.admin?.keyHashes.length ? new AdminGuard(options.admin) : undefined;
  const ctx: AppContext = {
    db: options.db,
    cache,
    assetsBaseUrl: options.assetsBaseUrl,
    logos,
    adminGuard,
    wtwConfig: () => (wtwConfig ??= loadWtwConfig()),
    rules: new RulesRegistry(options.rulesDir),
    mediaDenylist: options.mediaDenylist,
    now: options.now ?? (() => new Date()),
    ...(options.semantic ? { semantic: options.semantic } : {}),
    lineup: new Lineup(options.lineup),
    channelLists: new ClientChannelLists(),
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

  const quota = usageBackend
    ? new QuotaGuard(usageBackend, {
        ...(options.now ? { now: options.now } : {}),
        // o total do dia soma o consolidado no Postgres: uma perda do Valkey não zera a cota
        ...(options.db ? { db: options.db } : {}),
      })
    : undefined;
  // um evento (log) por tenant, dia e nível: o aviso de 80% e o corte de 110% (alerta e e-mail ficam com quem
  // consome os logs; a API não envia e-mail)
  const quotaEvents = new Set<string>();
  const quotaEvent = (
    request: FastifyRequest,
    tenant: TenantContext,
    level: 'warn' | 'blocked',
    limit: number,
  ) => {
    const k = `${utcDay()}|${tenant.tenantId}|${level}`;
    if (quotaEvents.has(k)) return;
    if (quotaEvents.size > 10_000) quotaEvents.clear();
    quotaEvents.add(k);
    request.log.warn(
      { tenant: tenant.slug, quota: limit, event: level === 'warn' ? 'quota.warning' : 'quota.exceeded' },
      level === 'warn'
        ? 'cota diária: tenant passou de 80%'
        : 'cota diária: tenant passou de 110% (bloqueado)',
    );
  };

  registerErrorHandling(app);
  registerSecurityHeaders(app, options.security);
  if (options.cors?.origins.length || publishable)
    registerCors(app, options.cors ?? { origins: [] }, publishable);
  app.decorateRequest('tenant', null);
  app.decorateRequest('reauthenticate', null);

  // Autenticação, módulo do plano, uso e rate limit — rotas com `config.module` ou `config.authenticated`.
  // A chave secreta (`x-galaxie-key`) tem precedência; sem ela, vale a publicável, só para leitura.
  app.addHook('onRequest', async (request, reply) => {
    const module = request.routeOptions.config?.module;
    if (!module && !request.routeOptions.config?.authenticated) return;
    // ordem: chave secreta no header > token do SSE (`?token=`) > `?key=` (obsoleto) > chave publicável
    const streamToken = streamTokenFrom(request);
    const secretKey = streamToken ? undefined : apiKeyFrom(request);
    const pk = secretKey || streamToken ? undefined : publishableKeyFrom(request);
    let authenticate: (maxAgeMs?: number) => Promise<TenantContext>;
    const origin = pk ? requestOrigin(request) : undefined;
    if (streamToken) {
      if (!authenticator || !streamTokens)
        throw problems.degraded('Autenticação indisponível: banco de dados não configurado.');
      const claims = streamTokens.verify(streamToken);
      if (!claims)
        throw problems.invalidKey(
          'Token do stream inválido ou expirado: peça outro em POST /v1/stream/token.',
        );
      // o stream aberto revalida a CHAVE que pediu o token (revogação encerra em até 60 s)
      authenticate = async (maxAgeMs?: number) => {
        const ctx = await authenticator.authenticateProvenKey(claims.keyPrefix, claims.keyId, { maxAgeMs });
        if (ctx.tenantId !== claims.tenantId) throw problems.invalidKey();
        return ctx;
      };
    } else if (pk) {
      assertPublishableRoute(request);
      if (!publishable) throw problems.degraded('Autenticação indisponível: banco de dados não configurado.');
      authenticate = () => publishable.authenticate(pk, origin, { ip: request.ip });
    } else {
      if (!authenticator)
        throw problems.degraded('Autenticação indisponível: banco de dados não configurado.');
      authenticate = (maxAgeMs?: number) =>
        authenticator.authenticate(secretKey, { ip: request.ip, maxAgeMs });
    }
    const tenant = await authenticate();
    if (secretKey && queryKeyUsed(request)) {
      // `?key=` aceito até o Sunset; o cliente troca para o token curto (docs/05 §5.1)
      reply.headers(QUERY_KEY_DEPRECATION_HEADERS);
      const warnKey = `${utcDay()}|${tenant.tenantId}`;
      if (!queryKeyWarned.has(warnKey)) {
        if (queryKeyWarned.size > 10_000) queryKeyWarned.clear();
        queryKeyWarned.add(warnKey);
        request.log.warn(
          {
            tenant: tenant.slug,
            event: 'sse.query_key_deprecated',
            sunset: QUERY_KEY_DEPRECATION_HEADERS.sunset,
          },
          'SSE com a chave secreta em ?key= (obsoleto): o tenant precisa trocar para POST /v1/stream/token',
        );
      }
    }
    // só depois de a origem conferir com a chave (CORS da resposta)
    if (origin) request.publishableOrigin = origin;
    request.tenant = tenant;
    // conexões longas (SSE) revalidam a mesma chave periodicamente (revogação, suspensão, plano)
    request.reauthenticate = authenticate;
    if (module) assertModule(tenant, module);

    const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
    // cota diária de produção (a chave de teste fica fora): aviso a partir de 80%, 429 a partir de 110%
    if (quota && tenant.env === 'live' && tenant.dailyRequestQuota) {
      try {
        const q = await quota.check(tenant.tenantId, tenant.dailyRequestQuota);
        reply
          .header('x-galaxie-quota-limit', String(q.limit))
          .header('x-galaxie-quota-remaining', String(Math.max(0, q.limit - q.used)));
        if (q.level !== 'ok') {
          reply.header('x-galaxie-quota-warning', `${Math.floor((q.used / q.limit) * 100)}%`);
          quotaEvent(request, tenant, q.level, q.limit);
        }
        if (q.level === 'blocked') throw problems.quotaExceeded(q.limit, q.resetSec);
      } catch (err) {
        if (err instanceof ProblemError) throw err;
        // contadores indisponíveis não derrubam a API (fail-open), como o rate limit
        request.log.warn({ err }, 'cota diária indisponível');
      }
    }
    // chave de teste: uso contado à parte (`test:<rota>`), fora da cota e de qualquer cobrança
    usage?.record(tenant.tenantId, usageRoute(tenant.env, route));
    // publicável: limite próprio por chave × IP (o tráfego vem de muitos torcedores, não do backend);
    // secreta de teste: balde próprio por rota, com limite fixo (não consome o da produção)
    const [limitKey, limit] =
      tenant.keyKind === 'publishable'
        ? [`pk:${tenant.keyId}:${request.ip}`, Math.min(publishableLimit, tenant.rateLimitPerMinute)]
        : tenant.env === 'test'
          ? [
              `test:${tenant.tenantId}:${route}`,
              Math.min(TEST_KEY_RATE_LIMIT_PER_MINUTE, tenant.rateLimitPerMinute),
            ]
          : [`${tenant.tenantId}:${route}`, tenant.rateLimitPerMinute];
    try {
      const r = await limiter.hit(limitKey, limit, windowMs);
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
    await internalWhereToWatchRoutes(instance, ctx);
    await accountRoutes(instance, { db: options.db, usage: usageBackend });
  });

  if (options.admin?.keyHashes.length && options.db) {
    const guard = adminGuard!;
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
      options: realtimeOptions,
      tokens: streamTokens!,
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
