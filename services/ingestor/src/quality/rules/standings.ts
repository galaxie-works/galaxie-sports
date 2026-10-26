/**
 * Classificação: a tabela recalculada pelo nosso motor (`@galaxie/rules`, o mesmo do `standings:recompute`) contra a
 * tabela do fornecedor, nas temporadas atuais de futebol das competições tier 1. Só compara o time com o mesmo
 * número de jogos dos dois lados (tabela do fornecedor atrasada não é erro de regra).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { participant, stage, standing, type Database } from '@galaxie/db';
import { computeStandings, type MatchResult } from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { loadSeasonResults } from '@galaxie/rules/db';
import { TABLE_STAGE_KINDS } from '../../standings/recompute.js';
import type { QualityFailureItem, QualityRule } from '../types.js';

export interface TableLine {
  participantId: string;
  name: string;
  group: string;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

/** Linhas com o mesmo número de jogos e pontos ou saldo diferentes. */
export function compareTables(
  provider: readonly TableLine[],
  computed: readonly Omit<TableLine, 'name'>[],
): { compared: number; diffs: { line: TableLine; computed: Omit<TableLine, 'name'> }[] } {
  const ours = new Map(computed.map((c) => [`${c.group}|${c.participantId}`, c]));
  let compared = 0;
  const diffs: { line: TableLine; computed: Omit<TableLine, 'name'> }[] = [];
  for (const line of provider) {
    const c = ours.get(`${line.group}|${line.participantId}`);
    if (!c || c.played !== line.played) continue;
    compared += 1;
    if (c.points !== line.points || c.goalsFor - c.goalsAgainst !== line.goalsFor - line.goalsAgainst)
      diffs.push({ line, computed: c });
  }
  return { compared, diffs };
}

async function seasonTable(db: Database, seasonId: string, slug: string, year: number) {
  const rules = await loadCompetitionRules(slug, {
    season: year,
    fallbackToDefault: true,
    ...(process.env.RULES_CONFIG_DIR ? { dir: process.env.RULES_CONFIG_DIR } : {}),
  });
  if (rules.format === 'cup') return null;
  const stages = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.seasonId, seasonId), inArray(stage.kind, [...TABLE_STAGE_KINDS])));
  const [any] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stage)
    .where(eq(stage.seasonId, seasonId));
  const stageIds = stages.length || (any?.n ?? 0) > 0 ? stages.map((s) => s.id) : undefined;
  if (stageIds && !stageIds.length) return null;

  const provider = await db
    .select({
      participantId: standing.participantId,
      name: participant.name,
      group: standing.group,
      played: standing.played,
      points: standing.points,
      goalsFor: standing.goalsFor,
      goalsAgainst: standing.goalsAgainst,
    })
    .from(standing)
    .innerJoin(participant, eq(participant.id, standing.participantId))
    .where(and(eq(standing.seasonId, seasonId), eq(standing.source, 'provider')));
  if (!provider.length) return null;
  const groupOf = new Map(provider.map((r) => [r.participantId, r.group]));
  const groups = new Set(provider.map((r) => r.group));
  const single = groups.size === 1 ? [...groups][0]! : null;
  const matches: MatchResult[] = [];
  for (const m of await loadSeasonResults(db, seasonId, {
    includeCards: true,
    ...(stageIds ? { stageIds } : {}),
  })) {
    if (single !== null) matches.push({ ...m, group: single });
    else if (groupOf.get(m.homeId) !== undefined && groupOf.get(m.homeId) === groupOf.get(m.awayId))
      matches.push({ ...m, group: groupOf.get(m.homeId)! });
  }
  if (!matches.length) return null;
  const computed = computeStandings({ rules, matches }).flatMap((t) =>
    t.rows.map((r) => ({
      participantId: r.teamId,
      group: t.group,
      played: r.played,
      points: r.points,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
    })),
  );
  return { provider, computed };
}

export type SeasonRef = {
  id: string;
  slug: string;
  name: string;
  year: number;
  competition_id: string;
};

type SeasonTable = { provider: TableLine[]; computed: Omit<TableLine, 'name'>[] } | null;

/**
 * Confere cada temporada. A que não deu para recalcular (regulamento quebrado, consulta com erro) vira falha com a
 * mensagem, em vez de sumir do placar; se nenhuma tabela foi conferida e houve erro, a regra sai como `error`.
 */
export async function compareSeasons(
  seasons: readonly SeasonRef[],
  tableOf: (s: SeasonRef) => Promise<SeasonTable>,
  log: (msg: string) => void,
): Promise<{ checked: number; failures: QualityFailureItem[] }> {
  let checked = 0;
  let tables = 0;
  const errors: string[] = [];
  const failures: QualityFailureItem[] = [];
  for (const s of seasons) {
    let table;
    try {
      table = await tableOf(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`classificação de ${s.slug} ${s.year}: ${msg}`);
      errors.push(`${s.slug} ${s.year}: ${msg}`);
      failures.push({
        key: `${s.id}:erro`,
        label: `${s.name} ${s.year}`,
        current: `erro ao recalcular: ${msg}`,
        expected: 'tabela recalculada pelo motor',
        link: { type: 'competition', id: s.competition_id },
      });
      continue;
    }
    if (!table) continue;
    tables += 1;
    const { compared, diffs } = compareTables(table.provider, table.computed);
    checked += compared;
    for (const { line, computed } of diffs)
      failures.push({
        key: `${s.id}:${line.group}:${line.participantId}`,
        label: `${s.name} ${s.year}${line.group ? ` (${line.group})` : ''} · ${line.name}`,
        current: `nosso: ${computed.points} pts, saldo ${computed.goalsFor - computed.goalsAgainst}`,
        expected: `fornecedor: ${line.points} pts, saldo ${line.goalsFor - line.goalsAgainst} (${line.played} J)`,
        link: { type: 'competition', id: s.competition_id },
      });
  }
  if (errors.length && !tables)
    throw new Error(`nenhuma temporada recalculada (${errors.length} com erro; ${errors[0]})`);
  return { checked, failures };
}

export const STANDINGS_RULES: QualityRule[] = [
  {
    id: 'standings.recomputed-matches-provider',
    sport: 'football',
    area: 'standings',
    severity: 'high',
    description: {
      'pt-BR':
        'A classificação recalculada pelos resultados bate com a do fornecedor (tier 1, temporada atual)',
      en: 'The table recomputed from results matches the provider table (tier 1, current season)',
      es: 'La tabla recalculada con los resultados coincide con la del proveedor (tier 1, temporada actual)',
    },
    check: async (ctx) => {
      const seasons = await ctx.db.execute<SeasonRef>(sql`
        select s.id::text, c.slug, c.name, s.year, c.id::text as competition_id
          from core.season s join core.competition c on c.id = s.competition_id
         where c.sport = 'football' and c.tier = 1 and s.current
           and exists (select 1 from core.standing st where st.season_id = s.id and st.source = 'provider')`);
      return compareSeasons(seasons, (x) => seasonTable(ctx.db, x.id, x.slug, x.year), ctx.log);
    },
  },
];
