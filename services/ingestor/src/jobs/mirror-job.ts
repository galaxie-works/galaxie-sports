import type { ApiSport, PlanLimits, PlanRules } from '@galaxie/apisports-client';
import { PlanViolationError } from '@galaxie/apisports-client';
import {
  compareCompetitions,
  covers,
  type CatalogSource,
  type CompetitionInfo,
  type CoverageFlag,
} from './catalog-source.js';
import { collectFixtures, dateList } from './fixtures.js';
import { teamTargets, TEAM_ENDPOINTS } from './people-job.js';
import {
  attemptsOf,
  cursorId,
  MAX_ATTEMPTS,
  type CursorRef,
  type CursorStore,
} from './runtime/cursor-store.js';
import type { RawSource } from './runtime/raw-source.js';
import { plannedRequest, type JobSpec, type PlannedRequest } from './runtime/runner.js';
import { seasonAccessible } from './seasons-job.js';
import { teamsOfSeason } from './teams.js';

/**
 * Espelho da api-sports (sync:mirror): renova, no ritmo de cada endpoint, tudo o que o sync diário não busca.
 *
 * O sync diário cobre a agenda (fixtures/games?date=), o detalhe dos encerrados, a relista da temporada atual do
 * futebol e o rodízio de elencos/técnicos/transferências/títulos/afastamentos dos times tier 1. O resto entrava só
 * nas cargas manuais (bootstrap:seasons, bootstrap:sports, bootstrap:people) e ficava parado: tabela oficial,
 * artilharia, rodadas, times da temporada, lesões da temporada, estatísticas de time, estádios, palpites, odds,
 * referência e, nos outros 11 esportes, tudo além da agenda do dia.
 *
 * Cada item tem um período; o cursor (o mesmo das cargas manuais) diz quando ele foi buscado pela última vez e o
 * rodízio pega os mais velhos que o período, até o orçamento do dia de cada API. Os grupos de cada API vêm em
 * ordem de prioridade: o grupo seguinte só recebe o que sobrou do orçamento.
 *
 * Fica de fora o que já tem dono: fixtures?date= / fixtures?id= / fixtures?league&season (sync diário),
 * players?league&season (números dos jogadores) e o rodízio tier 1 de pessoas (sync diário).
 */

const DAY_MS = 86_400_000;
/**
 * Endpoints por jogo encerrado: um por dia enquanto o jogo está na janela de FINISHED_LOOKBACK_DAYS (no máximo 3
 * buscas). A correção do fornecedor nas horas seguintes e a resposta vazia logo depois do fim entram na seguinte.
 */
const PER_GAME_DAYS = 1;
/** Temporada em jogo: começa em até 14 dias e não terminou há mais de 7 (mesma regra da relista do sync diário). */
const AHEAD_DAYS = 14;
const AFTER_END_DAYS = 7;
/** Jogos encerrados destes últimos dias recebem os endpoints por jogo (o sync diário grava a agenda de D-1). */
export const FINISHED_LOOKBACK_DAYS = 3;
/** Jogos que começam nestas próximas horas recebem palpites e odds. */
export const UPCOMING_HOURS = 48;
/** Ids por chamada nos endpoints que aceitam `ids` (lote). */
export const IDS_PER_CALL = 10;

export interface MirrorCandidate {
  item: PlannedRequest;
  periodDays: number;
}

/** Grupo de prioridade de uma API: os grupos são atendidos em ordem com o orçamento que sobrar. */
export interface MirrorGroup {
  name: string;
  candidates: MirrorCandidate[];
}

const cand = (
  step: string,
  sport: ApiSport,
  endpoint: string,
  params: Record<string, string | number>,
  periodDays: number,
  cursors?: CursorRef[],
): MirrorCandidate => ({
  item: plannedRequest(step, sport, endpoint, params, cursors ? { cursors } : {}),
  periodDays,
});

const byTier = (tier: number, tier1: number, others: number) => (tier <= 1 ? tier1 : others);

function utcDate(d: Date, offsetDays = 0): string {
  return new Date(d.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** Temporada em jogo (a atual, ou a próxima que começa em até 14 dias, até 7 dias depois do fim). */
export function inPlay(
  s: { current: boolean; startDate: string | null; endDate: string | null },
  now: Date,
): boolean {
  if (!s.current && !s.startDate) return false;
  if (s.startDate && s.startDate > utcDate(now, AHEAD_DAYS)) return false;
  if (s.endDate && s.endDate < utcDate(now, -AFTER_END_DAYS)) return false;
  return true;
}

/** Orçamento do espelho por API e por dia: 20% da cota nos planos pagos (Ultra 15.000, Pro 1.500); free 10. */
export function mirrorBudget(limits: PlanLimits): number {
  if (limits.seasons) return 10;
  return Math.floor(limits.dailyLimit * 0.2);
}

/** Tira o que o plano vigente recusaria (temporada fora da janela, parâmetro proibido): não ocupa vaga no rodízio. */
export function allowedByPlan(c: MirrorCandidate, plan: PlanRules, now: Date): boolean {
  try {
    plan.validate(c.item.params, now);
    return true;
  } catch (err) {
    if (err instanceof PlanViolationError) return false;
    throw err;
  }
}

/**
 * Rodízio por grupos: dentro de cada grupo, nunca buscados primeiro (na ordem dada), depois os mais velhos que o
 * período. O que já foi renovado hoje conta no orçamento (reexecutar no mesmo dia não gasta de novo).
 */
export async function rotateGroups(
  groups: MirrorGroup[],
  cursors: CursorStore,
  now: Date,
  limit: number,
  opts: { force?: boolean | undefined } = {},
): Promise<PlannedRequest[]> {
  const all = groups.flatMap((g) => g.candidates);
  const states = await cursors.load(all.flatMap((c) => c.item.cursors));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let left = limit;
  const out: PlannedRequest[] = [];
  for (const g of groups) {
    const aged: { item: PlannedRequest; age: number; i: number }[] = [];
    g.candidates.forEach((c, i) => {
      // falhou MAX_ATTEMPTS vezes sem concluir: o runner não tenta de novo, então não ocupa vaga no orçamento
      const given = c.item.cursors.some((ref) => {
        const st = states.get(cursorId(ref));
        return !st?.completedAt && attemptsOf(st) >= MAX_ATTEMPTS;
      });
      if (given && !opts.force) return;
      const staleBefore = new Date(now.getTime() - c.periodDays * DAY_MS);
      const age = Math.min(
        ...c.item.cursors.map((ref) => states.get(cursorId(ref))?.completedAt?.getTime() ?? -Infinity),
      );
      // --forcar: o período não vale (renova de novo o que já está em dia), só o orçamento
      if (!opts.force) {
        if (age >= today) left -= 1;
        if (age >= staleBefore.getTime()) return;
      }
      // --forcar: sem o cache do raw também (maxAgeMs 0), senão a resposta ruim de hoje voltaria do cache
      aged.push({ item: { ...c.item, staleBefore, ...(opts.force ? { maxAgeMs: 0 } : {}) }, age, i });
    });
    if (left <= 0) continue;
    const picked = aged.sort((a, b) => a.age - b.age || a.i - b.i).slice(0, left);
    left -= picked.length;
    out.push(...picked.map((a) => a.item));
  }
  return out;
}

// ─── futebol ─────────────────────────────────────────────────────────────────────────────────────

/** Por competição × temporada em jogo: período em dias (tier 1, demais) e a flag de `coverage`. */
export const FOOTBALL_SEASON_ENDPOINTS: {
  step: string;
  endpoint: string;
  extra?: Record<string, string>;
  flag?: CoverageFlag;
  period: [number, number];
}[] = [
  { step: 'standings', endpoint: '/standings', flag: 'standings', period: [1, 2] },
  { step: 'injuries', endpoint: '/injuries', flag: 'injuries', period: [1, 3] },
  { step: 'topscorers', endpoint: '/players/topscorers', flag: 'top_scorers', period: [1, 3] },
  { step: 'topassists', endpoint: '/players/topassists', flag: 'top_assists', period: [1, 3] },
  { step: 'topyellowcards', endpoint: '/players/topyellowcards', flag: 'top_cards', period: [3, 7] },
  { step: 'topredcards', endpoint: '/players/topredcards', flag: 'top_cards', period: [3, 7] },
  { step: 'rounds', endpoint: '/fixtures/rounds', extra: { dates: 'true' }, period: [7, 7] },
  { step: 'teams', endpoint: '/teams', period: [7, 14] },
];

/** Referência do futebol sem parâmetros (o /leagues já vem todo dia no sync diário). */
export const FOOTBALL_REFERENCE = [
  '/timezone',
  '/countries',
  '/leagues/seasons',
  '/teams/countries',
  '/players/seasons',
  '/odds/bookmakers',
  '/odds/bets',
  '/odds/live/bets',
] as const;

const UPCOMING = new Set(['TBD', 'NS']);

export interface FootballMirrorOptions {
  /** Maior tier com as chamadas por temporada (padrão 3: todo o catálogo). */
  seasonTier?: number | undefined;
  /** Maior tier com estatísticas de time, palpites e odds (padrão 2). */
  detailTier?: number | undefined;
  /** Maior tier com elencos/técnicos/transferências no rodízio (padrão 3; o tier 1 é do sync diário). */
  teamTier?: number | undefined;
}

export async function footballGroups(
  catalog: CatalogSource,
  raw: RawSource,
  limits: PlanLimits,
  now: Date,
  derbyPairs: () => Promise<string[]>,
  opts: FootballMirrorOptions = {},
): Promise<MirrorGroup[]> {
  const seasonTier = opts.seasonTier ?? 3;
  const detailTier = opts.detailTier ?? 2;
  const comps = [...(await catalog.competitions(seasonTier))].sort(compareCompetitions);
  const playing: { c: CompetitionInfo; s: CompetitionInfo['seasons'][number] }[] = [];
  for (const c of comps)
    for (const s of c.seasons) if (inPlay(s, now) && seasonAccessible(s.year, limits)) playing.push({ c, s });

  const reference: MirrorCandidate[] = FOOTBALL_REFERENCE.map((e) =>
    cand('referencia', 'football', e, {}, 7),
  );
  // tier 3 (mais de mil competições) num grupo próprio, depois de odds e estatísticas, com o dobro do período
  const season: MirrorCandidate[] = [];
  const seasonTier3: MirrorCandidate[] = [];
  for (const { c, s } of playing) {
    for (const e of FOOTBALL_SEASON_ENDPOINTS) {
      if (e.flag && !covers(s.coverage, e.flag)) continue;
      const period = c.tier >= 3 ? e.period[1] * 2 : byTier(c.tier, ...e.period);
      (c.tier >= 3 ? seasonTier3 : season).push(
        cand(e.step, 'football', e.endpoint, { league: c.leagueId, season: s.year, ...e.extra }, period),
      );
    }
  }
  const countries = [...new Set(comps.map((c) => c.countryName).filter((n): n is string => !!n))];
  const venues = countries.map((country) => cand('venues', 'football', '/venues', { country }, 30));

  // palpites e odds dos jogos de hoje e amanhã (agenda já gravada pelo sync diário)
  const byLeague = new Map(comps.filter((c) => c.tier <= detailTier).map((c) => [c.leagueId, c] as const));
  const upcoming: MirrorCandidate[] = [];
  const until = now.getTime() + UPCOMING_HOURS * 3_600_000;
  for (const f of await collectFixtures(raw, [dateList(utcDate(now)), dateList(utcDate(now, 1))])) {
    const c = byLeague.get(f.leagueId);
    if (!c || !UPCOMING.has(f.status)) continue;
    const at = Date.parse(f.date);
    if (Number.isNaN(at) || at < now.getTime() || at > until) continue;
    const cov = c.seasons.find((s) => s.year === f.season)?.coverage ?? null;
    if (covers(cov, 'predictions'))
      upcoming.push(cand('predictions', 'football', '/predictions', { fixture: f.id }, 1));
    if (covers(cov, 'odds')) upcoming.push(cand('odds', 'football', '/odds', { fixture: f.id }, 1));
  }

  const teamStats: MirrorCandidate[] = [];
  for (const { c, s } of playing) {
    if (c.tier > detailTier) continue;
    for (const t of await teamsOfSeason(raw, c.leagueId, s.year))
      teamStats.push(
        cand(
          'teams-statistics',
          'football',
          '/teams/statistics',
          { league: c.leagueId, season: s.year, team: t.id },
          byTier(c.tier, 7, 14),
        ),
      );
  }

  const derbies = (await derbyPairs()).map((h2h) =>
    cand('h2h-classicos', 'football', '/fixtures/headtohead', { h2h }, 30),
  );

  // tier 2+ (o tier 1 já gira no sync diário): elenco a cada 14 dias, técnicos e transferências a cada 30
  const teams = (await teamTargets(catalog, raw, opts.teamTier ?? 3)).filter((t) => t.tier >= 2);
  const squads: MirrorCandidate[] = [];
  for (const e of TEAM_ENDPOINTS)
    for (const t of teams)
      squads.push(
        cand(e.step, 'football', e.endpoint, { team: t.teamId }, e.endpoint === '/players/squads' ? 14 : 30),
      );

  return [
    { name: 'referência e temporada atual', candidates: [...reference, ...season, ...venues] },
    { name: 'palpites e odds', candidates: upcoming },
    { name: 'estatísticas de time e clássicos', candidates: [...teamStats, ...derbies] },
    { name: 'temporada atual tier 3', candidates: seasonTier3 },
    { name: 'elencos tier 2+', candidates: squads },
  ];
}

// ─── outros 11 esportes ──────────────────────────────────────────────────────────────────────────

/** Temporada de uma competição de outro esporte, com a chave do fornecedor (basquete: "2024-2025"). */
export interface SportSeason {
  league: string;
  tier: number;
  year: number;
  key: string;
  current: boolean;
  startDate: string | null;
  endDate: string | null;
}

/** Jogo/luta/sessão já no core (id do fornecedor). */
export interface SportGame {
  id: string;
  league: string;
  year: number;
  tier: number;
  status: string;
  startsAt: Date;
}

export interface SportMirrorSource {
  /** Referência (sem parâmetros) e temporadas das competições do catálogo YAML. */
  seasons(sport: OtherSport): Promise<SportSeason[]>;
  /** Jogos do catálogo que começam no intervalo. */
  games(sport: OtherSport, from: Date, to: Date, maxTier: number): Promise<SportGame[]>;
  /** Times (ids do fornecedor) que jogaram ou vão jogar na temporada. */
  teams(sport: OtherSport, league: string, year: number): Promise<string[]>;
  /** Participantes (lutadores, no MMA) de jogos do intervalo. */
  participants(sport: OtherSport, from: Date, to: Date): Promise<string[]>;
}

export type OtherSport = Exclude<ApiSport, 'football'>;

interface GameCall {
  endpoint: string;
  /** Parâmetro do id do jogo; `ids` junta até IDS_PER_CALL jogos numa chamada. */
  param: string;
  batch?: boolean;
}

/**
 * O que a api-sports oferece em cada API além da agenda (docs/research/api-sports-outros-esportes.md).
 * `standings`/`teams`: por temporada; `teamStats`/`roster`: por time e temporada; `finished`: por jogo encerrado;
 * `odds`: por jogo que vai começar.
 */
export interface SportMirrorProfile {
  reference: readonly string[];
  /** Lista da temporada inteira (games/races/fights). */
  seasonList: (league: string, key: string) => { endpoint: string; params: Record<string, string> };
  standings: (league: string, key: string) => { endpoint: string; params: Record<string, string> }[];
  /** teams?league&season (as APIs v1 clássicas). */
  seasonTeams?: boolean;
  teamStats?: (
    league: string,
    key: string,
    team: string,
  ) => { endpoint: string; params: Record<string, string> };
  roster?: (key: string, team: string) => { endpoint: string; params: Record<string, string> }[];
  finished?: GameCall[];
  odds?: string;
  /** Endpoints por participante (MMA: perfil e cartel do lutador). */
  participants?: { endpoint: string; param: string }[];
  /** Lesões por time (NFL). */
  injuries?: boolean;
}

const ODDS_REF = ['/odds/bets', '/odds/bookmakers'] as const;
const games = (league: string, season: string) => ({ endpoint: '/games', params: { league, season } });
const standings = (league: string, season: string) => [
  { endpoint: '/standings', params: { league, season } },
];
const leagueTeamStats = (endpoint: string) => (league: string, season: string, team: string) => ({
  endpoint,
  params: { league, season, team },
});

const classic = (extra: Partial<SportMirrorProfile> = {}): SportMirrorProfile => ({
  reference: ['/timezone', '/seasons', '/countries', '/leagues', ...ODDS_REF],
  seasonList: games,
  standings,
  seasonTeams: true,
  teamStats: leagueTeamStats('/teams/statistics'),
  odds: '/odds',
  ...extra,
});

export const SPORT_MIRROR: Record<OtherSport, SportMirrorProfile> = {
  // a tabela do beisebol é calculada aqui pelo aproveitamento (standings/win-pct.ts): a do fornecedor fica de fora
  baseball: classic({ standings: () => [] }),
  handball: classic(),
  rugby: classic(),
  volleyball: classic(),
  hockey: classic({ finished: [{ endpoint: '/games/events', param: 'game' }] }),
  basketball: classic({
    reference: ['/timezone', '/seasons', '/countries', '/leagues', '/bookmakers', '/bets'],
    // no basquete o agregado do time fica em /statistics
    teamStats: leagueTeamStats('/statistics'),
    roster: (season, team) => [{ endpoint: '/players', params: { team, season } }],
    finished: [
      { endpoint: '/games/statistics/teams', param: 'ids', batch: true },
      { endpoint: '/games/statistics/players', param: 'ids', batch: true },
    ],
  }),
  afl: {
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS_REF],
    seasonList: games,
    standings,
    seasonTeams: true,
    teamStats: (_league, season, team) => ({ endpoint: '/teams/statistics', params: { id: team, season } }),
    roster: (season, team) => [{ endpoint: '/players', params: { team, season } }],
    finished: [
      { endpoint: '/games/quarters', param: 'id' },
      { endpoint: '/games/events', param: 'id' },
      { endpoint: '/games/statistics/teams', param: 'id' },
      { endpoint: '/games/statistics/players', param: 'id' },
    ],
    odds: '/odds',
  },
  'american-football': {
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS_REF],
    seasonList: games,
    standings,
    seasonTeams: true,
    roster: (season, team) => [
      { endpoint: '/players', params: { team, season } },
      { endpoint: '/players/statistics', params: { team, season } },
    ],
    finished: [
      { endpoint: '/games/events', param: 'id' },
      { endpoint: '/games/statistics/teams', param: 'id' },
      { endpoint: '/games/statistics/players', param: 'id' },
    ],
    odds: '/odds',
    injuries: true,
  },
  nba: {
    reference: ['/seasons', '/leagues', '/teams'],
    seasonList: games,
    standings,
    teamStats: (_league, season, team) => ({ endpoint: '/teams/statistics', params: { id: team, season } }),
    roster: (season, team) => [
      { endpoint: '/players', params: { team, season } },
      { endpoint: '/players/statistics', params: { team, season } },
    ],
    finished: [
      { endpoint: '/games/statistics', param: 'id' },
      { endpoint: '/players/statistics', param: 'game' },
    ],
  },
  'formula-1': {
    reference: ['/timezone', '/seasons', '/competitions', '/circuits', '/teams'],
    seasonList: (_league, season) => ({ endpoint: '/races', params: { season } }),
    standings: (_league, season) => [
      { endpoint: '/rankings/drivers', params: { season } },
      { endpoint: '/rankings/teams', params: { season } },
    ],
    finished: [
      { endpoint: '/rankings/races', param: 'race' },
      { endpoint: '/rankings/startinggrid', param: 'race' },
      { endpoint: '/rankings/fastestlaps', param: 'race' },
      { endpoint: '/pitstops', param: 'race' },
    ],
  },
  mma: {
    reference: ['/timezone', '/seasons', '/categories', '/teams', ...ODDS_REF],
    seasonList: (_league, season) => ({ endpoint: '/fights', params: { season } }),
    standings: () => [],
    finished: [
      { endpoint: '/fights/results', param: 'ids', batch: true },
      { endpoint: '/fights/statistics/fighters', param: 'ids', batch: true },
    ],
    odds: '/odds',
    participants: [
      { endpoint: '/fighters', param: 'id' },
      { endpoint: '/fighters/records', param: 'id' },
    ],
  },
};

const FINISHED = 'finished';
const SCHEDULED = new Set(['scheduled', 'starting']);

export interface SportMirrorOptions {
  /** Maior tier do catálogo YAML com temporadas, jogos e times no espelho (padrão 2). */
  maxTier?: number | undefined;
}

export async function sportGroups(
  sport: OtherSport,
  source: SportMirrorSource,
  limits: PlanLimits,
  now: Date,
  opts: SportMirrorOptions = {},
): Promise<MirrorGroup[]> {
  const p = SPORT_MIRROR[sport];
  const maxTier = opts.maxTier ?? 2;
  const reference = p.reference.map((e) => cand('referencia', sport, e, {}, e === '/leagues' ? 1 : 7));
  // F1 e MMA: uma "competição" com a temporada no parâmetro; o mesmo pedido vale uma vez
  const playing = (await source.seasons(sport)).filter(
    (s) => s.tier <= maxTier && inPlay(s, now) && seasonAccessible(s.year, limits),
  );
  const season: MirrorCandidate[] = [];
  const perTeam: MirrorCandidate[] = [];
  for (const s of playing) {
    const list = p.seasonList(s.league, s.key);
    season.push(cand('temporada', sport, list.endpoint, list.params, byTier(s.tier, 2, 7)));
    for (const t of p.standings(s.league, s.key))
      season.push(cand('classificacao', sport, t.endpoint, t.params, byTier(s.tier, 1, 2)));
    if (p.seasonTeams) season.push(cand('times', sport, '/teams', { league: s.league, season: s.key }, 7));
    if (!p.teamStats && !p.roster && !p.injuries) continue;
    for (const team of await source.teams(sport, s.league, s.year)) {
      if (p.teamStats) {
        const c = p.teamStats(s.league, s.key, team);
        perTeam.push(cand('estatisticas-time', sport, c.endpoint, c.params, 14));
      }
      for (const r of p.roster?.(s.key, team) ?? [])
        perTeam.push(cand('elenco', sport, r.endpoint, r.params, 14));
      if (p.injuries) perTeam.push(cand('lesoes', sport, '/injuries', { team }, byTier(s.tier, 1, 3)));
    }
  }

  const games: MirrorCandidate[] = [];
  const recent = new Date(now.getTime() - FINISHED_LOOKBACK_DAYS * DAY_MS);
  const ahead = new Date(now.getTime() + UPCOMING_HOURS * 3_600_000);
  const listed = await source.games(sport, recent, ahead, maxTier);
  // jogo de temporada fora da janela do plano (free: 2022–2024): o fornecedor recusaria e cobraria a chamada
  const reachable = listed.filter((g) => seasonAccessible(g.year, limits));
  const finished = reachable.filter((g) => g.status === FINISHED && g.startsAt <= now);
  for (const call of p.finished ?? []) {
    if (call.batch) {
      for (let i = 0; i < finished.length; i += IDS_PER_CALL) {
        const batch = finished.slice(i, i + IDS_PER_CALL).map((g) => g.id);
        games.push(
          cand(
            'por-jogo',
            sport,
            call.endpoint,
            { ids: batch.join('-') },
            PER_GAME_DAYS,
            batch.map((id) => ({ sport, endpoint: call.endpoint, key: `id=${id}` })),
          ),
        );
      }
    } else {
      for (const g of finished)
        games.push(cand('por-jogo', sport, call.endpoint, { [call.param]: g.id }, PER_GAME_DAYS));
    }
  }
  if (p.odds) {
    const param = sport === 'mma' ? 'fight' : 'game';
    for (const g of reachable)
      if (SCHEDULED.has(g.status) && g.startsAt > now)
        games.push(cand('odds', sport, p.odds, { [param]: g.id }, 1));
  }
  for (const pc of p.participants ?? [])
    for (const id of await source.participants(sport, recent, ahead))
      games.push(cand('participantes', sport, pc.endpoint, { [pc.param]: id }, 30));

  return [
    { name: 'referência e temporada atual', candidates: [...reference, ...season] },
    { name: 'por jogo', candidates: games },
    { name: 'por time', candidates: perTeam },
  ];
}

// ─── job ─────────────────────────────────────────────────────────────────────────────────────────

export interface MirrorJobOptions {
  sports: readonly ApiSport[];
  /** Orçamento por API e por dia (padrão: mirrorBudget do plano de cada API). */
  budget?: number | undefined;
  football?: FootballMirrorOptions | undefined;
  other?: SportMirrorOptions | undefined;
  /** --forcar: ignora o período de cada item (o runner também ignora o cache), mantendo o orçamento. */
  force?: boolean | undefined;
}

export interface MirrorDeps {
  catalog: CatalogSource;
  raw: RawSource;
  cursors: CursorStore;
  planFor: (sport: ApiSport) => PlanRules;
  now: () => Date;
  derbyPairs: () => Promise<string[]>;
  sports: SportMirrorSource;
}

/**
 * Job sync:mirror (prioridade DAILY): uma execução por API, cada uma com o orçamento e o plano dela. Separadas
 * porque o runner para a execução inteira na cota esgotada ou num erro do fornecedor que vale para a API toda
 * (429): o futebol sem cota não pode deixar as outras 11 APIs, de cota própria, sem rodar.
 */
export function mirrorJobs(deps: MirrorDeps, opts: MirrorJobOptions): { sport: ApiSport; spec: JobSpec }[] {
  return opts.sports.map((sport) => ({ sport, spec: mirrorJobFor(sport, deps, opts) }));
}

function mirrorJobFor(sport: ApiSport, deps: MirrorDeps, opts: MirrorJobOptions): JobSpec {
  return {
    job: 'sync:mirror',
    priority: 'DAILY',
    phases: [
      {
        name: `espelho ${sport}`,
        build: async () => {
          const now = deps.now();
          const plan = deps.planFor(sport);
          const groups =
            sport === 'football'
              ? await footballGroups(
                  deps.catalog,
                  deps.raw,
                  plan.current,
                  now,
                  deps.derbyPairs,
                  opts.football,
                )
              : await sportGroups(sport, deps.sports, plan.current, now, opts.other);
          const allowed = groups.map((g) => ({
            ...g,
            candidates: g.candidates.filter((c) => allowedByPlan(c, plan, now)),
          }));
          return rotateGroups(allowed, deps.cursors, now, opts.budget ?? mirrorBudget(plan.current), {
            force: opts.force,
          });
        },
      },
    ],
  };
}
