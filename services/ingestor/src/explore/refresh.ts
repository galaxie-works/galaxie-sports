/**
 * Job `explore-summary` (#596): recalcula o resumo da home "Explorar" (`@galaxie/explore`) e grava em
 * `core.explore_summary`, para a API responder sem a consulta pesada (um ano de jogos) no caminho da requisição.
 * Roda a cada minuto e só recalcula quando precisa (`exploreRefreshReason`): sem resumo, resumo com 10 min, jogo que
 * mudou de status ou jogo novo na janela desde a última conta.
 */
import type { Database } from '@galaxie/db';
import { computeExploreSnapshot, exploreRefreshReason, saveExploreSnapshot } from '@galaxie/explore';
import type { GeoConfig } from '@galaxie/geo';

export interface ExploreRefreshResult {
  /** null = estava em dia e não recalculou. */
  reason: string | null;
  rows: number;
  generatedAt: Date | null;
  ms: number;
}

export async function refreshExploreSummary(
  db: Database,
  geo: GeoConfig,
  options: { now?: Date; force?: boolean } = {},
): Promise<ExploreRefreshResult> {
  const now = options.now ?? new Date();
  const started = performance.now();
  const reason = options.force ? 'pedido (--forcar)' : await exploreRefreshReason(db, now);
  if (!reason)
    return { reason: null, rows: 0, generatedAt: null, ms: Math.round(performance.now() - started) };
  const snapshot = await computeExploreSnapshot(db, geo, now);
  const rows = await saveExploreSnapshot(db, snapshot);
  return { reason, rows, generatedAt: snapshot.generatedAt, ms: Math.round(performance.now() - started) };
}
