import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cacheControl } from './policy.js';
import type { CachedResponse, ResponseCache } from './store.js';

export interface Loaded {
  body: unknown;
  /** Tags para purge (ex.: `competition:<id>`, `competition`). */
  tags: string[];
  headers?: Record<string, string>;
  /** Sobrescreve o TTL da rota (s). */
  ttl?: number;
  /** false = não guardar no cache do Valkey (ainda recebe ETag). */
  store?: boolean;
  /** Corpo já serializado (string) com este Content-Type, em vez de JSON. */
  contentType?: string;
  /** Metadados internos guardados com a resposta (não enviados). */
  meta?: Record<string, string>;
}

export interface CachedRouteOptions {
  ttl: number;
  /** Partes que variam a resposta além de rota e query (locale resolvido, fuso...). */
  vary?: string[];
  load: () => Promise<Loaded>;
  /** Validação por requisição sobre os metadados (roda também no HIT; ex.: esporte fora do plano). */
  check?: (meta: Record<string, string>) => void;
}

export function etagOf(body: string): string {
  return `"${createHash('sha1').update(body).digest('base64url')}"`;
}

/** If-None-Match casa com o ETag atual? (aceita lista, `*` e validadores fracos) */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

export function cacheKeyFor(request: FastifyRequest, vary: string[] = []): string {
  const [path] = request.url.split('?');
  const query = Object.entries((request.query ?? {}) as Record<string, unknown>)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256')
    .update(JSON.stringify([request.method, path, query, vary]))
    .digest('base64url');
}

/**
 * Serve uma resposta JSON com cache no Valkey, ETag/304, Cache-Control e `surrogate-key`.
 * Falhas do cache nunca derrubam a requisição: a resposta é montada direto do banco.
 */
export async function sendCached(
  request: FastifyRequest,
  reply: FastifyReply,
  cache: ResponseCache,
  options: CachedRouteOptions,
): Promise<FastifyReply> {
  const key = cacheKeyFor(request, options.vary);
  let entry: CachedResponse | undefined;
  try {
    entry = await cache.get(key);
  } catch (err) {
    request.log.warn({ err }, 'cache indisponível (leitura)');
  }

  let ttl = options.ttl;
  if (entry) {
    reply.header('x-galaxie-cache', 'HIT');
    ttl = Math.max(0, Math.ceil(ttl - (Date.now() - entry.storedAt) / 1000));
  } else {
    const loaded = await options.load();
    const body =
      loaded.contentType && typeof loaded.body === 'string' ? loaded.body : JSON.stringify(loaded.body);
    ttl = loaded.ttl ?? options.ttl;
    entry = {
      status: 200,
      body,
      etag: etagOf(body),
      tags: loaded.tags,
      ...(loaded.headers ? { headers: loaded.headers } : {}),
      ...(loaded.contentType ? { contentType: loaded.contentType } : {}),
      ...(loaded.meta ? { meta: loaded.meta } : {}),
      storedAt: Date.now(),
    };
    reply.header('x-galaxie-cache', 'MISS');
    if (loaded.store !== false && ttl > 0) {
      try {
        await cache.set(key, entry, ttl);
      } catch (err) {
        request.log.warn({ err }, 'cache indisponível (escrita)');
      }
    }
  }

  options.check?.(entry.meta ?? {});
  for (const [k, v] of Object.entries(entry.headers ?? {})) reply.header(k, v);
  reply
    .header('etag', entry.etag)
    .header('cache-control', cacheControl(ttl))
    .header('vary', 'Accept-Language, x-galaxie-key');
  if (entry.tags.length) reply.header('surrogate-key', entry.tags.join(' '));

  if (matchesEtag(request.headers['if-none-match'], entry.etag)) return reply.code(304).send();
  return reply
    .code(entry.status)
    .header('content-type', entry.contentType ?? 'application/json; charset=utf-8')
    .send(entry.body);
}
