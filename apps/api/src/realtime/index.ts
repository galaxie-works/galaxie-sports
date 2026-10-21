import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Database } from '@galaxie/db';
import { ChangeStream, type ChangeStreamOptions } from './change-stream.js';
import { MemoryConnectionLimiter, RedisConnectionLimiter } from './connection-limiter.js';
import { redactKey, streamRoutes, type SseConnection, type SseOptions } from './sse.js';

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
  deps: { db: Database; redis?: Redis; keyPrefix: string; options: RealtimeOptions },
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
    open = await streamRoutes(instance, { db: deps.db, stream, limiter, options: deps.options });
  });
  app.decorate('realtime', stream);
  app.addHook('onReady', async () => stream.start());
  // streams SSE são longos: encerra-os para o close do servidor não ficar esperando
  app.addHook('preClose', async () => {
    for (const conn of open) conn.close();
  });
  app.addHook('onClose', async () => stream.stop());
}

/** Chave da API: header `x-galaxie-key` ou, nas rotas que permitem (EventSource), `?key=`. */
export function apiKeyFrom(request: FastifyRequest): string | undefined {
  const header = request.headers['x-galaxie-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value || !request.routeOptions.config?.allowQueryKey) return value;
  const key = (request.query as Record<string, unknown> | undefined)?.key;
  return typeof key === 'string' ? key : undefined;
}

/** Serializador de requisição para o logger que não vaza `?key=`. */
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
