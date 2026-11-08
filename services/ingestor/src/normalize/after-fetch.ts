/**
 * Gancho `afterFetch` que leva cada resposta buscada pelos jobs direto ao core (issue #14 e #19):
 * o detalhe das partidas (`fixtures?id=`/`ids=` → `event_incident`, escalações, estatísticas e jogadores
 * em `football_fixture.detail`), as agendas (`fixtures?date=`), times, elencos e tabelas. Usa a mesma
 * normalização do `normalize:football` (idempotente), com o instante da coleta original como observação
 * — uma resposta antiga do cache nunca sobrescreve um estado mais novo.
 *
 * Palpites, odds e casas de apostas (`/predictions`, `/odds`, `/odds/bookmakers`, de qualquer esporte) vão para
 * `core.event_prediction` / `core.event_odds` / `core.bookmaker` pelo gravador próprio (`upsertMarkets`).
 *
 * Falha na normalização não derruba o job: o raw já está gravado e o `normalize:football` noturno
 * tenta de novo.
 */
import type { Database } from '@galaxie/db';
import {
  MARKETS_ENDPOINTS,
  normalizeFootballEnvelope,
  normalizeMarketsEnvelope,
  normalizeSportEnvelope,
  type ApiSportsOtherSport,
  type EnvelopeLike,
} from '@galaxie/providers';
import {
  addMarketsStats,
  addStats,
  emptyMarketsStats,
  emptyStats,
  upsertBatch,
  upsertMarkets,
  type MarketsStats,
  type UpsertOptions,
  type UpsertStats,
} from '@galaxie/core-writer';
import type { AfterFetch } from '../jobs/runtime/runner.js';

export interface NormalizeAfterFetchOptions extends UpsertOptions {
  /** Endpoints normalizados (padrão: todos os do futebol que alimentam o core). */
  endpoints?: readonly string[] | undefined;
  onError?: ((err: unknown, endpoint: string, params: Record<string, string>) => void) | undefined;
  /**
   * Também normaliza as respostas dos outros 11 esportes (`normalizeSportEnvelope`), sem esperar o
   * `normalize-sports` de hora em hora. Só a lista do dia (`/games`, `/fights`, `/races`) entra aqui; o resto
   * continua com o job de normalização.
   */
  otherSports?: boolean | undefined;
}

/** Endpoints dos outros esportes normalizados direto no gancho (a lista do dia). */
const OTHER_SPORT_LIST_ENDPOINTS = new Set(['/games', '/fights', '/races']);
const MARKETS = new Set<string>(MARKETS_ENDPOINTS);

export interface NormalizeAfterFetchReport {
  responses: number;
  normalized: number;
  empty: number;
  skipped: number;
  errors: number;
  stats: UpsertStats;
  /** Palpites, odds e casas gravados. */
  markets: MarketsStats;
}

export function normalizeAfterFetch(
  db: Database,
  options: NormalizeAfterFetchOptions = {},
): { afterFetch: AfterFetch; report: () => NormalizeAfterFetchReport } {
  const report: NormalizeAfterFetchReport = {
    responses: 0,
    normalized: 0,
    empty: 0,
    skipped: 0,
    errors: 0,
    stats: emptyStats(),
    markets: emptyMarketsStats(),
  };
  const allowed = options.endpoints ? new Set(options.endpoints) : null;
  const afterFetch: AfterFetch = async (envelope, request) => {
    report.responses += 1;
    if (MARKETS.has(request.endpoint) && (!allowed || allowed.has(request.endpoint))) {
      try {
        const normalized = normalizeMarketsEnvelope(
          request.sport,
          request.endpoint,
          envelope as EnvelopeLike,
          request.fetchedAt,
          request.params,
        );
        if (!normalized) report.skipped += 1;
        else if (normalized.items === 0) report.empty += 1;
        else {
          report.markets = addMarketsStats(report.markets, await upsertMarkets(db, normalized.batch));
          report.normalized += 1;
        }
      } catch (err) {
        report.errors += 1;
        options.onError?.(err, request.endpoint, request.params);
      }
      return;
    }
    const other =
      request.sport !== 'football' &&
      !!options.otherSports &&
      OTHER_SPORT_LIST_ENDPOINTS.has(request.endpoint);
    if ((request.sport !== 'football' && !other) || (allowed && !allowed.has(request.endpoint))) {
      report.skipped += 1;
      return;
    }
    try {
      const normalized = other
        ? normalizeSportEnvelope(
            request.sport as ApiSportsOtherSport,
            request.endpoint,
            envelope as EnvelopeLike,
            request.fetchedAt,
            request.params,
          )
        : normalizeFootballEnvelope(
            request.endpoint,
            envelope as EnvelopeLike,
            request.fetchedAt,
            request.params,
          );
      if (!normalized) {
        report.skipped += 1;
        return;
      }
      // resposta vazia não é dado novo: mantém o último estado válido
      if (normalized.items === 0) {
        report.empty += 1;
        return;
      }
      report.stats = addStats(report.stats, await upsertBatch(db, normalized.batch, options));
      report.normalized += 1;
    } catch (err) {
      report.errors += 1;
      options.onError?.(err, request.endpoint, request.params);
    }
  };
  return { afterFetch, report: () => report };
}
