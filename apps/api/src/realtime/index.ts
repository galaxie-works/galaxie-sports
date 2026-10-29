import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Database } from '@galaxie/db';
import { ChangeStream, type ChangeStreamOptions } from './change-stream.js';
import { MemoryConnectionLimiter, RedisConnectionLimiter } from './connection-limiter.js';
import { redactKey, streamRoutes, type SseConnection, type SseMetrics, type SseOptions } from './sse.js';
import type { StreamTokenSigner } from './stream-token.js';

export type RealtimeOptions = SseOptions & Omit<ChangeStreamOptions, 'redis' | 'keyPrefix' | 'logger'>;

declare module 'fastify' {
  interface FastifyInstance {
    realtime?: ChangeStream;
  }
}

/**
 * Liga o tempo real à API: `GET /v1/stream` (SSE) e o ChangeStream (relay do change feed + fan-out
 * via Valkey). Requer banco; sem Valkey, o fan-out e o limite de conexões ficam locais à instância.
 */
export function registerRealtime(
  app: FastifyInstance,
  deps: {
    db: Database;
    redis?: Redis;
    keyPrefix: string;
    options: RealtimeOptions;
    tokens: StreamTokenSigner;
    metrics?: SseMetrics;
  },
): void {
  const stream = new ChangeStream(deps.db, {
    ...deps.options,
    ...(deps.redis ? { redis: deps.redis } : {}),
    keyPrefix: deps.keyPrefix,
    logger: app.log,
  });
  const limiter = deps.redis
    ? new RedisConnectionLimiter(deps.redis, deps.keyPrefix)
    : new MemoryConnectionLimiter();
  let open = new Set<SseConnection>();
  app.register(async (instance) => {
    open = await streamRoutes(instance, {
      db: deps.db,
      stream,
      limiter,
      options: deps.options,
      tokens: deps.tokens,
      metrics: deps.metrics,
    });
  });
  app.decorate('realtime', stream);
  app.addHook('onReady', async () => stream.start());
  // streams SSE são longos: encerra-os para o close do servidor não ficar esperando
  app.addHook('preClose', async () => {
    for (const conn of open) conn.close();
  });
  app.addHook('onClose', async () => stream.stop());
}

/** Chave da API: header `x-galaxie-key` ou, nas rotas que permitem (EventSource), `?key=` (obsoleto). */
export function apiKeyFrom(request: FastifyRequest): string | undefined {
  const header = request.headers['x-galaxie-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value || !request.routeOptions.config?.allowQueryKey) return value;
  const key = (request.query as Record<string, unknown> | undefined)?.key;
  return typeof key === 'string' ? key : undefined;
}

const queryParam = (request: FastifyRequest, name: string): string | undefined => {
  const value = (request.query as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value ? value : undefined;
};
const hasKeyHeader = (request: FastifyRequest) => !!request.headers['x-galaxie-key'];

/** A chave secreta desta requisição veio de `?key=` (e não do header)? */
export function queryKeyUsed(request: FastifyRequest): boolean {
  return (
    !hasKeyHeader(request) && !!request.routeOptions.config?.allowQueryKey && !!queryParam(request, 'key')
  );
}

/** Token curto do SSE (`?token=`), só nas rotas que o aceitam e sem a chave no header. */
export function streamTokenFrom(request: FastifyRequest): string | undefined {
  if (!request.routeOptions.config?.allowStreamToken || hasKeyHeader(request)) return undefined;
  return queryParam(request, 'token');
}

/** Início do aviso de obsolescência do `?key=` no SSE (decisão de 28/10/2026) e o fim, 60 dias depois. */
export const QUERY_KEY_DEPRECATED_AT = new Date('2026-10-28T00:00:00Z');
export const QUERY_KEY_SUNSET_AT = new Date('2026-12-27T00:00:00Z');
/** RFC 9745 (Deprecation) e RFC 8594 (Sunset), com o link para a documentação do token. */
export const QUERY_KEY_DEPRECATION_HEADERS = {
  deprecation: `@${Math.floor(QUERY_KEY_DEPRECATED_AT.getTime() / 1000)}`,
  sunset: QUERY_KEY_SUNSET_AT.toUTCString(),
  link: '</docs>; rel="deprecation"; type="text/html"',
} as const;

/** Serializador de requisição para o logger que não vaza `?key=` nem `?token=`. */
export const requestLogSerializer = (req: FastifyRequest) => ({
  method: req.method,
  url: redactKey(req.url),
  host: req.host,
  remoteAddress: req.ip,
  remotePort: req.socket?.remotePort ?? 0,
});

export { ChangeStream } from './change-stream.js';
export { GapCursor } from './gap-cursor.js';
export { scopeChange, toRealtimeChange, topicsForTenant, TOPIC_MODULE } from './changes.js';
