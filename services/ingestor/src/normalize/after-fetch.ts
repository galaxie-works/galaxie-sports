/**
 * Gancho `afterFetch` que leva cada resposta buscada pelos jobs direto ao core (issue #14 e #19):
 * o detalhe das partidas (`fixtures?id=`/`ids=` → `event_incident`, escalações, estatísticas e jogadores
 * em `football_fixture.detail`), as agendas (`fixtures?date=`), times, elencos e tabelas. Usa a mesma
 * normalização do `normalize:football` (idempotente), com o instante da coleta original como observação
 * — uma resposta antiga do cache nunca sobrescreve um estado mais novo.
 *
 * Falha na normalização não derruba o job: o raw já está gravado e o `normalize:football` noturno
 * tenta de novo.
 */
import type { Database } from '@galaxie/db';
import { normalizeFootballEnvelope, type EnvelopeLike } from '@galaxie/providers';
import type { AfterFetch } from '../jobs/runtime/runner.js';
import { addStats, emptyStats, upsertBatch, type UpsertOptions, type UpsertStats } from './upsert-core.js';

export interface NormalizeAfterFetchOptions extends UpsertOptions {
  /** Endpoints normalizados (padrão: todos os do futebol que alimentam o core). */
  endpoints?: readonly string[] | undefined;
  onError?: ((err: unknown, endpoint: string, params: Record<string, string>) => void) | undefined;
}

export interface NormalizeAfterFetchReport {
  responses: number;
  normalized: number;
  empty: number;
  skipped: number;
  errors: number;
  stats: UpsertStats;
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
  };
  const allowed = options.endpoints ? new Set(options.endpoints) : null;
  const afterFetch: AfterFetch = async (envelope, request) => {
    report.responses += 1;
    if (request.sport !== 'football' || (allowed && !allowed.has(request.endpoint))) {
      report.skipped += 1;
      return;
    }
    try {
      const normalized = normalizeFootballEnvelope(
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
