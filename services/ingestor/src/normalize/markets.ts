/**
 * Palpites e odds do raw para o core (docs/04 §2.4): `/predictions`, `/odds` e `/odds/bookmakers`.
 *
 * O caminho normal é o gancho `afterFetch` do job que busca (o espelho diário, `sync:mirror`); isto é a
 * reconstrução a partir do raw (`normalize:markets`), para a primeira carga e para refazer depois de uma falha.
 * Resposta vazia não é dado novo: mantém o último estado.
 */
import { eq } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';
import { MARKETS_ENDPOINTS, normalizeMarketsEnvelope, type EnvelopeLike } from '@galaxie/providers';
import { addMarketsStats, emptyMarketsStats, upsertMarkets, type MarketsStats } from '@galaxie/core-writer';
import { latestSuccessfulResponses } from './raw-runner.js';

export interface MarketsFromRawResult {
  responses: number;
  normalized: number;
  empty: number;
  errors: number;
  stats: MarketsStats;
}

export async function normalizeMarketsFromRaw(
  db: Database,
  sport: string,
  options: { provider?: string; afterId?: number; onError?: (err: unknown, rawId: number) => void } = {},
): Promise<MarketsFromRawResult> {
  const out: MarketsFromRawResult = {
    responses: 0,
    normalized: 0,
    empty: 0,
    errors: 0,
    stats: emptyMarketsStats(),
  };
  const latest = await latestSuccessfulResponses(db, {
    provider: options.provider ?? 'api-sports',
    sport,
    // as casas antes das odds: a odd liga a casa que a lista já criou com o nome
    endpoints: [...MARKETS_ENDPOINTS],
    afterId: options.afterId ?? 0,
  });
  const order = (e: string) => (e === '/odds/bookmakers' ? 0 : 1);
  latest.sort((a, b) => order(a.endpoint) - order(b.endpoint));
  for (const row of latest) {
    out.responses += 1;
    try {
      const [raw] = await db
        .select({ body: apiResponse.body })
        .from(apiResponse)
        .where(eq(apiResponse.id, Number(row.id)));
      const params = Object.fromEntries(Object.entries(row.params ?? {}).map(([k, v]) => [k, String(v)]));
      const normalized = normalizeMarketsEnvelope(
        sport,
        row.endpoint,
        (raw?.body ?? { response: [] }) as EnvelopeLike,
        new Date(row.fetched_at),
        params,
      );
      if (!normalized) continue;
      if (normalized.items === 0) {
        out.empty += 1;
        continue;
      }
      out.stats = addMarketsStats(out.stats, await upsertMarkets(db, normalized.batch));
      out.normalized += 1;
    } catch (err) {
      out.errors += 1;
      options.onError?.(err, Number(row.id));
    }
  }
  return out;
}
