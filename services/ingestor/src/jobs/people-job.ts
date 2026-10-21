import type { PlanRules } from '@galaxie/apisports-client';
import { compareCompetitions, covers, type CatalogSource } from './catalog-source.js';
import { cursorId, type CursorRef, type CursorStore } from './runtime/cursor-store.js';
import type { RawSource } from './runtime/raw-source.js';
import { plannedRequest, type JobSpec, type PlannedRequest } from './runtime/runner.js';
import { selectSeasons, type SeasonsOptions } from './seasons-job.js';
import { latestTeamsByLeague } from './teams.js';

/** Máximo de pessoas por chamada em trophies?players= / sidelined?players= (e coachs=). */
export const PEOPLE_PER_CALL = 20;

/** Chamadas por time (sem temporada: trazem o histórico inteiro) — docs/03 §3, passo 5. */
export const TEAM_ENDPOINTS = [
  { step: 'squads', endpoint: '/players/squads' },
  { step: 'coachs', endpoint: '/coachs' },
  { step: 'transfers', endpoint: '/transfers' },
] as const;

/** Chamadas em lote por pessoa — docs/03 §3, passo 6. */
export const PERSON_ENDPOINTS = [
  { step: 'trophies-jogadores', endpoint: '/trophies', kind: 'player' },
  { step: 'sidelined-jogadores', endpoint: '/sidelined', kind: 'player' },
  { step: 'trophies-tecnicos', endpoint: '/trophies', kind: 'coach' },
  { step: 'sidelined-tecnicos', endpoint: '/sidelined', kind: 'coach' },
] as const;

export type PersonKind = 'player' | 'coach';

export interface PeopleOptions {
  /** Tiers cujos times recebem squads/coachs/transfers (padrão 2). */
  teamMaxTier?: number | undefined;
  /** Tiers cujos elencos atuais recebem trophies/sidelined (padrão 1). */
  personMaxTier?: number | undefined;
  /** Inclui h2h dos clássicos da base semântica (padrão true). */
  derbies?: boolean | undefined;
  /** Estatísticas por temporada (players?league&season, 20 por página) das competições tier 1. */
  playerStats?: boolean | undefined;
  /** Profundidade de temporadas para as estatísticas de jogadores (mesmas regras do bootstrap:seasons). */
  seasons?: SeasonsOptions | undefined;
}

export interface TeamTarget {
  teamId: number;
  tier: number;
}

/** Times-alvo: lista mais recente de cada competição no raw, sem repetir, tier 1 primeiro. */
export async function teamTargets(
  catalog: CatalogSource,
  raw: RawSource,
  maxTier: number,
): Promise<TeamTarget[]> {
  const comps = (await catalog.competitions(maxTier)).sort(compareCompetitions);
  const latest = await latestTeamsByLeague(
    raw,
    comps.map((c) => c.leagueId),
  );
  const out = new Map<number, TeamTarget>();
  for (const c of comps) {
    for (const t of latest.get(c.leagueId)?.teams ?? []) {
      const prev = out.get(t.id);
      if (!prev || prev.tier > c.tier) out.set(t.id, { teamId: t.id, tier: c.tier });
    }
  }
  return [...out.values()].sort((a, b) => a.tier - b.tier || a.teamId - b.teamId);
}

/** Ordem: tier, depois squads → coachs → transfers (os elencos tier 1 chegam primeiro). */
export function buildTeamRequests(teams: TeamTarget[]): PlannedRequest[] {
  const tiers = [...new Set(teams.map((t) => t.tier))].sort((a, b) => a - b);
  const out: PlannedRequest[] = [];
  for (const tier of tiers) {
    for (const e of TEAM_ENDPOINTS) {
      for (const t of teams.filter((x) => x.tier === tier)) {
        out.push(plannedRequest(e.step, 'football', e.endpoint, { team: t.teamId }));
      }
    }
  }
  return out;
}

interface SquadItem {
  team?: { id?: number };
  players?: { id?: number }[];
}

interface CoachItem {
  id?: number;
  career?: { team?: { id?: number }; end?: string | null }[];
}

/** Jogadores dos elencos atuais (players/squads?team) e técnicos atuais (coachs?team) já gravados no raw. */
export async function peopleOfTeams(
  raw: RawSource,
  teamIds: Set<number>,
): Promise<{ players: number[]; coaches: number[] }> {
  const players = new Set<number>();
  for await (const e of raw.latest({ sport: 'football', endpoint: '/players/squads', has: ['team'] })) {
    if (!teamIds.has(Number(e.params.team))) continue;
    for (const s of (Array.isArray(e.response) ? e.response : []) as SquadItem[]) {
      for (const p of s.players ?? []) if (typeof p.id === 'number') players.add(p.id);
    }
  }
  const coaches = new Set<number>();
  for await (const e of raw.latest({ sport: 'football', endpoint: '/coachs', has: ['team'] })) {
    const teamId = Number(e.params.team);
    if (!teamIds.has(teamId)) continue;
    for (const c of (Array.isArray(e.response) ? e.response : []) as CoachItem[]) {
      const current = c.career?.some((j) => j.team?.id === teamId && !j.end);
      if (current && typeof c.id === 'number') coaches.add(c.id);
    }
  }
  return {
    players: [...players].sort((a, b) => a - b),
    coaches: [...coaches].sort((a, b) => a - b),
  };
}

export function personCursor(endpoint: string, kind: PersonKind, id: number): CursorRef {
  return { sport: 'football', endpoint, key: `${kind}=${id}` };
}

/** Lotes de 20 pessoas; uma chamada conclui 20 cursores (um por pessoa). */
export function buildPersonRequests(
  step: string,
  endpoint: string,
  kind: PersonKind,
  ids: number[],
): PlannedRequest[] {
  const param = kind === 'player' ? 'players' : 'coachs';
  const out: PlannedRequest[] = [];
  for (let i = 0; i < ids.length; i += PEOPLE_PER_CALL) {
    const batch = ids.slice(i, i + PEOPLE_PER_CALL);
    out.push(
      plannedRequest(
        step,
        'football',
        endpoint,
        { [param]: batch.join('-') },
        { cursors: batch.map((id) => personCursor(endpoint, kind, id)) },
      ),
    );
  }
  return out;
}

/** Feitos e pendentes separados antes de formar os lotes (um lote nunca mistura os dois). */
export async function buildPersonPhase(
  people: { players: number[]; coaches: number[] },
  cursors: CursorStore,
  staleBefore?: Date,
): Promise<PlannedRequest[]> {
  const out: PlannedRequest[] = [];
  for (const e of PERSON_ENDPOINTS) {
    const ids = e.kind === 'player' ? people.players : people.coaches;
    const states = await cursors.load(ids.map((id) => personCursor(e.endpoint, e.kind, id)));
    const isDone = (id: number) => {
      const at = states.get(cursorId(personCursor(e.endpoint, e.kind, id)))?.completedAt;
      return !!at && (!staleBefore || at >= staleBefore);
    };
    out.push(...buildPersonRequests(e.step, e.endpoint, e.kind, ids.filter(isDone)));
    out.push(
      ...buildPersonRequests(
        e.step,
        e.endpoint,
        e.kind,
        ids.filter((id) => !isDone(id)),
      ).map((r) => (staleBefore ? { ...r, staleBefore } : r)),
    );
  }
  return out;
}

/** h2h de cada clássico (histórico completo de confrontos numa chamada). */
export function buildDerbyRequests(pairKeys: string[], step = 'h2h-classicos'): PlannedRequest[] {
  return pairKeys.map((h2h) => plannedRequest(step, 'football', '/fixtures/headtohead', { h2h }));
}

/**
 * Job #15: elencos, técnicos, transferências, títulos, afastamentos, h2h dos clássicos e — opcionalmente —
 * estatísticas de jogadores por temporada (tier 1). Lê do raw o que as fases anteriores trouxeram.
 */
export function peopleJob(
  catalog: CatalogSource,
  raw: RawSource,
  cursors: CursorStore,
  plan: PlanRules,
  now: () => Date,
  derbyPairs: () => Promise<string[]>,
  opts: PeopleOptions = {},
): JobSpec {
  const teamMaxTier = opts.teamMaxTier ?? 2;
  const personMaxTier = opts.personMaxTier ?? 1;
  const phases: JobSpec['phases'] = [
    {
      name: 'times (squads · coachs · transfers)',
      build: async () => buildTeamRequests(await teamTargets(catalog, raw, teamMaxTier)),
    },
    {
      name: 'pessoas (trophies · sidelined)',
      build: async () => {
        const teams = await teamTargets(catalog, raw, personMaxTier);
        return buildPersonPhase(await peopleOfTeams(raw, new Set(teams.map((t) => t.teamId))), cursors);
      },
    },
  ];
  if (opts.derbies ?? true) {
    phases.push({ name: 'h2h dos clássicos', build: async () => buildDerbyRequests(await derbyPairs()) });
  }
  if (opts.playerStats) {
    const seasonsOf = async () => {
      const out: { league: number; season: number }[] = [];
      for (const c of await catalog.competitions(1)) {
        for (const s of selectSeasons(c, plan.current, now(), opts.seasons ?? {})) {
          if (covers(s.coverage, 'players')) out.push({ league: c.leagueId, season: s.year });
        }
      }
      return out;
    };
    phases.push(
      {
        name: 'estatísticas de jogadores (página 1)',
        build: async () =>
          (await seasonsOf()).map((x) =>
            plannedRequest('players', 'football', '/players', {
              league: x.league,
              season: x.season,
              page: 1,
            }),
          ),
      },
      {
        name: 'estatísticas de jogadores (demais páginas)',
        build: async () => {
          const wanted = new Set((await seasonsOf()).map((x) => `${x.league}|${x.season}`));
          const out: PlannedRequest[] = [];
          for await (const e of raw.latest({
            sport: 'football',
            endpoint: '/players',
            has: ['league', 'season'],
            where: { page: '1' },
          })) {
            if (!wanted.has(`${e.params.league}|${e.params.season}`)) continue;
            for (let page = 2; page <= (e.paging?.total ?? 1); page++) {
              out.push(
                plannedRequest('players', 'football', '/players', {
                  league: e.params.league,
                  season: e.params.season,
                  page,
                }),
              );
            }
          }
          return out;
        },
      },
    );
  }
  return { job: 'bootstrap:people', priority: 'BOOTSTRAP', phases };
}
