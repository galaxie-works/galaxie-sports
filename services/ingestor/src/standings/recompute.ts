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
import { computeStandings, type CompetitionRules, type MatchResult } from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { loadSeasonResults, writeComputedStandings } from '@galaxie/rules/db';
import { computeTablesByRule, type TableRow } from './phases.js';
import { regularSeasonCutoff, winPctTables } from './win-pct.js';

/** Fases que entram na tabela (pontos corridos, fase de liga, grupos). */
export const TABLE_STAGE_KINDS = ['regular', 'league_phase', 'group'] as const;

/** Esportes com tabela calculada localmente: futebol pelo regulamento; beisebol por aproveitamento. */
const COMPUTED_SPORTS = ['football', 'baseball'];

export type StandingsOutcome =
  | 'written'
  | 'provider_fresh'
  | 'knockout'
  | 'no_results'
  | 'no_groups'
  | 'not_football'
  | 'rules_error'
  | 'invalid_input';

/** Tabela do regulamento que o recálculo não gravou, e por quê (vai para o log de operação). */
export interface SkippedTable {
  table: string;
  reason: string;
}

export interface SeasonStandingsReport {
  seasonId: string;
  competition: string | null;
  year: number | null;
  outcome: StandingsOutcome;
  results: number;
  rows: number;
  detail?: string | undefined;
  /** Tabelas do regulamento (`tables:`) que ficaram sem recálculo (sem grupos, grupo ambíguo, erro). */
  skipped?: SkippedTable[] | undefined;
  /** Grupos de `core.standing` que nenhuma tabela do regulamento reconhece (guardados como vieram). */
  unclassified?: string[] | undefined;
  /** Rodadas de fase de grupos que o regulamento não reconhece (contadas pelo grupo dos dois times). */
  unmatchedRounds?: string[] | undefined;
}

/**
 * Relatório que pede atenção da operação: tabela parada (grupo ambíguo, regulamento ou entrada inválidos),
 * tabela do regulamento sem recálculo ou grupo que o regulamento não reconhece. O resto (tabela do
 * fornecedor mais nova, mata-mata, sem resultado) é o normal.
 */
export function needsAttention(r: SeasonStandingsReport): boolean {
  return (
    ['no_groups', 'rules_error', 'invalid_input'].includes(r.outcome) ||
    !!r.skipped?.length ||
    !!r.unclassified?.length ||
    !!r.unmatchedRounds?.length
  );
}

export interface RecomputeOptions {
  /** Diretório dos regulamentos (padrão: config/rules do monorepo). */
  rulesDir?: string | undefined;
  /** Publica `topic = standings` no change feed quando grava (padrão: true). */
  publish?: boolean | undefined;
}

/**
 * Temporadas com resultado novo: eventos encerrados (futebol e beisebol) atualizados desde `since` e que
 * começaram nos últimos dias (temporada atual — reprocessar o histórico não dispara recálculo).
 */
export async function seasonsWithNewResults(db: Database, since: Date, recentDays = 10): Promise<string[]> {
  const rows = await db
    .selectDistinct({ seasonId: event.seasonId })
    .from(event)
    .where(
      and(
        inArray(event.sport, COMPUTED_SPORTS),
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
      type: competition.type,
      countryCode: competition.countryCode,
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
  if (!info || !COMPUTED_SPORTS.includes(info.sport)) return report('not_football');
  if (info.sport === 'baseball') {
    // só ligas nacionais: torneio internacional (Clássico Mundial, Jogos Centro-Americanos) tem grupos e
    // super-rodada que o fornecedor não divide, então não dá para montar a tabela
    if (info.type !== 'league' || !/^[A-Z]{2}$/.test(info.countryCode ?? '')) return report('no_groups');
    return recomputeWinPct(db, seasonId, info.competitionId, report, options);
  }

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

  // pertença aos grupos de qualquer origem: o replace grava `computed` sobre a linha do provedor (mesma chave),
  // então a partir do 2º recálculo não há mais linha `provider` e os grupos sumiriam; a origem só decide o
  // atalho provider_fresh abaixo
  const tableRows = await db
    .select({
      participantId: standing.participantId,
      group: standing.group,
      source: standing.source,
      updatedAt: standing.updatedAt,
    })
    .from(standing)
    .where(eq(standing.seasonId, seasonId));
  const providerRows = tableRows.filter((r) => r.source === 'provider');
  const [latest] = await db
    .select({ at: sql<string | null>`max(${event.updatedAt})` })
    .from(event)
    .where(and(eq(event.seasonId, seasonId), eq(event.status, 'finished')));
  const latestResultAt = latest?.at ? new Date(latest.at) : null;
  if (providerRows.length && latestResultAt) {
    const providerAt = Math.max(...providerRows.map((r) => r.updatedAt.getTime()));
    if (providerAt >= latestResultAt.getTime()) return report('provider_fresh');
  }

  // regulamento com as tabelas da temporada (Apertura/Clausura, anual, promedios...): cada fase com as suas
  // rodadas e os seus grupos
  if (rules.tables.length)
    return recomputeByTables(db, seasonId, info.competitionId, rules, tableRows, report, options);

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

  // grupos: os já gravados em core.standing (do provedor ou de recálculo anterior); sem nenhum, tabela única.
  // O grupo vazio de um time que também está num grupo nomeado é resíduo do recálculo que perdia os grupos.
  // Time em mais de um grupo nomeado (fase regular + fase final, tabela de melhores terceiros): não dá para
  // saber em qual tabela cada jogo entra, então a do fornecedor fica como está
  const groupsOfTeam = new Map<string, Set<string>>();
  for (const r of tableRows) {
    const set = groupsOfTeam.get(r.participantId) ?? new Set<string>();
    set.add(r.group);
    groupsOfTeam.set(r.participantId, set);
  }
  const groupOfTeam = new Map<string, string>();
  for (const [team, set] of groupsOfTeam) {
    const named = [...set].filter((g) => g !== '');
    if (named.length > 1)
      return report('no_groups', {
        detail: `time em mais de um grupo do fornecedor (${named.sort().join(', ')}); a competição não tem \`tables\` no regulamento`,
      });
    groupOfTeam.set(team, named[0] ?? '');
  }
  const groups = new Set(groupOfTeam.values());
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
  await dropStaleComputedRows(db, seasonId, tables);
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

/**
 * Recálculo pelas tabelas do regulamento: cada fase com as rodadas e os grupos dela, a anual com todas as
 * fases. Tabela sem como montar (sem grupos do fornecedor, grupo ambíguo) e grupo que o regulamento não
 * reconhece vão para o relatório; as demais são gravadas mesmo assim.
 */
async function recomputeByTables(
  db: Database,
  seasonId: string,
  competitionId: string,
  rules: CompetitionRules,
  tableRows: readonly TableRow[],
  report: (outcome: StandingsOutcome, extra?: Partial<SeasonStandingsReport>) => SeasonStandingsReport,
  options: RecomputeOptions,
): Promise<SeasonStandingsReport> {
  const out = await computeTablesByRule(db, seasonId, rules, tableRows);
  const extra = {
    ...(out.skipped.length ? { skipped: out.skipped } : {}),
    ...(out.unclassified.length ? { unclassified: out.unclassified } : {}),
    ...(out.unmatchedRounds.length ? { unmatchedRounds: out.unmatchedRounds } : {}),
  };
  const detail = [
    ...out.skipped.map((t) => `${t.table}: ${t.reason}`),
    ...(out.unclassified.length ? [`grupos sem tabela no regulamento: ${out.unclassified.join(', ')}`] : []),
    ...(out.unmatchedRounds.length
      ? [`rodadas de grupo fora do regulamento (contadas pelo grupo): ${out.unmatchedRounds.join(', ')}`]
      : []),
  ].join('; ');
  if (!out.tables.length)
    return report(out.skipped.length ? 'no_groups' : 'no_results', {
      ...extra,
      ...(detail ? { detail } : {}),
    });
  const rows = await writeComputedStandings(db, seasonId, out.tables, { mode: 'replace' });
  await dropStaleComputedRows(db, seasonId, out.tables);
  if (options.publish !== false && rows > 0) {
    await publishChange(db, {
      topic: 'standings',
      entityType: 'season',
      entityId: seasonId,
      payload: {
        source: 'computed',
        rows,
        groups: out.tables.map((t) => t.group),
        tags: [`competition:${competitionId}`, 'standing'],
      },
    });
  }
  return report('written', { results: out.results, rows, ...extra, ...(detail ? { detail } : {}) });
}

/**
 * Linhas calculadas velhas: nos grupos que este recálculo gravou, o time que não foi regravado (a tabela do
 * grupo é refeita inteira); fora deles, só o grupo vazio (resíduo do recálculo que perdia os grupos; quando
 * a tabela gravada é a única, sem nome, ele é o próprio grupo gravado). Grupo nomeado que não foi recalculado
 * e linhas do provedor ficam.
 */
async function dropStaleComputedRows(
  db: Database,
  seasonId: string,
  tables: readonly { group: string; rows: readonly { teamId: string }[] }[],
): Promise<void> {
  const keep = tables.flatMap((t) => t.rows.map((r) => sql`(${t.group}, ${r.teamId}::uuid)`));
  if (!keep.length) return;
  const written = [...new Set(tables.map((t) => t.group))];
  const scope = written.includes('') ? written : [...written, ''];
  await db
    .delete(standing)
    .where(
      and(
        eq(standing.seasonId, seasonId),
        eq(standing.source, 'computed'),
        inArray(standing.group, scope),
        sql`(${standing.group}, ${standing.participantId}) not in (${sql.join(keep, sql`, `)})`,
      ),
    );
}

/**
 * Beisebol: tabela única por aproveitamento com os jogos da fase regular (sem fase ou fase de tabela; os
 * playoffs ficam de fora). Tabela do fornecedor mais nova que o último resultado prevalece, como no futebol.
 */
async function recomputeWinPct(
  db: Database,
  seasonId: string,
  competitionId: string,
  report: (outcome: StandingsOutcome, extra?: Partial<SeasonStandingsReport>) => SeasonStandingsReport,
  options: RecomputeOptions,
): Promise<SeasonStandingsReport> {
  const [provider] = await db
    .select({ at: sql<string | null>`max(${standing.updatedAt})` })
    .from(standing)
    .where(and(eq(standing.seasonId, seasonId), eq(standing.source, 'provider')));
  const [latest] = await db
    .select({ at: sql<string | null>`max(${event.updatedAt})` })
    .from(event)
    .where(and(eq(event.seasonId, seasonId), eq(event.status, 'finished')));
  if (provider?.at && latest?.at && new Date(provider.at) >= new Date(latest.at)) {
    return report('provider_fresh');
  }

  const playoffs = await db
    .select({ id: event.id })
    .from(event)
    .innerJoin(stage, eq(stage.id, event.stageId))
    .where(and(eq(event.seasonId, seasonId), sql`${stage.kind} not in ('regular', 'league_phase', 'group')`));
  const skip = new Set(playoffs.map((e) => e.id));
  const regular = (await loadSeasonResults(db, seasonId)).filter((m) => !skip.has(m.id!));
  const cutoff = regularSeasonCutoff(regular);
  const matches = cutoff ? regular.filter((m) => m.playedAt! <= cutoff) : regular;
  if (!matches.length) return report('no_results');

  const tables = winPctTables(matches);
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
        tags: [`competition:${competitionId}`, 'standing'],
      },
    });
  }
  return report('written', {
    results: matches.length,
    rows,
    ...(cutoff ? { detail: `fase regular até ${cutoff.slice(0, 10)}` } : {}),
  });
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
