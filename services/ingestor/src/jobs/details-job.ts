import type { PlanLimits, PlanRules } from '@galaxie/apisports-client';
import { mapFootballStatus } from '@galaxie/providers';
import { coversFixtureDetail, type CatalogSource, type CompetitionInfo } from './catalog-source.js';
import {
  collectFixtures,
  FINISHED_STATUSES,
  H2H_LISTS,
  isDecisive,
  pairKey,
  SEASON_LISTS,
  type FixtureRef,
} from './fixtures.js';
import { cursorId, type CursorRef, type CursorStore } from './runtime/cursor-store.js';
import type { RawQuery, RawSource } from './runtime/raw-source.js';
import { plannedRequest, type JobSpec, type PlannedRequest } from './runtime/runner.js';

/** Máximo de IDs por chamada em fixtures?ids= (planos pagos). */
export const IDS_PER_CALL = 20;

/** Todas as agendas diárias (fixtures?date=) já gravadas. */
export const DATE_LISTS: RawQuery = {
  sport: 'football',
  endpoint: '/fixtures',
  has: ['date'],
  lacks: ['id', 'ids', 'live', 'league'],
};

export type DetailScope = 'auto' | 'all' | 'key';

export interface DetailOptions {
  maxTier?: number | undefined;
  /**
   * auto: no free só clássicos e jogos decisivos (1 chamada por jogo); nos pagos, todas as encerradas.
   * all: todas as encerradas em qualquer plano. key: só clássicos e decisivos.
   */
  scope?: DetailScope | undefined;
  /** Máximo de partidas planejadas nesta execução. */
  limit?: number | undefined;
  leagues?: number[] | undefined;
}

export interface RankedFixture extends FixtureRef {
  /** 0 = tier 1 · 1 = clássico fora do tier 1 · 2 = tier 2. */
  rank: number;
  derby: boolean;
  current: boolean;
}

/** Cursor de detalhe de uma partida — compartilhado entre o bootstrap (#14) e o sync diário (#19). */
export function detailCursor(fixtureId: number): CursorRef {
  return { sport: 'football', endpoint: '/fixtures', key: `id=${fixtureId}` };
}

/**
 * Prioridade de detalhe: tier 1 → clássicos (de qualquer competição) → tier 2; o resto fica de fora.
 * Temporadas com `coverage` sem eventos, escalações e estatísticas não recebem detalhe.
 */
export function rankFixture(
  f: FixtureRef,
  comps: Map<number, CompetitionInfo>,
  derbies: Set<string>,
): RankedFixture | null {
  const comp = comps.get(f.leagueId);
  const season = comp?.seasons.find((s) => s.year === f.season);
  if (comp && season && !coversFixtureDetail(season.coverage)) return null;
  const derby = f.homeId != null && f.awayId != null && derbies.has(pairKey(f.homeId, f.awayId));
  let rank: number;
  if (comp?.tier === 1) rank = 0;
  else if (derby) rank = 1;
  else if (comp?.tier === 2) rank = 2;
  else return null;
  return { ...f, rank, derby, current: season?.current ?? false };
}

export function compareRanked(a: RankedFixture, b: RankedFixture): number {
  return (
    a.rank - b.rank || Number(b.current) - Number(a.current) || b.date.localeCompare(a.date) || a.id - b.id
  );
}

/**
 * Jogo que a lista deixou em andamento (1H, HT, 2H, ET, P...) mas começou antes de `before`: a lista foi
 * gravada no meio do jogo e não foi rebuscada; o detalhe traz o resultado. Suspenso/interrompido fica de
 * fora (pode ser retomado depois, e o detalhe só é buscado uma vez).
 */
export function isStaleOpen(f: FixtureRef, before: Date): boolean {
  const status = mapFootballStatus(f.status);
  return (status === 'live' || status === 'break') && Date.parse(f.date) < before.getTime();
}

/** Encerradas, priorizadas, opcionalmente só clássicos e decisivos. */
export function selectDetailFixtures(
  fixtures: FixtureRef[],
  comps: Map<number, CompetitionInfo>,
  derbies: Set<string>,
  opts: {
    keyOnly: boolean;
    leagues?: number[] | undefined;
    /** Também as que a lista deixou em andamento e começaram antes disto (`isStaleOpen`). */
    openStartedBefore?: Date | undefined;
  },
): RankedFixture[] {
  const only = opts.leagues?.length ? new Set(opts.leagues) : undefined;
  const out: RankedFixture[] = [];
  for (const f of fixtures) {
    const stale = opts.openStartedBefore ? isStaleOpen(f, opts.openStartedBefore) : false;
    if (!FINISHED_STATUSES.has(f.status) && !stale) continue;
    if (only && !only.has(f.leagueId)) continue;
    const r = rankFixture(f, comps, derbies);
    if (!r) continue;
    if (opts.keyOnly && !r.derby && !isDecisive(r.round)) continue;
    out.push(r);
  }
  return out.sort(compareRanked);
}

/** Lotes de 20 (`ids=`) nos planos pagos; 1 chamada por jogo (`id=`) quando o plano bloqueia `ids`. */
export function buildDetailRequests(
  fixtureIds: number[],
  limits: PlanLimits,
  step = 'detalhe',
): PlannedRequest[] {
  if (limits.forbiddenParams.includes('ids')) {
    return fixtureIds.map((id) => plannedRequest(step, 'football', '/fixtures', { id }));
  }
  const out: PlannedRequest[] = [];
  for (let i = 0; i < fixtureIds.length; i += IDS_PER_CALL) {
    const batch = fixtureIds.slice(i, i + IDS_PER_CALL);
    out.push(
      plannedRequest(
        step,
        'football',
        '/fixtures',
        { ids: batch.join('-') },
        { cursors: batch.map(detailCursor) },
      ),
    );
  }
  return out;
}

/**
 * Separa as partidas já detalhadas (cursor concluído) das pendentes antes de montar os lotes, para que
 * um lote nunca misture as duas — assim o plano mostra o feito e o que falta na mesma unidade (chamadas).
 */
export async function splitDone(
  fixtureIds: number[],
  cursors: CursorStore,
): Promise<{ done: number[]; pending: number[] }> {
  const states = await cursors.load(fixtureIds.map(detailCursor));
  const done: number[] = [];
  const pending: number[] = [];
  for (const id of fixtureIds)
    (states.get(cursorId(detailCursor(id)))?.completedAt ? done : pending).push(id);
  return { done, pending };
}

export function keyOnlyFor(scope: DetailScope, limits: PlanLimits): boolean {
  if (scope === 'all') return false;
  if (scope === 'key') return true;
  return limits.forbiddenParams.includes('ids'); // auto: free (sem ids) → só clássicos e decisivos
}

/** Job #14: detalhe das partidas encerradas conhecidas pelo raw (listas de temporada, h2h e agendas). */
export function detailsJob(
  catalog: CatalogSource,
  raw: RawSource,
  cursors: CursorStore,
  plan: PlanRules,
  derbyKeys: () => Promise<Set<string>>,
  opts: DetailOptions = {},
): JobSpec {
  return {
    job: 'bootstrap:details',
    priority: 'BOOTSTRAP',
    phases: [
      {
        name: 'detalhe de partidas',
        build: async () => {
          const comps = new Map(
            (await catalog.competitions(opts.maxTier ?? 2)).map((c) => [c.leagueId, c] as const),
          );
          const fixtures = await collectFixtures(raw, [SEASON_LISTS, H2H_LISTS, DATE_LISTS]);
          const ranked = selectDetailFixtures(fixtures, comps, await derbyKeys(), {
            keyOnly: keyOnlyFor(opts.scope ?? 'auto', plan.current),
            leagues: opts.leagues,
          });
          const { done, pending } = await splitDone(
            ranked.map((f) => f.id),
            cursors,
          );
          const todo = opts.limit !== undefined ? pending.slice(0, opts.limit) : pending;
          return [...buildDetailRequests(done, plan.current), ...buildDetailRequests(todo, plan.current)];
        },
      },
    ],
  };
}
