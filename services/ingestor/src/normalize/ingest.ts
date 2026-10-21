/**
 * Ponte entre a camada de provedores e o core: qualquer `SportsDataProvider` entrega um
 * `ProviderResult`; aqui ele vira upsert (dado válido) ou *last-known-good* (falha/vazio).
 */
import type { Database } from '@galaxie/db';
import type { FailureReason, MachineOptions, ProviderResult } from '@galaxie/providers';
import { applyProviderFailure } from './event-state.js';
import { emptyStats, upsertBatch, type UpsertOptions, type UpsertStats } from './upsert-core.js';

export interface IngestContext {
  provider: string;
  sport: string;
  /**
   * IDs (do provedor) dos eventos que a consulta deveria trazer — ex.: o jogo pedido em
   * `getEventDetail`. Se a fonte falhar, vier vazia ou não trouxer algum deles, eles ficam stale.
   */
  expectedEventIds?: string[];
}

export interface IngestResult {
  outcome: 'upserted' | 'kept_last_valid';
  stats: UpsertStats;
  staleEvents: number;
}

export async function ingestProviderResult(
  db: Database,
  result: ProviderResult,
  ctx: IngestContext,
  options: UpsertOptions & { machine?: MachineOptions } = {},
): Promise<IngestResult> {
  const expected = ctx.expectedEventIds ?? [];
  const markStale = async (ids: string[], reason: FailureReason) =>
    ids.length
      ? (
          await applyProviderFailure(
            db,
            { provider: ctx.provider, sport: ctx.sport, providerEventIds: ids, at: result.fetchedAt, reason },
            options.machine,
          )
        ).changed
      : 0;

  if (result.status === 'error') {
    return {
      outcome: 'kept_last_valid',
      stats: emptyStats(),
      staleEvents: await markStale(expected, result.error.kind),
    };
  }
  if (result.status === 'empty') {
    return {
      outcome: 'kept_last_valid',
      stats: emptyStats(),
      staleEvents: await markStale(expected, 'empty_payload'),
    };
  }
  const stats = await upsertBatch(db, result.batch, options);
  const returned = new Set(result.batch.events.map((e) => e.id));
  const missing = expected.filter((id) => !returned.has(id));
  return { outcome: 'upserted', stats, staleEvents: await markStale(missing, 'missing_event') };
}
