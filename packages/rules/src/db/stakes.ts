import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  event,
  eventParticipant,
  loadTitleRecords,
  stage,
  standing,
  type Database,
  type TitleRecord,
} from '@galaxie/db';
import { loadCompetitionRules } from '../config/loader.js';
import { knockoutStageRules } from '../config/parse.js';
import type { CompetitionRules } from '../config/types.js';
import type { Stake } from '../stakes/codes.js';
import { fanTagStanding, type FanTagStanding } from '../stakes/fan-tags.js';
import { knockoutStakes } from '../stakes/knockout.js';
import { leagueMatchStakes, type Fixture, type LeagueTeamInput } from '../stakes/league.js';
import {
  finishedLeagueMatchStakes,
  leagueInputOf,
  pickGroupTable,
  prepareFinishedLeagueMatch,
} from '../stakes/result.js';
import { salienceStanding, type SalienceStanding } from '../stakes/salience.js';
import type { MatchResult } from '../standings/types.js';
import { titleChaseSides, titleChaseStakes } from '../stakes/titles.js';

/**
 * Liga o evento do `core` ao motor de regras: descobre o regulamento, a fase, a perna do confronto
 * (ida/volta) ou a tabela do grupo e devolve os stakes estruturados. Nada é estimado: sem dados
 * suficientes, devolve lista vazia com o motivo. Usado pelo Cenário (services/ai-agents) e pelo
 * recálculo da importância (services/ingestor, docs/06 §3).
 */

/** Fases eliminatórias (core.stage.kind). */
export const KNOCKOUT_STAGE_KINDS = new Set([
  'qualifying',
  'playoff',
  'knockout_round',
  'round_of_128',
  'round_of_64',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
]);
/** Fases de pontos corridos. */
export const LEAGUE_STAGE_KINDS = new Set(['regular', 'group', 'league_phase']);

/** O mínimo do evento que o motor precisa (o `EventCore` dos agentes satisfaz este formato). */
export interface StakesEventRef {
  id: string;
  sport: string;
  startsAt: Date;
  /** `id` é necessário para os títulos anteriores (`options.titles`). */
  competition: { slug: string; id?: string } | null;
  season: { id: string; year: number } | null;
  stage: { id: string; kind: string } | null;
  home: { id: string };
  away: { id: string };
  /**
   * Status e placar: num jogo encerrado de pontos corridos, os stakes saem com a tabela de ANTES do jogo
   * e `result` traz o que o placar mudou. Sem eles, vale a tabela atual (pré-jogo).
   */
  status?: string;
  score?: { home?: number | null; away?: number | null } | null;
}

export interface KnockoutContext {
  legs: 1 | 2;
  /** 1 = ida, 2 = volta; null em jogo único. */
  leg: 1 | 2 | null;
  /** Placar da ida (mandante/visitante da ida). */
  firstLeg?: { homeTeamId: string; awayTeamId: string; homeGoals: number; awayGoals: number };
  /** Agregado antes da volta, pela ótica do mandante da volta. */
  aggregateBefore?: { home: number; away: number };
  extraTime: boolean;
  penalties: boolean;
  decidesTitle: boolean;
}

export interface LeagueContext {
  group: string;
  /** Linhas dos dois times (posição, pontos, jogos). */
  rows: { teamId: string; rank: number; points: number; played: number }[];
  teams: number;
  /** Jogos restantes do mandante e do visitante pelo regulamento. */
  remaining: { home: number | null; away: number | null };
  /**
   * Situação de cada time na tabela para o corte realista dos stakes de mera possibilidade
   * (`isRelevantForFans`): usada pelas tags do torcedor e pelos sinais de decisão da importância.
   */
  standings: { home: FanTagStanding | null; away: FanTagStanding | null };
  /** Situação de cada time para a camada de saliência (`salientStakes`). */
  salience: { home: SalienceStanding | null; away: SalienceStanding | null };
}

/** Jogo encerrado de pontos corridos: o que o placar mudou (tabela de depois do jogo). */
export interface LeagueResultContext {
  /** Códigos de resultado (`RESULT_FAMILIES`), lista completa. */
  stakes: Stake[];
  /** Linhas dos dois times depois do jogo. */
  rows: { teamId: string; rank: number; points: number; played: number }[];
  /** Situação de cada time depois do jogo, para a saliência dos códigos de resultado. */
  salience: { home: SalienceStanding | null; away: SalienceStanding | null };
}

export interface EventStakes {
  stakes: Stake[];
  rules: CompetitionRules | null;
  knockout?: KnockoutContext;
  /** Pontos corridos; em jogo encerrado, a situação ANTES do jogo. */
  league?: LeagueContext;
  /** Jogo encerrado de pontos corridos: o que o resultado mudou. */
  result?: LeagueResultContext;
  /**
   * Títulos anteriores na competição por lado (`core.competition_title`), quando a partida pode dar o título e
   * a contagem é confiável (`options.titles`). Os mesmos números viram `seeks_title_{n}` em `stakes`.
   */
  titles?: Partial<Record<'home' | 'away', TitleRecord>>;
  /** Motivo quando não há stakes (pt-BR, para logs e --plan). */
  reason?: string;
}

type StandingRow = typeof standing.$inferSelect;

/**
 * Memória de uma execução em lote (ex.: recálculo de centenas de eventos): regulamento por
 * competição × temporada, tabela por temporada e jogos em aberto por rodada são lidos uma vez só.
 */
export class StakesCache {
  readonly rules = new Map<string, Promise<CompetitionRules>>();
  readonly standings = new Map<string, Promise<StandingRow[]>>();
  readonly openRound = new Map<string, Promise<Fixture[]>>();
  readonly seasonResults = new Map<string, Promise<MatchResult[]>>();
}

export interface StakesOptions {
  /** Diretório dos regulamentos (padrão: config/rules). */
  rulesDir?: string;
  /** Memória compartilhada entre chamadas (lote). */
  cache?: StakesCache;
  /** Inclui os títulos anteriores ("busca o tetra", `seeks_title_{n}`). Padrão: não (a importância não usa). */
  titles?: boolean;
}

function memo<T>(map: Map<string, Promise<T>> | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!map) return load();
  let hit = map.get(key);
  if (!hit) {
    hit = load();
    map.set(key, hit);
  }
  return hit;
}

async function rulesFor(core: StakesEventRef, options: StakesOptions): Promise<CompetitionRules | null> {
  if (!core.competition) return null;
  const slug = core.competition.slug;
  return memo(options.cache?.rules, `${slug}|${core.season?.year ?? ''}`, () =>
    loadCompetitionRules(slug, {
      fallbackToDefault: true,
      ...(core.season ? { season: core.season.year } : {}),
      ...(options.rulesDir ? { dir: options.rulesDir } : {}),
    }),
  );
}

/** Outra partida do mesmo confronto (mesma temporada e fase, mandos invertidos). */
async function findOtherLeg(db: Database, core: StakesEventRef) {
  if (!core.season || !core.stage) return null;
  const home = alias(eventParticipant, 'home_side');
  const away = alias(eventParticipant, 'away_side');
  const rows = await db
    .select({ id: event.id, startsAt: event.startsAt, status: event.status, score: event.score })
    .from(event)
    .innerJoin(home, and(eq(home.eventId, event.id), eq(home.side, 'home')))
    .innerJoin(away, and(eq(away.eventId, event.id), eq(away.side, 'away')))
    .where(
      and(
        eq(event.seasonId, core.season.id),
        eq(event.stageId, core.stage.id),
        ne(event.id, core.id),
        eq(home.participantId, core.away.id),
        eq(away.participantId, core.home.id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function knockoutContext(
  db: Database,
  core: StakesEventRef,
  rules: CompetitionRules,
): Promise<EventStakes> {
  const stageRules = knockoutStageRules(rules, core.stage?.kind);
  const base = {
    legs: stageRules.legs,
    extraTime: stageRules.extraTime,
    penalties: stageRules.penalties,
    decidesTitle: stageRules.decidesTitle,
  };
  if (stageRules.legs === 1) {
    return {
      stakes: knockoutStakes({ rules: stageRules }),
      rules,
      knockout: { ...base, legs: 1, leg: null },
    };
  }
  const other = await findOtherLeg(db, core);
  if (!other) return { stakes: [], rules, reason: 'confronto de ida e volta sem a outra partida no core' };
  if (other.startsAt > core.startsAt) {
    return {
      stakes: knockoutStakes({ rules: stageRules, leg: 1 }),
      rules,
      knockout: { ...base, legs: 2, leg: 1 },
    };
  }
  const h = other.score?.home;
  const a = other.score?.away;
  if (other.status !== 'finished' || typeof h !== 'number' || typeof a !== 'number')
    return { stakes: [], rules, reason: 'jogo de ida ainda sem placar final' };
  // Na ida, o mandante era o visitante deste jogo.
  const firstLeg = { homeTeamId: core.away.id, awayTeamId: core.home.id, homeGoals: h, awayGoals: a };
  return {
    stakes: knockoutStakes({ rules: stageRules, leg: 2, firstLeg: { homeGoals: h, awayGoals: a } }),
    rules,
    knockout: { ...base, legs: 2, leg: 2, firstLeg, aggregateBefore: { home: a, away: h } },
  };
}

/** Jogos ainda não disputados da rodada (precisão do "nesta rodada"). */
function loadOpenRound(db: Database, stageId: string): Promise<Fixture[]> {
  const home = alias(eventParticipant, 'home_side');
  const away = alias(eventParticipant, 'away_side');
  return db
    .select({ homeId: home.participantId, awayId: away.participantId })
    .from(event)
    .innerJoin(home, and(eq(home.eventId, event.id), eq(home.side, 'home')))
    .innerJoin(away, and(eq(away.eventId, event.id), eq(away.side, 'away')))
    .where(
      and(
        eq(event.stageId, stageId),
        inArray(event.status, ['scheduled', 'starting', 'live', 'break', 'postponed']),
      ),
    );
}

/**
 * Jogos encerrados das temporadas nas fases de pontos corridos, por temporada e em ordem cronológica
 * (entrada de `prepareFinishedLeagueMatch`). Jogos sem placar ficam de fora.
 */
export async function loadLeagueResults(
  db: Database,
  seasonIds: readonly string[],
): Promise<Map<string, MatchResult[]>> {
  const out = new Map<string, MatchResult[]>();
  if (!seasonIds.length) return out;
  const home = alias(eventParticipant, 'home_side');
  const away = alias(eventParticipant, 'away_side');
  const rows = await db
    .select({
      seasonId: event.seasonId,
      id: event.id,
      startsAt: event.startsAt,
      score: event.score,
      homeId: home.participantId,
      awayId: away.participantId,
    })
    .from(event)
    .innerJoin(stage, eq(stage.id, event.stageId))
    .innerJoin(home, and(eq(home.eventId, event.id), eq(home.side, 'home')))
    .innerJoin(away, and(eq(away.eventId, event.id), eq(away.side, 'away')))
    .where(
      and(
        inArray(event.seasonId, [...seasonIds]),
        eq(event.status, 'finished'),
        inArray(stage.kind, [...LEAGUE_STAGE_KINDS]),
      ),
    )
    .orderBy(event.startsAt, event.id);
  for (const r of rows) {
    if (!r.seasonId || typeof r.score?.home !== 'number' || typeof r.score.away !== 'number') continue;
    const list = out.get(r.seasonId) ?? [];
    list.push({
      id: r.id,
      homeId: r.homeId,
      awayId: r.awayId,
      homeGoals: r.score.home,
      awayGoals: r.score.away,
      playedAt: r.startsAt.toISOString(),
    });
    out.set(r.seasonId, list);
  }
  return out;
}

/** Jogos da rodada que ainda estavam por começar no início de `core` (sem ele e sem os cancelados). */
async function loadRoundAtKickoff(db: Database, core: StakesEventRef, stageId: string): Promise<Fixture[]> {
  const home = alias(eventParticipant, 'home_side');
  const away = alias(eventParticipant, 'away_side');
  const rows = await db
    .select({ startsAt: event.startsAt, homeId: home.participantId, awayId: away.participantId })
    .from(event)
    .innerJoin(home, and(eq(home.eventId, event.id), eq(home.side, 'home')))
    .innerJoin(away, and(eq(away.eventId, event.id), eq(away.side, 'away')))
    .where(
      and(
        eq(event.stageId, stageId),
        ne(event.id, core.id),
        notInArray(event.status, ['cancelled', 'abandoned']),
      ),
    );
  return rows.filter((r) => r.startsAt >= core.startsAt).map((r) => ({ homeId: r.homeId, awayId: r.awayId }));
}

/** O evento é um jogo encerrado com placar final (stakes com a tabela de antes do jogo)? */
function isFinishedWithScore(core: StakesEventRef): boolean {
  return (
    core.status === 'finished' && typeof core.score?.home === 'number' && typeof core.score.away === 'number'
  );
}

async function leagueContext(
  db: Database,
  core: StakesEventRef,
  rules: CompetitionRules,
  options: StakesOptions,
): Promise<EventStakes> {
  const league = rules.league!;
  const season = core.season;
  if (!season) return { stakes: [], rules, reason: 'evento sem temporada' };
  const rows = await memo(options.cache?.standings, season.id, () =>
    db.select().from(standing).where(eq(standing.seasonId, season.id)),
  );
  if (
    !rows.some((r) => r.participantId === core.home.id) ||
    !rows.some((r) => r.participantId === core.away.id)
  )
    return { stakes: [], rules, reason: 'times fora da tabela da temporada' };
  const groups = new Map<string, StandingRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  // a mesma liga pode ter dois rótulos de grupo (um desatualizado): fica a tabela mais completa
  const picked = pickGroupTable(groups.values(), core.home.id, core.away.id);
  if (!picked) return { stakes: [], rules, reason: 'times em grupos diferentes' };
  const table = [...picked].sort((x, y) => x.rank - y.rank);
  const group = table[0]!.group;
  const homeRow = table.find((r) => r.participantId === core.home.id)!;
  const awayRow = table.find((r) => r.participantId === core.away.id)!;
  if (league.teams !== null && table.length !== league.teams)
    return { stakes: [], rules, reason: `tabela incompleta (${table.length} de ${league.teams} times)` };
  if (isFinishedWithScore(core)) return finishedLeagueContext(db, core, rules, table, options);
  const input: LeagueTeamInput[] = table.map((r) => ({
    teamId: r.participantId,
    points: r.points,
    played: r.played,
  }));

  // Jogos ainda não disputados da mesma rodada entre times da tabela (precisão do "nesta rodada").
  let nextRound: Fixture[] | undefined;
  const stage = core.stage;
  if (stage) {
    const ids = new Set(input.map((t) => t.teamId));
    const round = await memo(options.cache?.openRound, stage.id, () => loadOpenRound(db, stage.id));
    nextRound = round.filter((f) => ids.has(f.homeId) && ids.has(f.awayId));
  }
  const remaining = (played: number) =>
    league.matchesPerTeam === null ? null : league.matchesPerTeam - played;
  const context: LeagueContext = {
    group,
    rows: [homeRow, awayRow].map((r) => ({
      teamId: r.participantId,
      rank: r.rank,
      points: r.points,
      played: r.played,
    })),
    teams: table.length,
    remaining: { home: remaining(homeRow.played), away: remaining(awayRow.played) },
    standings: {
      home: fanTagStanding(input, league, core.home.id),
      away: fanTagStanding(input, league, core.away.id),
    },
    salience: {
      home: salienceStanding(input, league, core.home.id, rules.standings.points),
      away: salienceStanding(input, league, core.away.id, rules.standings.points),
    },
  };
  const matchInput = {
    table: input,
    league,
    points: rules.standings.points,
    homeId: core.home.id,
    awayId: core.away.id,
  };
  try {
    return {
      stakes: leagueMatchStakes(nextRound ? { ...matchInput, nextRound } : matchInput),
      rules,
      league: context,
    };
  } catch (err) {
    // calendário da rodada inconsistente com a tabela: tenta sem a rodada (limites continuam seguros)
    if (!nextRound) throw err;
    return { stakes: leagueMatchStakes(matchInput), rules, league: context };
  }
}

/**
 * Jogo encerrado de pontos corridos: tabela de antes (atual menos este jogo e os posteriores), o que
 * estava em jogo com ela e os códigos de resultado com a tabela de depois.
 */
async function finishedLeagueContext(
  db: Database,
  core: StakesEventRef,
  rules: CompetitionRules,
  table: StandingRow[],
  options: StakesOptions,
): Promise<EventStakes> {
  const league = rules.league!;
  const season = core.season!;
  const results = await memo(options.cache?.seasonResults, season.id, async () => {
    const bySeason = await loadLeagueResults(db, [season.id]);
    return bySeason.get(season.id) ?? [];
  });
  const ids = new Set(table.map((r) => r.participantId));
  const nextRound = core.stage
    ? (await loadRoundAtKickoff(db, core, core.stage.id)).filter(
        (f) => ids.has(f.homeId) && ids.has(f.awayId),
      )
    : undefined;
  const finished = finishedLeagueMatchStakes(
    prepareFinishedLeagueMatch({
      rules,
      current: table.map((r) => ({
        teamId: r.participantId,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        points: r.points,
      })),
      results,
      matchId: core.id,
      ...(nextRound ? { nextRound } : {}),
    }),
  );
  const before = leagueInputOf(finished.before);
  const after = leagueInputOf(finished.after);
  const rowsOf = (t: LeagueTeamInput[]) =>
    [core.home.id, core.away.id].map((id) => {
      const i = t.findIndex((r) => r.teamId === id);
      return { teamId: id, rank: i + 1, points: t[i]!.points, played: t[i]!.played };
    });
  const remaining = (played: number) =>
    league.matchesPerTeam === null ? null : league.matchesPerTeam - played;
  const [homeBefore, awayBefore] = rowsOf(before);
  const sal = (t: LeagueTeamInput[]) => ({
    home: salienceStanding(t, league, core.home.id, rules.standings.points),
    away: salienceStanding(t, league, core.away.id, rules.standings.points),
  });
  return {
    stakes: finished.pre,
    rules,
    league: {
      group: table[0]!.group,
      rows: [homeBefore!, awayBefore!],
      teams: table.length,
      remaining: { home: remaining(homeBefore!.played), away: remaining(awayBefore!.played) },
      standings: {
        home: fanTagStanding(before, league, core.home.id),
        away: fanTagStanding(before, league, core.away.id),
      },
      salience: sal(before),
    },
    result: { stakes: finished.result, rows: rowsOf(after), salience: sal(after) },
  };
}

/** Acrescenta `seeks_title_{n}` e os títulos anteriores quando a partida pode dar o título. */
async function withTitles(db: Database, core: StakesEventRef, result: EventStakes): Promise<EventStakes> {
  const competitionId = core.competition?.id;
  if (!competitionId) return result;
  const sides = titleChaseSides(result.stakes, result.knockout ?? null);
  if (!sides.length) return result;
  const records = await loadTitleRecords(db, {
    competitionId,
    seasonYear: core.season?.year ?? null,
    before: core.startsAt,
    participantIds: [core.home.id, core.away.id],
  });
  const titles: Partial<Record<'home' | 'away', TitleRecord>> = {};
  const home = records.get(core.home.id);
  const away = records.get(core.away.id);
  if (home && sides.includes('home')) titles.home = home;
  if (away && sides.includes('away')) titles.away = away;
  if (!titles.home && !titles.away) return result;
  return { ...result, stakes: [...result.stakes, ...titleChaseStakes(sides, titles)], titles };
}

/** Stakes estruturados da partida, calculados pelo motor de regras a partir do core. */
export async function computeEventStakes(
  db: Database,
  core: StakesEventRef,
  options: StakesOptions = {},
): Promise<EventStakes> {
  const result = await baseEventStakes(db, core, options);
  return options.titles && !result.reason ? withTitles(db, core, result) : result;
}

async function baseEventStakes(
  db: Database,
  core: StakesEventRef,
  options: StakesOptions,
): Promise<EventStakes> {
  if (core.sport !== 'football') return { stakes: [], rules: null, reason: 'stakes só existem para futebol' };
  const rules = await rulesFor(core, options);
  if (!rules) return { stakes: [], rules: null, reason: 'evento sem competição' };
  const kind = core.stage?.kind ?? null;
  try {
    if (kind && KNOCKOUT_STAGE_KINDS.has(kind)) return await knockoutContext(db, core, rules);
    if (rules.league && (kind === null || LEAGUE_STAGE_KINDS.has(kind)))
      return await leagueContext(db, core, rules, options);
  } catch (err) {
    return { stakes: [], rules, reason: `motor de regras recusou a entrada: ${(err as Error).message}` };
  }
  return { stakes: [], rules, reason: `fase sem regra de stakes (${kind ?? 'desconhecida'})` };
}
