/**
 * Tabelas da temporada atual calculadas localmente (issue #19, docs/03 §4 regra 4): o plano gratuito não
 * acessa `standings` da temporada corrente, então, depois de cada jogo/rodada encerrado, a classificação é
 * recalculada a partir dos resultados do core com o motor determinístico de `@galaxie/rules`
 * (regulamento em `config/rules/<slug>.yaml`, ou o genérico) e gravada com `source = 'computed'`.
 *
 * Quando já existe tabela do provedor (ex.: bootstrap Pro) e ela é mais nova que o último resultado,
 * a do provedor prevalece. Mais velha: a calculada a substitui, com os mesmos nomes de grupo.
 */
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { competition, event, publishChange, season, stage, standing, type Database } from '@galaxie/db';
import { computeStandings, type MatchResult } from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { loadSeasonResults, writeComputedStandings } from '@galaxie/rules/db';

/** Fases que entram na tabela (pontos corridos, fase de liga, grupos). */
export const TABLE_STAGE_KINDS = ['regular', 'league_phase', 'group'] as const;

export type StandingsOutcome =
  | 'written'
  | 'provider_fresh'
  | 'knockout'
  | 'no_results'
  | 'no_groups'
  | 'not_football'
  | 'rules_error'
  | 'invalid_input';

export interface SeasonStandingsReport {
  seasonId: string;
  competition: string | null;
  year: number | null;
  outcome: StandingsOutcome;
  results: number;
  rows: number;
  detail?: string | undefined;
}

export interface RecomputeOptions {
  /** Diretório dos regulamentos (padrão: config/rules do monorepo). */
  rulesDir?: string | undefined;
  /** Publica `topic = standings` no change feed quando grava (padrão: true). */
  publish?: boolean | undefined;
}

/**
 * Temporadas com resultado novo: eventos de futebol encerrados atualizados desde `since` e que
 * começaram nos últimos dias (temporada atual — reprocessar o histórico não dispara recálculo).
 */
export async function seasonsWithNewResults(db: Database, since: Date, recentDays = 10): Promise<string[]> {
  const rows = await db
    .selectDistinct({ seasonId: event.seasonId })
    .from(event)
    .where(
      and(
        eq(event.sport, 'football'),
        eq(event.status, 'finished'),
        isNotNull(event.seasonId),
        gte(event.updatedAt, since),
        gte(event.startsAt, new Date(since.getTime() - recentDays * 86_400_000)),
      ),
    );
  return rows.map((r) => r.seasonId!).sort();
}

/** Recalcula e grava a tabela de uma temporada. */
export async function recomputeSeasonStandings(
  db: Database,
  seasonId: string,
  options: RecomputeOptions = {},
): Promise<SeasonStandingsReport> {
  const [info] = await db
    .select({
      year: season.year,
      slug: competition.slug,
      sport: competition.sport,
      competitionId: competition.id,
    })
    .from(season)
    .innerJoin(competition, eq(competition.id, season.competitionId))
    .where(eq(season.id, seasonId));
  const report = (outcome: StandingsOutcome, extra: Partial<SeasonStandingsReport> = {}) => ({
    seasonId,
    competition: info?.slug ?? null,
    year: info?.year ?? null,
    outcome,
    results: 0,
    rows: 0,
    ...extra,
  });
  if (!info || info.sport !== 'football') return report('not_football');

  let rules;
  try {
    rules = await loadCompetitionRules(info.slug, {
      season: info.year,
      fallbackToDefault: true,
      ...(options.rulesDir ? { dir: options.rulesDir } : {}),
    });
  } catch (err) {
    return report('rules_error', { detail: err instanceof Error ? err.message : String(err) });
  }
  if (rules.format === 'cup') return report('knockout');

  const stages = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.seasonId, seasonId), inArray(stage.kind, [...TABLE_STAGE_KINDS])));
  const anyStage = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stage)
    .where(eq(stage.seasonId, seasonId));
  // sem fase cadastrada (liga simples), todos os resultados contam; com fases, só as de tabela
  const stageIds = stages.length || (anyStage[0]?.n ?? 0) > 0 ? stages.map((s) => s.id) : undefined;
  if (stageIds && !stageIds.length) return report('knockout');

  const providerRows = await db
    .select({ participantId: standing.participantId, group: standing.group, updatedAt: standing.updatedAt })
    .from(standing)
    .where(and(eq(standing.seasonId, seasonId), eq(standing.source, 'provider')));
  const [latest] = await db
    .select({ at: sql<string | null>`max(${event.updatedAt})` })
    .from(event)
    .where(and(eq(event.seasonId, seasonId), eq(event.status, 'finished')));
  const latestResultAt = latest?.at ? new Date(latest.at) : null;
  if (providerRows.length && latestResultAt) {
    const providerAt = Math.max(...providerRows.map((r) => r.updatedAt.getTime()));
    if (providerAt >= latestResultAt.getTime()) return report('provider_fresh');
  }

  // grupos: os do provedor quando existem (mesma chave em core.standing); senão tabela única
  const groupOfTeam = new Map(providerRows.map((r) => [r.participantId, r.group]));
  const groups = new Set(providerRows.map((r) => r.group));
  const singleGroup = groups.size === 1 ? [...groups][0]! : groups.size === 0 ? '' : null;
  // fase de grupos sem a divisão do provedor: não dá para saber quem é de qual grupo
  if (groups.size === 0 && rules.format === 'groups_and_knockout') return report('no_groups');

  const all = await loadSeasonResults(db, seasonId, {
    includeCards: true,
    ...(stageIds ? { stageIds } : {}),
  });
  const matches: MatchResult[] = [];
  for (const m of all) {
    if (singleGroup !== null) {
      matches.push({ ...m, group: singleGroup });
      continue;
    }
    const g = groupOfTeam.get(m.homeId);
    if (g === undefined || g !== groupOfTeam.get(m.awayId)) continue; // jogo entre grupos não entra
    matches.push({ ...m, group: g });
  }
  if (!matches.length) return report('no_results');

  let tables;
  try {
    tables = computeStandings({ rules, matches });
  } catch (err) {
    return report('invalid_input', {
      results: matches.length,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  const rows = await writeComputedStandings(db, seasonId, tables, { mode: 'replace' });
  if (options.publish !== false && rows > 0) {
    await publishChange(db, {
      topic: 'standings',
      entityType: 'season',
      entityId: seasonId,
      payload: {
        source: 'computed',
        rows,
        groups: tables.map((t) => t.group),
        tags: [`competition:${info.competitionId}`, 'standing'],
      },
    });
  }
  return report('written', { results: matches.length, rows });
}

/** Recalcula as temporadas informadas (ou as que têm resultado novo desde `since`). */
export async function recomputeStandings(
  db: Database,
  input: { seasonIds?: readonly string[]; since?: Date } & RecomputeOptions,
): Promise<SeasonStandingsReport[]> {
  const ids = input.seasonIds
    ? [...new Set(input.seasonIds)].sort()
    : input.since
      ? await seasonsWithNewResults(db, input.since)
      : [];
  const out: SeasonStandingsReport[] = [];
  for (const id of ids) out.push(await recomputeSeasonStandings(db, id, input));
  return out;
}
