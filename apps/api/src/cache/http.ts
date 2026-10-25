import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cacheControl } from './policy.js';
import type { CachedResponse, ResponseCache } from './store.js';
import { validatedInput } from '../util.js';

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

/**
 * `Vary` das respostas cacheadas. A resposta depende do tenant (plano, operadora, lista de canais), e o tenant
 * vem da chave secreta ou, nos widgets, da chave publicável: as duas entram, para um cache compartilhado
 * (CDN) nunca servir a resposta de um tenant a outro. A publicável é a mesma para todos os torcedores do
 * widget de uma operadora, então a CDN ainda guarda uma cópia por operadora (por isso não `private`).
 */
export const CACHE_VARY = 'Accept-Language, x-galaxie-key, x-galaxie-publishable-key';

/** Teto do header `surrogate-key`: clientes HTTP (undici/Node) recusam cabeçalhos acima de 16 KB no total. */
export const SURROGATE_KEY_MAX = 8 * 1024;

/**
 * Valor do header `surrogate-key`: todas as tags quando cabem; acima do teto (ex.: /v1/events/live com
 * centenas de jogos), só as tags de coleção (sem `:`), que já cobrem o purge por tipo. As tags completas
 * continuam no índice de tags do cache; só o header da resposta fica limitado.
 */
export function surrogateKeyHeader(tags: readonly string[], max = SURROGATE_KEY_MAX): string {
  const all = tags.join(' ');
  if (all.length <= max) return all;
  return [...new Set(tags.filter((t) => !t.includes(':')))].join(' ');
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

/**
 * Chave do cache: método, caminho, query e as partes de `vary`. A query é a já validada pelo schema da rota
 * (`parseInput`): parâmetro desconhecido (`?x=<aleatório>`) não cria entrada nova nem vai ao banco. Rota
 * que não valida a query cai na query bruta (nunca junta respostas diferentes numa chave só).
 */
export function cacheKeyFor(request: FastifyRequest, vary: string[] = []): string {
  const [path] = request.url.split('?');
  const parsed = validatedInput(request.query);
  const query = Object.entries((parsed ?? request.query ?? {}) as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, parsed === undefined ? String(v) : v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256')
    .update(JSON.stringify([request.method, path, query, vary]))
    .digest('base64url');
}

/**
 * Teto do Cache-Control no HIT de uma entrada sem `ttl` (gravada antes do campo existir): não se sabe se ela
 * nasceu com o TTL da rota ou com um menor (ao vivo, quadro de medalhas), então a CDN e o navegador só a
 * guardam por pouco tempo. Some sozinho quando essas entradas expiram no Valkey.
 */
export const LEGACY_ENTRY_TTL_SEC = 10;

/**
 * TTL a anunciar no HIT: o que resta do TTL com que a entrada foi gravada (nunca o da rota, que pode ser
 * maior: o detalhe de um jogo ao vivo é gravado por 10 s numa rota de 1 h). Nunca passa do TTL da entrada,
 * mesmo com o relógio desta instância atrás do da que gravou (`storedAt` no futuro).
 */
export function remainingTtl(
  entry: Pick<CachedResponse, 'storedAt' | 'ttl'>,
  routeTtl: number,
  now = Date.now(),
): number {
  if (entry.ttl == null) return Math.min(routeTtl, LEGACY_ENTRY_TTL_SEC);
  return Math.min(entry.ttl, Math.max(0, Math.ceil(entry.ttl - (now - entry.storedAt) / 1000)));
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
  let readable = true;
  try {
    entry = await cache.get(key);
  } catch (err) {
    readable = false;
    request.log.warn({ err }, 'cache indisponível (leitura)');
  }

  let ttl: number;
  if (entry) {
    reply.header('x-galaxie-cache', 'HIT');
    ttl = remainingTtl(entry, options.ttl);
  } else {
    // marca d'água dos purges antes de ler o banco: purge que cair durante o load recusa a gravação
    // (com o cache fora do ar na leitura, não insiste: a gravação abaixo cai no mesmo erro, ou grava sem a checagem)
    let since: number | undefined;
    if (readable) {
      try {
        since = await cache.purgeMark();
      } catch (err) {
        request.log.warn({ err }, 'cache indisponível (leitura)');
      }
    }
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
      ttl,
    };
    reply.header('x-galaxie-cache', 'MISS');
    if (loaded.store !== false && ttl > 0) {
      try {
        // recusada: uma tag da resposta foi purgada durante o load, então ela pode ser anterior à mudança;
        // sai sem cache compartilhado (a próxima requisição monta de novo)
        if (!(await cache.set(key, entry, ttl, since))) ttl = 0;
      } catch (err) {
        request.log.warn({ err }, 'cache indisponível (escrita)');
      }
    }
  }

  options.check?.(entry.meta ?? {});
  for (const [k, v] of Object.entries(entry.headers ?? {})) reply.header(k, v);
  reply.header('etag', entry.etag).header('cache-control', cacheControl(ttl)).header('vary', CACHE_VARY);
  if (entry.tags.length) reply.header('surrogate-key', surrogateKeyHeader(entry.tags));

  if (matchesEtag(request.headers['if-none-match'], entry.etag)) return reply.code(304).send();
  return reply
    .code(entry.status)
    .header('content-type', entry.contentType ?? 'application/json; charset=utf-8')
    .send(entry.body);
}
