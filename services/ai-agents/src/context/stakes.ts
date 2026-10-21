import { and, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { event, eventParticipant, standing, type Database } from '@galaxie/db';
import {
  knockoutStageRules,
  knockoutStakes,
  leagueMatchStakes,
  type CompetitionRules,
  type Fixture,
  type LeagueTeamInput,
  type Stake,
} from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import type { EventCore } from './event-core.js';

/**
 * Liga o evento do `core` ao motor de regras (`@galaxie/rules`): descobre o regulamento, a fase,
 * a perna do confronto (ida/volta) ou a tabela do grupo e devolve os stakes estruturados.
 * Nada é estimado: sem dados suficientes, devolve lista vazia com o motivo.
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
}

export interface EventStakes {
  stakes: Stake[];
  rules: CompetitionRules | null;
  knockout?: KnockoutContext;
  league?: LeagueContext;
  /** Motivo quando não há stakes (pt-BR, para logs e --plan). */
  reason?: string;
}

export interface StakesOptions {
  /** Diretório dos regulamentos (padrão: config/rules). */
  rulesDir?: string;
}

async function rulesFor(core: EventCore, options: StakesOptions): Promise<CompetitionRules | null> {
  if (!core.competition) return null;
  return loadCompetitionRules(core.competition.slug, {
    fallbackToDefault: true,
    ...(core.season ? { season: core.season.year } : {}),
    ...(options.rulesDir ? { dir: options.rulesDir } : {}),
  });
}

/** Outra partida do mesmo confronto (mesma temporada e fase, mandos invertidos). */
async function findOtherLeg(db: Database, core: EventCore) {
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

async function knockoutContext(db: Database, core: EventCore, rules: CompetitionRules): Promise<EventStakes> {
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

async function leagueContext(db: Database, core: EventCore, rules: CompetitionRules): Promise<EventStakes> {
  const league = rules.league!;
  if (!core.season) return { stakes: [], rules, reason: 'evento sem temporada' };
  const rows = await db.select().from(standing).where(eq(standing.seasonId, core.season.id));
  const homeRow = rows.find((r) => r.participantId === core.home.id);
  const awayRow = rows.find((r) => r.participantId === core.away.id);
  if (!homeRow || !awayRow) return { stakes: [], rules, reason: 'times fora da tabela da temporada' };
  if (homeRow.group !== awayRow.group) return { stakes: [], rules, reason: 'times em grupos diferentes' };
  const group = homeRow.group;
  const table = rows.filter((r) => r.group === group).sort((x, y) => x.rank - y.rank);
  if (league.teams !== null && table.length !== league.teams)
    return { stakes: [], rules, reason: `tabela incompleta (${table.length} de ${league.teams} times)` };
  const input: LeagueTeamInput[] = table.map((r) => ({
    teamId: r.participantId,
    points: r.points,
    played: r.played,
  }));

  // Jogos ainda não disputados da mesma rodada entre times da tabela (precisão do "nesta rodada").
  let nextRound: Fixture[] | undefined;
  if (core.stage) {
    const home = alias(eventParticipant, 'home_side');
    const away = alias(eventParticipant, 'away_side');
    const ids = new Set(input.map((t) => t.teamId));
    const round = await db
      .select({ homeId: home.participantId, awayId: away.participantId })
      .from(event)
      .innerJoin(home, and(eq(home.eventId, event.id), eq(home.side, 'home')))
      .innerJoin(away, and(eq(away.eventId, event.id), eq(away.side, 'away')))
      .where(
        and(
          eq(event.stageId, core.stage.id),
          inArray(event.status, ['scheduled', 'starting', 'live', 'break', 'postponed']),
        ),
      );
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

/** Stakes estruturados da partida, calculados pelo motor de regras a partir do core. */
export async function computeEventStakes(
  db: Database,
  core: EventCore,
  options: StakesOptions = {},
): Promise<EventStakes> {
  if (core.sport !== 'football') return { stakes: [], rules: null, reason: 'stakes só existem para futebol' };
  const rules = await rulesFor(core, options);
  if (!rules) return { stakes: [], rules: null, reason: 'evento sem competição' };
  const kind = core.stage?.kind ?? null;
  try {
    if (kind && KNOCKOUT_STAGE_KINDS.has(kind)) return await knockoutContext(db, core, rules);
    if (rules.league && (kind === null || LEAGUE_STAGE_KINDS.has(kind)))
      return await leagueContext(db, core, rules);
  } catch (err) {
    return { stakes: [], rules, reason: `motor de regras recusou a entrada: ${(err as Error).message}` };
  }
  return { stakes: [], rules, reason: `fase sem regra de stakes (${kind ?? 'desconhecida'})` };
}
