import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import { normalizeParams, requestHash, ttlFor } from '@galaxie/apisports-client';
import { MIRROR_SPORTS, type MirrorEnvelope, type MirrorSport } from '@galaxie/contracts';
import { apiResponse, backfillRequest, type Database } from '@galaxie/db';
import { assertSport } from '../auth/authenticator.js';
import { sendCached } from '../cache/http.js';
import { requireDb, type AppContext } from '../context.js';
import { problems } from '../errors.js';
import { parseInput } from '../util.js';

const PROVIDER = 'api-sports';
const SPORTS = new Set<string>(MIRROR_SPORTS);
const ENDPOINT_RE = /^[a-z0-9][a-z0-9/_-]{0,99}$/;
const KEY_ORDER = ['get', 'parameters', 'errors', 'results', 'paging', 'response'];

/** Rota `/mirror/:sport/*`: o endpoint (curinga) é validado com ENDPOINT_RE no handler. */
const MirrorRouteParams = z.object({ sport: z.string().max(40), '*': z.string().max(200).default('') });

/**
 * Query do espelho: nomes e valores livres (são os parâmetros do fornecedor), mas limitados — no
 * máximo 20 parâmetros, nome `[A-Za-z0-9_-]{1,40}`, valor até 200 caracteres. Evita que combinações
 * arbitrárias encham `api.backfill_request`.
 */
const MirrorQuery = z
  .record(
    z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'nome de parâmetro inválido'),
    z.union([z.string().max(200), z.array(z.string().max(200)).max(5)]),
  )
  .refine((q) => Object.keys(q).length <= 20, 'no máximo 20 parâmetros');

/** TTL do espelho: o mesmo frescor que o cliente da api-sports usa para o endpoint, entre 15 s e 24 h. */
export function mirrorTtlSec(endpoint: string, params: Record<string, string>, now = new Date()): number {
  const ms = ttlFor(endpoint, params, now);
  return Math.round(Math.min(Math.max(Number.isFinite(ms) ? ms : Infinity, 15_000), 24 * 3600_000) / 1000);
}

/** O JSONB não preserva a ordem das chaves; devolvemos o envelope na ordem da api-sports. */
export function orderEnvelope(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const rec = body as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) if (k in rec) ordered[k] = rec[k];
  for (const [k, v] of Object.entries(rec)) if (!(k in ordered)) ordered[k] = v;
  return ordered;
}

/** Envelope vazio no formato da api-sports (combinação ainda não obtida do fornecedor). */
export function emptyEnvelope(endpoint: string, params: Record<string, string>): MirrorEnvelope {
  return {
    get: endpoint.replace(/^\//, ''),
    parameters: Object.keys(params).length ? params : [],
    errors: [],
    results: 0,
    paging: { current: 1, total: 1 },
    response: [],
  };
}

/** Query string → parâmetros do fornecedor (valores repetidos: vale o último). */
function queryParams(query: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    const value = Array.isArray(v) ? v.at(-1) : v;
    if (value !== undefined) out[k] = String(value);
  }
  return normalizeParams(out);
}

async function latestRaw(db: Database, sport: string, endpoint: string, hash: string) {
  const success = sql`(${apiResponse.errors} is null or ${apiResponse.errors} in ('[]'::jsonb, '{}'::jsonb))`;
  const [row] = await db
    .select({ body: apiResponse.body, fetchedAt: apiResponse.fetchedAt })
    .from(apiResponse)
    .where(
      and(
        eq(apiResponse.provider, PROVIDER),
        eq(apiResponse.sport, sport),
        eq(apiResponse.endpoint, endpoint),
        eq(apiResponse.requestHash, hash),
        gte(apiResponse.statusCode, 200),
        lt(apiResponse.statusCode, 300),
        success,
      ),
    )
    .orderBy(desc(apiResponse.fetchedAt))
    .limit(1);
  return row;
}

/** Agenda a combinação para o backfill ADHOC (idempotente: repetições só somam `hits`). */
export async function enqueueBackfill(
  db: Database,
  input: {
    sport: string;
    endpoint: string;
    params: Record<string, string>;
    hash: string;
    tenantId: string | null;
  },
): Promise<void> {
  await db
    .insert(backfillRequest)
    .values({
      provider: PROVIDER,
      sport: input.sport,
      endpoint: input.endpoint,
      params: input.params,
      requestHash: input.hash,
      tenantId: input.tenantId,
    })
    .onConflictDoUpdate({
      target: backfillRequest.requestHash,
      set: {
        hits: sql`${backfillRequest.hits} + 1`,
        lastRequestedAt: sql`now()`,
        status: sql`case when ${backfillRequest.status} = 'done' then 'pending' else ${backfillRequest.status} end`,
      },
    });
}

/**
 * Espelho compatível `/mirror/{sport}/{endpoint}` (docs/05 §2): serve o raw mais recente da mesma
 * requisição com o envelope original. Nunca chama o fornecedor; sem dado → `results: 0`, `miss` e backfill.
 */
export async function mirrorRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/mirror/:sport/*', { config: { module: 'core_data' } }, async (request, reply) => {
    const { sport, '*': rest } = parseInput(MirrorRouteParams, request.params);
    if (!SPORTS.has(sport)) throw problems.notFound('Esporte do espelho');
    const path = rest.replace(/\/+$/, '');
    if (!ENDPOINT_RE.test(path))
      throw problems.invalidParams([{ path: 'endpoint', message: 'endpoint inválido' }]);
    if (request.tenant) assertSport(request.tenant, sport);

    const endpoint = `/${path}`;
    const params = queryParams(parseInput(MirrorQuery, request.query ?? {}));
    const hash = requestHash(PROVIDER, sport as MirrorSport, endpoint, params);
    const assetBase = ctx.assetsBaseUrl ? { 'x-galaxie-asset-base': ctx.assetsBaseUrl } : undefined;

    return sendCached(request, reply, ctx.cache, {
      ttl: mirrorTtlSec(endpoint, params),
      vary: [hash],
      load: async () => {
        const db = requireDb(ctx);
        const raw = await latestRaw(db, sport, endpoint, hash);
        if (raw) {
          return {
            body: orderEnvelope(raw.body),
            tags: [`api_response:${hash}`],
            headers: {
              'x-galaxie-source': 'raw-hit',
              'x-galaxie-fetched-at': raw.fetchedAt.toISOString(),
              ...assetBase,
            },
          };
        }
        await enqueueBackfill(db, {
          sport,
          endpoint,
          params,
          hash,
          tenantId: request.tenant?.tenantId ?? null,
        }).catch((err) => request.log.warn({ err }, 'espelho: falha ao agendar backfill'));
        return {
          body: emptyEnvelope(endpoint, params),
          tags: [`api_response:${hash}`],
          headers: { 'x-galaxie-source': 'miss', ...assetBase },
          ttl: 0,
          store: false,
        };
      },
    });
  });
}
