import type { PlanLimits, PlanRules } from '@galaxie/apisports-client';
import {
  compareCompetitions,
  covers,
  type CatalogSource,
  type CompetitionInfo,
  type CoverageFlag,
  type SeasonInfo,
} from './catalog-source.js';
import { pairKey } from './fixtures.js';
import type { RawSource } from './runtime/raw-source.js';
import { dedupeRequests, plannedRequest, type JobSpec, type PlannedRequest } from './runtime/runner.js';
import { teamsOfSeason } from './teams.js';

export interface SeasonsOptions {
  /** Maior tier incluído (padrão 2: tier 1 e 2 do catálogo). */
  maxTier?: number | undefined;
  /** Temporadas acessíveis mais recentes por competição tier 1 (padrão: todas). */
  tier1Seasons?: number | undefined;
  /** Idem para tier ≥ 2 (padrão 3: atual + 2, docs/03 §3). */
  tier2Seasons?: number | undefined;
  /** Restringe a estas ligas (IDs da api-sports). */
  leagues?: number[] | undefined;
  /** Reconstrói a temporada atual das ligas tier 1 via h2h quando o plano não dá acesso a ela (free). */
  h2hCurrentSeason?: boolean | undefined;
}

/** Chamadas por competição × temporada, com a flag de `coverage` que as condiciona (docs/03 §3, passo 2). */
export const SEASON_ENDPOINTS: {
  step: string;
  endpoint: string;
  extra?: Record<string, string>;
  flag?: CoverageFlag;
}[] = [
  { step: 'teams', endpoint: '/teams' },
  { step: 'fixtures', endpoint: '/fixtures' },
  { step: 'rounds', endpoint: '/fixtures/rounds', extra: { dates: 'true' } },
  { step: 'standings', endpoint: '/standings', flag: 'standings' },
  { step: 'injuries', endpoint: '/injuries', flag: 'injuries' },
  { step: 'topscorers', endpoint: '/players/topscorers', flag: 'top_scorers' },
  { step: 'topassists', endpoint: '/players/topassists', flag: 'top_assists' },
  { step: 'topyellowcards', endpoint: '/players/topyellowcards', flag: 'top_cards' },
  { step: 'topredcards', endpoint: '/players/topredcards', flag: 'top_cards' },
];

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function seasonAccessible(year: number, limits: PlanLimits): boolean {
  return !limits.seasons || (year >= limits.seasons.min && year <= limits.seasons.max);
}

/**
 * Temporadas a buscar de uma competição: já iniciadas, acessíveis no plano vigente (free: 2022–2024),
 * da mais recente para a mais antiga, limitadas pela profundidade do tier.
 */
export function selectSeasons(
  c: CompetitionInfo,
  limits: PlanLimits,
  now: Date,
  opts: SeasonsOptions = {},
): SeasonInfo[] {
  const started = c.seasons.filter((s) => !s.startDate || s.startDate <= today(now));
  const accessible = started.filter((s) => seasonAccessible(s.year, limits)).sort((a, b) => b.year - a.year);
  const depth = c.tier <= 1 ? opts.tier1Seasons : (opts.tier2Seasons ?? 3);
  return depth === undefined ? accessible : accessible.slice(0, depth);
}

function filterLeagues(comps: CompetitionInfo[], opts: SeasonsOptions): CompetitionInfo[] {
  const only = opts.leagues?.length ? new Set(opts.leagues) : undefined;
  return comps.filter((c) => !only || only.has(c.leagueId)).sort(compareCompetitions);
}

/**
 * Plano das listas por temporada. Ordem: tier, depois "recência" (a temporada mais recente de cada
 * competição antes da segunda mais recente de qualquer outra), depois `live_priority` — se a cota acabar,
 * o que ficou para amanhã é o menos importante.
 */
export function buildSeasonRequests(
  comps: CompetitionInfo[],
  limits: PlanLimits,
  now: Date,
  opts: SeasonsOptions = {},
): PlannedRequest[] {
  const pairs: { c: CompetitionInfo; s: SeasonInfo; rank: number; order: number }[] = [];
  filterLeagues(comps, opts).forEach((c, order) =>
    selectSeasons(c, limits, now, opts).forEach((s, rank) => pairs.push({ c, s, rank, order })),
  );
  pairs.sort((a, b) => a.c.tier - b.c.tier || a.rank - b.rank || a.order - b.order);

  const out: PlannedRequest[] = [];
  for (const { c, s } of pairs) {
    for (const e of SEASON_ENDPOINTS) {
      const skip = e.flag && !covers(s.coverage, e.flag) ? ('no_coverage' as const) : undefined;
      out.push(
        plannedRequest(
          e.step,
          'football',
          e.endpoint,
          { league: c.leagueId, season: s.year, ...e.extra },
          skip ? { skip } : {},
        ),
      );
    }
  }
  // estádios: 1 chamada por país do catálogo (venues?country traz todos, sem temporada)
  const countries = [
    ...new Set(
      filterLeagues(comps, opts)
        .map((c) => c.countryName)
        .filter((n) => !!n),
    ),
  ];
  for (const country of countries)
    out.push(plannedRequest('venues', 'football', '/venues', { country: country! }));
  return out;
}

/**
 * Reconstrução da temporada atual via h2h (docs/03 §1.1) para ligas tier 1 cuja temporada atual o plano
 * não alcança por `season`: pares de times da temporada acessível mais recente (lista já no raw),
 * 1 chamada fixtures/headtohead por par — n·(n−1)/2 por liga (190 para 20 clubes).
 * Times promovidos na temporada atual não estão na lista antiga: seus jogos chegam pelo sync diário.
 */
export async function buildCurrentSeasonH2hRequests(
  comps: CompetitionInfo[],
  raw: RawSource,
  limits: PlanLimits,
  opts: SeasonsOptions = {},
): Promise<PlannedRequest[]> {
  if (!limits.seasons) return []; // plano pago: a temporada atual vem por season
  const out: PlannedRequest[] = [];
  for (const c of filterLeagues(comps, opts)) {
    if (c.tier !== 1 || c.type !== 'league') continue;
    const current = c.seasons.find((s) => s.current);
    if (!current || seasonAccessible(current.year, limits)) continue;
    const base = c.seasons.filter((s) => seasonAccessible(s.year, limits)).sort((a, b) => b.year - a.year)[0];
    if (!base) continue;
    const ids = (await teamsOfSeason(raw, c.leagueId, base.year)).map((t) => t.id).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        out.push(
          plannedRequest('h2h-temporada-atual', 'football', '/fixtures/headtohead', {
            h2h: pairKey(ids[i]!, ids[j]!),
          }),
        );
      }
    }
  }
  return dedupeRequests(out);
}

/** Job #13: listas por competição × temporada (+ reconstrução opcional via h2h). Prioridade BOOTSTRAP. */
export function seasonsJob(
  catalog: CatalogSource,
  raw: RawSource,
  plan: PlanRules,
  now: () => Date,
  opts: SeasonsOptions = {},
): JobSpec {
  const comps = () => catalog.competitions(opts.maxTier ?? 2);
  return {
    job: 'bootstrap:seasons',
    priority: 'BOOTSTRAP',
    phases: [
      {
        name: 'listas por temporada',
        build: async () => buildSeasonRequests(await comps(), plan.current, now(), opts),
      },
      ...(opts.h2hCurrentSeason
        ? [
            {
              name: 'temporada atual via h2h',
              build: async () => buildCurrentSeasonH2hRequests(await comps(), raw, plan.current, opts),
            },
          ]
        : []),
    ],
  };
}
