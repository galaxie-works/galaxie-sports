/**
 * Tabelas da temporada atual calculadas localmente (issue #19, docs/03 §4 regra 4): o plano gratuito não
 * acessa `standings` da temporada corrente, então, depois de cada jogo/rodada encerrado, a classificação é
 * recalculada a partir dos resultados do core com o motor determinístico de `@galaxie/rules`
 * (regulamento em `config/rules/<slug>.yaml`, ou o genérico) e gravada com `source = 'computed'`.
 *
 * Com resultado encerrado e regulamento (o genérico também conta), a tabela é sempre a calculada, mesmo que a
 * do provedor (ex.: bootstrap Pro) seja mais nova que o último resultado: a calculada a substitui, com os mesmos
 * nomes de grupo (#880). A do provedor só vale no mata-mata e na temporada sem jogo. O beisebol fica de fora:
 * a calculada é uma tabela única e a do fornecedor vem por divisão (`recomputeWinPct`).
 */
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  competition,
  event,
  providerMap,
  publishChange,
  season,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import {
  computeStandings,
  standingsTableOf,
  type CompetitionRules,
  type MatchResult,
  type StandingsTable,
} from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { loadSeasonResults, writeComputedStandings } from '@galaxie/rules/db';
import { computeTablesByRule, crossGroupTables, type TableRow } from './phases.js';
import {
  components,
  joinNamedGroups,
  planPhases,
  RESERVE_TABLE_NAME,
  UNNAMED_GROUP_PREFIX,
  type TableSet,
} from './phases-auto.js';
import { regularSeasonCutoff, winPctTables } from './win-pct.js';

/** Fases que entram na tabela (pontos corridos, fase de liga, grupos). */
export const TABLE_STAGE_KINDS = ['regular', 'league_phase', 'group'] as const;

/** Esportes com tabela calculada localmente: futebol pelo regulamento; beisebol por aproveitamento. */
const COMPUTED_SPORTS = ['football', 'baseball'];

export type StandingsOutcome =
  | 'written'
  | 'provider_fresh'
  | 'provider_ahead'
  | 'knockout'
  | 'no_results'
  | 'no_groups'
  | 'partial'
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
  /** Rodadas de fase de grupos que o regulamento não reconhece (contadas só na fase inequívoca dos dois times). */
  unmatchedRounds?: string[] | undefined;
  /** Grupos com o nome antigo de uma tabela renomeada pelo fornecedor (apagados). */
  superseded?: string[] | undefined;
}

/**
 * Relatório que pede atenção da operação: tabela parada (grupo ambíguo, regulamento ou entrada inválidos),
 * tabela do regulamento sem recálculo ou grupo que o regulamento não reconhece. O resto (tabela do
 * fornecedor mais nova no beisebol, mata-mata, sem resultado) é o normal.
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

/** IDs das temporadas de futebol pelo par (liga da api-sports, ano), ex.: as relistadas pelo sync diário. */
export async function footballSeasonIds(
  db: Database,
  pairs: readonly { league: string; year: number }[],
): Promise<string[]> {
  if (!pairs.length) return [];
  const rows = await db
    .select({ id: season.id, league: providerMap.providerId, year: season.year })
    .from(season)
    .innerJoin(
      providerMap,
      and(
        eq(providerMap.entityId, season.competitionId),
        eq(providerMap.entityType, 'competition'),
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.sport, 'football'),
      ),
    )
    .where(inArray(providerMap.providerId, [...new Set(pairs.map((p) => p.league))]));
  const wanted = new Set(pairs.map((p) => `${p.league}|${p.year}`));
  return rows
    .filter((r) => wanted.has(`${r.league}|${r.year}`))
    .map((r) => r.id)
    .sort();
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
      tier: competition.tier,
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
  // então a partir do 2º recálculo não há mais linha `provider` e os grupos sumiriam. Com resultado e
  // regulamento (o genérico também conta), a tabela é sempre nossa, mesmo com a do fornecedor mais nova (#880)
  const tableRows = await db
    .select({
      participantId: standing.participantId,
      group: standing.group,
      source: standing.source,
      updatedAt: standing.updatedAt,
    })
    .from(standing)
    .where(eq(standing.seasonId, seasonId));

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

  // grupo deduzido num recálculo anterior (`unnamed:N`) não é do fornecedor: volta a ser deduzido a cada
  // recálculo (dois pedaços do mesmo grupo no começo da temporada se juntam quando se enfrentam)
  const all = await loadSeasonResults(db, seasonId, {
    includeCards: true,
    ...(stageIds ? { stageIds } : {}),
  });
  const groupsOfTeam = new Map<string, Set<string>>();
  for (const r of tableRows) {
    const set = groupsOfTeam.get(r.participantId) ?? new Set<string>();
    set.add(r.group.startsWith(UNNAMED_GROUP_PREFIX) ? '' : r.group);
    groupsOfTeam.set(r.participantId, set);
  }

  // sem regulamento de tabelas e com mais de uma fase nas rodadas do fornecedor: uma tabela por fase e a
  // anual, deduzidas (phases-auto.ts); o grupo vazio, que misturava as fases, sai
  const labels = await roundLabels(db, seasonId);
  const plan = planPhases(
    all.map((m) => ({
      ...m,
      roundLabel: labels.get(m.id!)?.label ?? null,
      stageKind: labels.get(m.id!)?.kind ?? null,
    })),
    groupsOfTeam,
  );
  if (plan.kind === 'error') return report('no_groups', { detail: plan.detail });
  if (plan.kind === 'multi') {
    if (!plan.sets.length) return report('no_results');
    const results = new Set(plan.sets.flatMap((s) => s.matches.map((m) => m.id))).size;
    let tables;
    try {
      tables = plan.sets.flatMap((set) => tablesOfSet(rules, set));
    } catch (err) {
      return report('invalid_input', { results, detail: err instanceof Error ? err.message : String(err) });
    }
    return writeTables(db, seasonId, info.competitionId, tables, options, report, {
      results,
      dropEmpty: true,
      maxRound:
        info.tier >= PARTIAL_MIN_TIER ? maxRoundNumber(all.map((m) => labels.get(m.id!)?.label)) : null,
    });
  }

  // uma fase: grupos são os já gravados em core.standing (do provedor ou de recálculo anterior); sem nenhum,
  // tabela única. O grupo vazio de um time que também está num grupo nomeado é resíduo do recálculo que
  // perdia os grupos. Time em mais de um grupo nomeado (fase regular + fase final, tabela de melhores
  // terceiros): não dá para saber em qual tabela cada jogo entra, então a do fornecedor fica como está. Quando só
  // um desses grupos tem tabela calculada (a acumulada do fornecedor ao lado da liga), vale o calculado e o outro
  // fica como reserva; sem isso o recálculo parava em `no_groups` e a nossa tabela congelava
  // espelho dos dados, não do formato: a tabela de reserva do fornecedor (acumulada, anual, promedios, pelo nome)
  // em que a maioria dos times já está num grupo nosso calculado e com nome é sombra da nossa tabela. Fica no
  // core como reserva e não define grupo: com ele, cada time ficava em dois grupos com nome (`no_groups`, tabela
  // congelada) e o promovido, que só tem linha nos promedios, levava a sua linha para lá. O grupo vazio e o
  // deduzido não contam como nossos: o rótulo que o fornecedor dá a eles continua sendo adotado.
  // Só o nome decide, não a sobreposição de times: uma 2ª fase de verdade (fase final, quadrangular) tem quase os
  // mesmos times da regular, e tratá-la como sombra jogava os jogos dela na tabela da fase regular (revisão do
  // #855). Sem o nome de reserva, o time em dois grupos com nome continua em `no_groups` e a do fornecedor fica
  const computedNamed = new Set(
    tableRows
      .filter((r) => r.source === 'computed' && r.group !== '' && !r.group.startsWith(UNNAMED_GROUP_PREFIX))
      .map((r) => r.group),
  );
  const inComputed = new Set(tableRows.filter((r) => computedNamed.has(r.group)).map((r) => r.participantId));
  const teamsOfGroup = new Map<string, string[]>();
  for (const r of tableRows)
    if (r.group !== '' && !computedNamed.has(r.group) && !r.group.startsWith(UNNAMED_GROUP_PREFIX))
      teamsOfGroup.set(r.group, [...(teamsOfGroup.get(r.group) ?? []), r.participantId]);
  const shadow = new Set(
    [...teamsOfGroup]
      .filter(([g]) => RESERVE_TABLE_NAME.test(g))
      .filter(([, ts]) => ts.filter((t) => inComputed.has(t)).length * 2 > ts.length)
      .map(([g]) => g),
  );
  const groupOfTeam = new Map<string, string>();
  for (const [team, set] of groupsOfTeam) {
    const named = [...set].filter((g) => g !== '' && !shadow.has(g));
    if (named.length > 1)
      return report('no_groups', {
        detail: `time em mais de um grupo do fornecedor (${named.sort().join(', ')}); a competição não tem \`tables\` no regulamento`,
      });
    groupOfTeam.set(team, named[0] ?? '');
  }
  // time que jogou e ainda não tem linha na tabela (promovido, tabela do fornecedor de antes da entrada dele)
  // conta como sem grupo; sem isso, com vários grupos, os jogos dele ficavam de fora e ele sumia da tabela
  for (const m of all) for (const t of [m.homeId, m.awayId]) if (!groupOfTeam.has(t)) groupOfTeam.set(t, '');
  // o fornecedor mandou só parte dos grupos (Série D 2026: 8 de 16): os times sem grupo ganham os grupos
  // deduzidos dos jogos entre eles
  const loose = [...groupOfTeam].filter(([, g]) => g === '').map(([t]) => t);
  if (loose.length && loose.length < groupOfTeam.size) {
    // ao lado de grupos com nome, mesmo um grupo deduzido só ganha nome (sem nome, viraria uma 2ª tabela)
    // quem joga contra um grupo com nome entra nele; só o resto vira grupo deduzido
    components(joinNamedGroups(loose, groupOfTeam, all), all).forEach((part, i) =>
      part.forEach((t) => groupOfTeam.set(t, `${UNNAMED_GROUP_PREFIX}${i + 1}`)),
    );
  }
  const groups = new Set(groupOfTeam.values());
  const singleGroup = groups.size === 1 ? [...groups][0]! : groups.size === 0 ? '' : null;
  // fase de grupos sem a divisão do provedor: não dá para saber quem é de qual grupo
  if (groups.size === 0 && rules.format === 'groups_and_knockout') return report('no_groups');

  // vários grupos: o jogo entre grupos (entre conferências da MLS) conta na tabela de cada time
  const set: TableSet =
    singleGroup !== null
      ? { matches: all.map((m): MatchResult => ({ ...m, group: singleGroup })) }
      : {
          matches: all.filter((m) => groupOfTeam.has(m.homeId) && groupOfTeam.has(m.awayId)),
          groupOf: groupOfTeam,
        };
  if (!set.matches.length) return report('no_results');

  let tables;
  try {
    tables = tablesOfSet(rules, set);
  } catch (err) {
    return report('invalid_input', {
      results: set.matches.length,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  return writeTables(db, seasonId, info.competitionId, tables, options, report, {
    results: set.matches.length,
    dropEmpty: false,
    maxRound:
      info.tier >= PARTIAL_MIN_TIER ? maxRoundNumber(set.matches.map((m) => labels.get(m.id!)?.label)) : null,
  });
}

/** Tabelas de um conjunto: com grupo por time, o jogo entre grupos conta nos dois (`crossGroupTables`). */
function tablesOfSet(rules: CompetitionRules, set: TableSet): StandingsTable[] {
  if (!set.groupOf) return computeStandings({ rules, matches: set.matches });
  // só os times com jogo, como no cálculo sem grupos: grupo sem jogo novo não é regravado
  const played = new Set(set.matches.flatMap((m) => [m.homeId, m.awayId]));
  const groupOf = new Map([...set.groupOf].filter(([team]) => played.has(team)));
  return crossGroupTables(rules, set.matches, groupOf);
}

/** Grava as tabelas calculadas, limpa as linhas velhas e avisa o change feed. */
async function writeTables(
  db: Database,
  seasonId: string,
  competitionId: string,
  tables: StandingsTable[],
  options: RecomputeOptions,
  report: (outcome: StandingsOutcome, extra?: Partial<SeasonStandingsReport>) => SeasonStandingsReport,
  extra: { results: number; dropEmpty: boolean; maxRound?: number | null },
): Promise<SeasonStandingsReport> {
  // o banco só tem as últimas rodadas da temporada (liga sem carga histórica): a tabela sairia com 1 ou 2 jogos
  // por time e sem quem não jogou nessas rodadas. Não publica; a calculada que houver sai também
  const maxPlayed = Math.max(0, ...tables.flatMap((t) => t.rows.map((r) => r.played)));
  if (isPartialSeason(extra.maxRound ?? null, maxPlayed)) {
    const removed = await db
      .delete(standing)
      .where(and(eq(standing.seasonId, seasonId), eq(standing.source, 'computed')))
      .returning({ id: standing.participantId });
    if (options.publish !== false && removed.length > 0)
      await publishStandings(db, seasonId, competitionId, 0, []);
    return report('partial', {
      results: extra.results,
      detail: `só parte da temporada no banco: rodada ${extra.maxRound}, no máximo ${maxPlayed} jogos por time`,
    });
  }
  const ahead = await providerAheadGroups(db, seasonId, tables);
  if (ahead.length) {
    tables = tables.filter((t) => !ahead.includes(t.group));
    if (!tables.length)
      return report('provider_ahead', { results: extra.results, detail: aheadDetail(ahead) });
  }
  const rows = await writeComputedStandings(db, seasonId, tables, { mode: 'replace' });
  await dropStaleComputedRows(db, seasonId, tables, extra.dropEmpty);
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
    results: extra.results,
    rows,
    ...(ahead.length ? { detail: aheadDetail(ahead) } : {}),
  });
}

/**
 * Trava do #880: grupo em que algum time tem mais jogos na linha do fornecedor do que na nossa (jogo faltando no
 * core ou formato que o regulamento ainda não descreve). A nossa tabela sairia errada; fica a do fornecedor até
 * o core ou o regulamento serem acertados.
 */
async function providerAheadGroups(
  db: Database,
  seasonId: string,
  tables: readonly StandingsTable[],
): Promise<string[]> {
  const provider = await db
    .select({ group: standing.group, participantId: standing.participantId, played: standing.played })
    .from(standing)
    .where(and(eq(standing.seasonId, seasonId), eq(standing.source, 'provider')));
  return providerAhead(provider, tables);
}

/** Grupos calculados que ficam atrás da linha do fornecedor no mesmo grupo (função pura, para teste). */
export function providerAhead(
  provider: readonly { group: string; participantId: string; played: number | null }[],
  tables: readonly { group: string; rows: readonly { teamId: string; played: number }[] }[],
): string[] {
  const out: string[] = [];
  for (const t of tables) {
    const ours = new Map(t.rows.map((r) => [r.teamId, r.played]));
    const behind = provider.some(
      (p) => p.group === t.group && (p.played ?? 0) > (ours.get(p.participantId) ?? 0),
    );
    if (behind) out.push(t.group);
  }
  return out;
}

const aheadDetail = (groups: readonly string[]) =>
  `tabela do fornecedor com mais jogos (fica a dele): ${groups.map((g) => g || '(sem nome)').join(', ')}`;

/** Tabela com bem menos jogos que a rodada numerada pelo fornecedor (a partir da rodada 5): parcial. */
const PARTIAL_PLAYED_SHARE = 0.6;
const PARTIAL_MIN_ROUND = 5;
/** Só no tier 3: tier 1 e 2 têm a carga histórica completa (#417), e lá a tabela vale mesmo com poucos jogos no banco. */
const PARTIAL_MIN_TIER = 3;

export function isPartialSeason(maxRound: number | null, maxPlayed: number): boolean {
  return maxRound !== null && maxRound >= PARTIAL_MIN_ROUND && maxPlayed < PARTIAL_PLAYED_SHARE * maxRound;
}

/** Maior número de rodada ("Regular Season - 35" → 35) entre os jogos usados; null sem rodada numerada. */
export function maxRoundNumber(labels: Iterable<string | null | undefined>): number | null {
  let max: number | null = null;
  for (const l of labels) {
    const n = /\s-\s(\d+)$/.exec(l?.trim() ?? '')?.[1];
    if (n !== undefined) max = Math.max(max ?? 0, Number(n));
  }
  return max;
}

/** Rótulo de cada rodada da temporada no fornecedor ("Apertura - 7") e o tipo do estágio, por evento. */
async function roundLabels(
  db: Database,
  seasonId: string,
): Promise<Map<string, { label: string; kind: string }>> {
  const rows = await db
    .select({
      id: event.id,
      kind: stage.kind,
      label: sql<string | null>`coalesce(${stage.providerLabel}, ${stage.name}->>'en')`,
    })
    .from(event)
    .innerJoin(stage, eq(stage.id, event.stageId))
    .where(eq(event.seasonId, seasonId));
  return new Map(rows.filter((r) => r.label).map((r) => [r.id, { label: r.label!, kind: r.kind }]));
}

/**
 * Recálculo pelas tabelas do regulamento: cada fase com as rodadas e os grupos dela, a anual com todas as
 * fases. Tabela sem como montar (sem grupos do fornecedor, grupo ambíguo) e grupo que o regulamento não
 * reconhece vão para o relatório; as demais são gravadas mesmo assim, ainda que a do fornecedor seja mais
 * nova (#880). O grupo de nome antigo de uma tabela renomeada e o resíduo no grupo sem nome saem mesmo quando
 * nada é regravado.
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
    ...(out.superseded.length ? { superseded: out.superseded } : {}),
  };
  const detail = [
    ...out.skipped.map((t) => `${t.table}: ${t.reason}`),
    ...(out.unclassified.length ? [`grupos sem tabela no regulamento: ${out.unclassified.join(', ')}`] : []),
    ...(out.unmatchedRounds.length
      ? [
          `rodadas de grupo fora do regulamento (contadas só com fase inequívoca): ${out.unmatchedRounds.join(', ')}`,
        ]
      : []),
    ...(out.superseded.length
      ? [`grupo renomeado pelo fornecedor (apagado): ${out.superseded.join(', ')}`]
      : []),
  ].join('; ');
  const ahead = await providerAheadGroups(db, seasonId, out.tables);
  if (ahead.length) out.tables = out.tables.filter((t) => !ahead.includes(t.group));
  const fullDetail = [detail, ahead.length ? aheadDetail(ahead) : ''].filter(Boolean).join('; ');
  const removed = await dropRenamedAndResidue(db, seasonId, rules, tableRows, out.superseded);
  if (!out.tables.length) {
    if (options.publish !== false && removed > 0) await publishStandings(db, seasonId, competitionId, 0, []);
    const outcome = out.skipped.length ? 'no_groups' : ahead.length ? 'provider_ahead' : 'no_results';
    return report(outcome, { ...extra, ...(fullDetail ? { detail: fullDetail } : {}) });
  }
  const rows = await writeComputedStandings(db, seasonId, out.tables, { mode: 'replace' });
  await dropStaleComputedRows(db, seasonId, out.tables);
  if (options.publish !== false && (rows > 0 || removed > 0))
    await publishStandings(
      db,
      seasonId,
      competitionId,
      rows,
      out.tables.map((t) => t.group),
    );
  return report('written', {
    results: out.results,
    rows,
    ...extra,
    ...(fullDetail ? { detail: fullDetail } : {}),
  });
}

/** Avisa o change feed de que a tabela da temporada mudou. */
async function publishStandings(
  db: Database,
  seasonId: string,
  competitionId: string,
  rows: number,
  groups: readonly string[],
): Promise<void> {
  await publishChange(db, {
    topic: 'standings',
    entityType: 'season',
    entityId: seasonId,
    payload: {
      source: 'computed',
      rows,
      groups: [...groups],
      tags: [`competition:${competitionId}`, 'standing'],
    },
  });
}

/**
 * Com as tabelas do regulamento: apaga o grupo de nome antigo de uma tabela renomeada (de qualquer origem; os
 * times dele estão no nome novo) e o resíduo calculado no grupo sem nome ao lado de grupos com nome (quando
 * nenhuma tabela do regulamento usa o sem nome). Devolve as linhas apagadas.
 */
async function dropRenamedAndResidue(
  db: Database,
  seasonId: string,
  rules: CompetitionRules,
  tableRows: readonly TableRow[],
  superseded: readonly string[],
): Promise<number> {
  let removed = 0;
  if (superseded.length) {
    const gone = await db
      .delete(standing)
      .where(and(eq(standing.seasonId, seasonId), inArray(standing.group, [...superseded])))
      .returning({ id: standing.participantId });
    removed += gone.length;
  }
  const residue =
    !standingsTableOf(rules, '') &&
    tableRows.some((r) => r.group !== '') &&
    tableRows.some((r) => r.group === '' && r.source === 'computed');
  if (residue) {
    const gone = await db
      .delete(standing)
      .where(and(eq(standing.seasonId, seasonId), eq(standing.group, ''), eq(standing.source, 'computed')))
      .returning({ id: standing.participantId });
    removed += gone.length;
  }
  return removed;
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
  dropEmpty = false,
): Promise<void> {
  // temporada com fases deduzidas: o grupo vazio sai inteiro, também a linha do provedor (misturava as fases
  // e a tabela anual o substitui)
  if (dropEmpty)
    await db.delete(standing).where(and(eq(standing.seasonId, seasonId), eq(standing.group, '')));
  const keep = tables.flatMap((t) => t.rows.map((r) => sql`(${t.group}, ${r.teamId}::uuid)`));
  if (!keep.length) return;
  const written = [...new Set(tables.map((t) => t.group))];
  const scope = written.includes('') ? written : [...written, ''];
  // os grupos deduzidos (`unnamed:N`) são refeitos a cada recálculo: os de antes que não voltaram também saem
  await db
    .delete(standing)
    .where(
      and(
        eq(standing.seasonId, seasonId),
        eq(standing.source, 'computed'),
        sql`(${inArray(standing.group, scope)} or ${standing.group} like ${`${UNNAMED_GROUP_PREFIX}%`})`,
        sql`(${standing.group}, ${standing.participantId}) not in (${sql.join(keep, sql`, `)})`,
      ),
    );
}

/**
 * Beisebol: tabela única por aproveitamento com os jogos da fase regular (sem fase ou fase de tabela; os
 * playoffs ficam de fora). Fica fora do #880: a calculada é uma tabela única, e a do fornecedor vem por liga
 * e divisão, então a do fornecedor mais nova que o último resultado continua prevalecendo (gravar a calculada
 * por cima criaria uma tabela paralela de 30 times ao lado das divisões).
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
  const [computed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(standing)
    .where(and(eq(standing.seasonId, seasonId), eq(standing.source, 'computed')));
  // grupo com tabela calculada: o writer não grava mais a do fornecedor nele, então só o recálculo o mantém
  if (provider?.at && latest?.at && !computed?.n && new Date(provider.at) >= new Date(latest.at)) {
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
