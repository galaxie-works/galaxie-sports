/**
 * Job `explore-summary` (#596): recalcula o resumo da home "Explorar" (`@galaxie/explore`) e grava em
 * `core.explore_summary`, para a API responder sem a consulta pesada (a janela de jogos) no caminho da requisição.
 * Roda a cada minuto e só recalcula quando precisa (`exploreRefreshReason`): sem resumo, resumo com 10 min ou, passado
 * o freio (EXPLORE_MIN_INTERVAL_SEC, padrão 180 s) desde a última conta, jogo que mudou de status ou jogo novo na
 * janela. Sem nada a fazer, são duas ou três consultas por índice (docs/runbooks/alertas-e-monitoramento.md › CPU dos jobs por minuto).
 */
import type { Database } from '@galaxie/db';
import {
  computeExploreSnapshot,
  exploreMinIntervalMs,
  exploreRefreshReason,
  saveExploreSnapshot,
} from '@galaxie/explore';
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
  geo: GeoConfig | (() => GeoConfig),
  options: { now?: Date; force?: boolean; minIntervalMs?: number } = {},
): Promise<ExploreRefreshResult> {
  const now = options.now ?? new Date();
  const started = performance.now();
  const reason = options.force
    ? 'pedido (--forcar)'
    : await exploreRefreshReason(db, now, { minIntervalMs: options.minIntervalMs ?? exploreMinIntervalMs() });
  if (!reason)
    return { reason: null, rows: 0, generatedAt: null, ms: Math.round(performance.now() - started) };
  const snapshot = await computeExploreSnapshot(db, typeof geo === 'function' ? geo() : geo, now);
  const rows = await saveExploreSnapshot(db, snapshot);
  return { reason, rows, generatedAt: snapshot.generatedAt, ms: Math.round(performance.now() - started) };
}
