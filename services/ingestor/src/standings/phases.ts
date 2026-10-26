/**
 * Recálculo das tabelas da temporada pelo regulamento (`tables:` em config/rules): Apertura e Clausura com as
 * suas rodadas e os seus grupos (zonas), a tabela anual com todas as fases e os promedios só do fornecedor.
 * Ligas latino-americanas têm várias tabelas por temporada; sem o regulamento, um time em dois grupos
 * (fase e anual, Apertura e Clausura) deixaria a tabela parada.
 */
import { and, eq } from 'drizzle-orm';
import { event, stage, type Database } from '@galaxie/db';
import {
  accumulate,
  computeStandings,
  rankRecords,
  standingsTableOf,
  TABLE_STAGE_KINDS,
  unknownRoundPhase,
  type CompetitionRules,
  type MatchResult,
  type StandingsTable,
  type StandingsTableRule,
} from '@galaxie/rules';
import { loadSeasonResults } from '@galaxie/rules/db';
import type { SkippedTable } from './recompute.js';

/** Linha já gravada em core.standing (de qualquer origem). */
export interface TableRow {
  participantId: string;
  group: string;
  source: string;
  updatedAt: Date;
}

export interface TablesByRule {
  tables: StandingsTable[];
  /** Jogos usados (soma das tabelas, um jogo pode contar na fase e na anual). */
  results: number;
  skipped: SkippedTable[];
  /** Grupos gravados que nenhuma tabela do regulamento reconhece. */
  unclassified: string[];
  /**
   * Rodadas de fase de grupos que nenhuma fase do regulamento reconhece. Contam só na fase inequívoca
   * (`unknownRoundPhase`: uma única tabela de fase ou auxiliar com os dois no mesmo grupo, e grupo que separa
   * times); fora isso ficam de fora. Nos dois casos o YAML precisa do rótulo.
   */
  unmatchedRounds: string[];
  /**
   * Tabelas do regulamento em que a do fornecedor é mais nova que o último resultado delas: prevalece e não
   * é recalculada (as outras tabelas da temporada seguem, como a anual que só existe calculada).
   */
  fresh: string[];
  /**
   * Grupos antigos de uma tabela renomeada pelo fornecedor: todo time deles está num grupo mais novo da
   * mesma tabela do regulamento, então são a mesma tabela sob o nome velho (a gravação os apaga).
   */
  superseded: string[];
}

/**
 * Grupo de cada time numa tabela: o grupo vazio de quem também tem grupo com nome é resíduo; dois grupos com
 * nome na mesma tabela (o fornecedor renomeou o grupo) ficam com o de linha mais recente.
 */
function membership(rows: readonly TableRow[]): Map<string, string> {
  const freshness = new Map<string, number>();
  for (const r of rows) freshness.set(r.group, Math.max(freshness.get(r.group) ?? 0, r.updatedAt.getTime()));
  const groupsOf = new Map<string, Set<string>>();
  for (const r of rows)
    groupsOf.set(r.participantId, (groupsOf.get(r.participantId) ?? new Set()).add(r.group));
  const out = new Map<string, string>();
  for (const [team, set] of groupsOf) {
    const named = [...set].filter((g) => g !== '');
    const pick = named.length
      ? named.sort((a, b) => freshness.get(b)! - freshness.get(a)! || a.localeCompare(b))[0]!
      : '';
    out.set(team, pick);
  }
  return out;
}

/**
 * Grupos com nome que o fornecedor renomeou: há na mesma tabela um grupo de linhas mais novas com todos os
 * times dele. Grupos de mesma idade (zonas de uma mesma carga, um geral ao lado das zonas) não contam.
 */
function renamedAway(rows: readonly TableRow[]): string[] {
  const freshness = new Map<string, number>();
  const teams = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.group === '') continue;
    freshness.set(r.group, Math.max(freshness.get(r.group) ?? 0, r.updatedAt.getTime()));
    teams.set(r.group, (teams.get(r.group) ?? new Set()).add(r.participantId));
  }
  return [...teams]
    .filter(([g, members]) =>
      [...teams].some(
        ([h, other]) =>
          h !== g && freshness.get(h)! > freshness.get(g)! && [...members].every((m) => other.has(m)),
      ),
    )
    .map(([g]) => g);
}

/** Regulamento da tabela: a matemática própria (zonas, times, jogos) por cima da competição. */
function rulesFor(rules: CompetitionRules, t: StandingsTableRule): CompetitionRules {
  return t.league ? { ...rules, league: t.league } : rules;
}

/**
 * Grupos com jogo entre eles contando para os dois lados (fecha interzonal): cada grupo acumula os jogos em
 * que algum time dele entrou e ordena só os seus times (o confronto direto fica entre os do grupo).
 */
function crossGroupTables(
  rules: CompetitionRules,
  matches: readonly MatchResult[],
  groupOf: ReadonlyMap<string, string>,
): StandingsTable[] {
  const groups = [...new Set(groupOf.values())].sort();
  return groups.map((group) => {
    const members = new Set([...groupOf].filter(([, g]) => g === group).map(([team]) => team));
    const touching = matches
      .filter((m) => members.has(m.homeId) || members.has(m.awayId))
      .map((m) => ({ ...m, group }));
    const all = accumulate({
      points: rules.standings.points,
      matches: touching,
      teams: [...members].map((teamId) => ({ teamId, group })),
    });
    const records = new Map([...all].filter(([team]) => members.has(team)));
    const inside = touching.filter((m) => members.has(m.homeId) && members.has(m.awayId));
    const opts = rules.league
      ? { meetingsPerPair: rules.league.meetingsPerPair, zones: rules.league.zones }
      : {};
    return { group, rows: rankRecords(records, inside, rules.standings, opts) };
  });
}

/** Calcula as tabelas do regulamento para a temporada (não grava). */
export async function computeTablesByRule(
  db: Database,
  seasonId: string,
  rules: CompetitionRules,
  tableRows: readonly TableRow[],
): Promise<TablesByRule> {
  const results = await loadSeasonResults(db, seasonId, { includeCards: true });
  const labels = await db
    .select({ id: event.id, label: stage.providerLabel, kind: stage.kind, updatedAt: event.updatedAt })
    .from(event)
    .innerJoin(stage, eq(stage.id, event.stageId))
    .where(and(eq(event.seasonId, seasonId), eq(event.status, 'finished')));
  const labelOf = new Map(labels.map((l) => [l.id, l.label ?? '']));
  const kindOf = new Map(labels.map((l) => [l.id, l.kind]));
  const resultAt = new Map(labels.map((l) => [l.id, l.updatedAt.getTime()]));
  const inRounds = (re: RegExp) => results.filter((m) => re.test(labelOf.get(m.id!) ?? ''));

  const rowsOf = new Map<string, TableRow[]>();
  const unclassified = new Set<string>();
  for (const r of tableRows) {
    const t = standingsTableOf(rules, r.group);
    if (!t) {
      // o grupo vazio calculado é resíduo do recálculo antigo (a limpeza o apaga); não é tabela desconhecida
      if (!(r.group === '' && r.source === 'computed')) unclassified.add(r.group || '(sem nome)');
      continue;
    }
    rowsOf.set(t.key, [...(rowsOf.get(t.key) ?? []), r]);
  }

  const phaseRounds = rules.tables.filter((t) => t.kind === 'phase' && t.rounds).map((t) => t.rounds!);
  const matchesPhase = (m: MatchResult) => phaseRounds.some((re) => re.test(labelOf.get(m.id!) ?? ''));
  // jogo de fase de grupos com rótulo que o regulamento não conhece: vai para a fase só quando ela é inequívoca
  // em todas as tabelas (um quadrangular da Colômbia, "Group A - 1", também "cabe" na tabela única do torneio,
  // e fica fora); rodada "regular" desconhecida pode ser mata-mata rotulado como rodada, e fica fora
  const orphans = results.filter((m) => TABLE_STAGE_KINDS.has(kindOf.get(m.id!) ?? '') && !matchesPhase(m));
  const orphanPhase = new Map(
    orphans.map((m) => [m.id!, unknownRoundPhase(rules, tableRows, m.homeId, m.awayId)?.key ?? null]),
  );
  const adopted = new Set<string>();
  const tables: StandingsTable[] = [];
  const skipped: SkippedTable[] = [];
  const fresh: string[] = [];
  const superseded = new Set<string>();
  let used = 0;
  for (const t of rules.tables) {
    const own = rowsOf.get(t.key) ?? [];
    for (const g of renamedAway(own)) superseded.add(g);
    const groupOf = membership(own);
    const chosen = new Set(groupOf.values());
    if (!t.computed) continue;
    const ownOrphans =
      t.kind === 'phase'
        ? orphans.filter((m) => {
            if (adopted.has(m.id!) || orphanPhase.get(m.id!) !== t.key) return false;
            const g = groupOf.get(m.homeId);
            if (!g || g !== groupOf.get(m.awayId)) return false;
            adopted.add(m.id!);
            return true;
          })
        : [];
    const matches = t.rounds
      ? [...inRounds(t.rounds), ...ownOrphans]
      : results.filter((m) => matchesPhase(m) || adopted.has(m.id!));
    if (!matches.length) continue; // fase que ainda não começou (ou já sem jogo no core): nada a gravar
    // tabela do fornecedor mais nova que o último resultado dela: prevalece (por tabela, não pela temporada:
    // a fase fresca do fornecedor não segura a anual que só existe calculada)
    const providerAt = Math.max(
      -Infinity,
      ...own.filter((r) => r.source === 'provider' && chosen.has(r.group)).map((r) => r.updatedAt.getTime()),
    );
    const lastResultAt = Math.max(...matches.map((m) => resultAt.get(m.id!) ?? 0));
    if (providerAt >= lastResultAt) {
      fresh.push(t.key);
      continue;
    }
    // a anual inclui todo time que já está numa tabela da temporada (sem jogo ainda: zerado)
    const known =
      t.kind === 'annual'
        ? [...new Set([...rowsOf.values()].flat().map((r) => r.participantId))]
        : [...groupOf.keys()];
    const groups = new Set(groupOf.values());
    const named = [...groups].filter((g) => g !== '');
    const tableRules = rulesFor(rules, t);
    let computed: StandingsTable[];
    try {
      if (named.length > 1) {
        if (t.kind === 'annual') {
          skipped.push({
            table: t.key,
            reason: `mais de um grupo na tabela anual (${named.sort().join(', ')})`,
          });
          continue;
        }
        computed = t.crossGroupMatches
          ? crossGroupTables(tableRules, matches, groupOf)
          : computeStandings({
              rules: tableRules,
              matches: matches.flatMap((m) => {
                const g = groupOf.get(m.homeId);
                return g !== undefined && g === groupOf.get(m.awayId) ? [{ ...m, group: g }] : [];
              }),
              teams: [...groupOf].map(([teamId, group]) => ({ teamId, group })),
            });
      } else {
        const group = named[0] ?? t.groupName;
        if (group === null) {
          skipped.push({ table: t.key, reason: 'sem os grupos do fornecedor para montar a tabela' });
          continue;
        }
        computed = computeStandings({
          rules: tableRules,
          matches: matches.map((m) => ({ ...m, group })),
          teams: known.map((teamId) => ({ teamId, group })),
        });
      }
    } catch (err) {
      skipped.push({ table: t.key, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const clash = computed.find((c) => tables.some((w) => w.group === c.group));
    if (clash) {
      skipped.push({
        table: t.key,
        reason: `grupo "${clash.group}" já gravado por outra tabela do regulamento`,
      });
      continue;
    }
    used += matches.length;
    tables.push(...computed.filter((c) => c.rows.length));
  }
  return {
    tables,
    results: used,
    skipped,
    unclassified: [...unclassified].sort(),
    unmatchedRounds: [...new Set(orphans.map((m) => labelOf.get(m.id!) ?? ''))].sort(),
    fresh,
    superseded: [...superseded].sort(),
  };
}
