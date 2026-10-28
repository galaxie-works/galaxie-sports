import { standingsTableOf } from '../config/parse.js';
import type { CompetitionRules, StandingsTableRule, TableName } from '../config/types.js';

/**
 * Tabelas da temporada por regulamento (`tables:` em config/rules): papel de cada grupo de `core.standing`
 * (fase, anual, promedios), nome exibido e a fase em andamento. Funções puras, usadas pelo recálculo e
 * pela API.
 */

type Lang = keyof TableName;

function langOf(locale: string): Lang {
  const l = locale.toLowerCase();
  if (l.startsWith('pt')) return 'pt-BR';
  if (l.startsWith('es')) return 'es';
  return 'en';
}

function pick(name: TableName, lang: Lang): string {
  return name[lang] ?? (lang === 'en' ? undefined : name.es) ?? name['pt-BR'];
}

const SUBGROUP: TableName = { 'pt-BR': 'Grupo', es: 'Grupo', en: 'Group' };

/**
 * Nome exibido do grupo: o da tabela no regulamento, com a letra/número do subgrupo quando o grupo do
 * fornecedor tem um ("Apertura - Group A" → "Apertura · Zona A" com `subgroup_label: { es: Zona }`).
 */
export function standingsGroupLabel(table: StandingsTableRule, group: string, locale: string): string {
  const lang = langOf(locale);
  const base = pick(table.name, lang);
  const sub = /\b(?:group|grupo|zona|zone)\s+([a-z0-9]+)\b/i.exec(group)?.[1];
  if (!sub) return base;
  return `${base} · ${pick(table.subgroupLabel ?? SUBGROUP, lang)} ${sub.toUpperCase()}`;
}

/**
 * Grupos de nome reservado que o recálculo grava quando a competição não tem `tables:` no regulamento
 * (services/ingestor/src/standings/phases-auto.ts): `first_phase`, `annual` e `unnamed:<n>`.
 */
const AUTO_GROUP_NAMES: Record<'annual' | 'first_phase' | 'unnamed', TableName> = {
  annual: { 'pt-BR': 'Tabela anual', es: 'Tabla anual', en: 'Annual table' },
  first_phase: { 'pt-BR': '1ª fase', es: 'Primera fase', en: 'First phase' },
  unnamed: { 'pt-BR': 'Grupo sem nome', es: 'Grupo sin nombre', en: 'Unnamed group' },
};
const UNNAMED = /^unnamed:(\d+)$/;

/** Nome exibido de um grupo reservado do recálculo sem regulamento; null para os nomes do fornecedor. */
export function autoGroupLabel(group: string, locale: string): string | null {
  const lang = langOf(locale);
  if (group === 'annual' || group === 'first_phase') return pick(AUTO_GROUP_NAMES[group], lang);
  const n = UNNAMED.exec(group)?.[1];
  return n ? `${pick(AUTO_GROUP_NAMES.unnamed, lang)} ${n}` : null;
}

/** Ordem dos grupos sem regulamento: 1ª fase, os do fornecedor, os deduzidos e a tabela anual no fim. */
export function autoGroupRank(group: string): number {
  if (group === 'first_phase') return 0;
  if (group === 'annual') return 1e6;
  const n = UNNAMED.exec(group)?.[1];
  return n ? 1000 + Number(n) : 1;
}

export interface GroupActivity {
  group: string;
  /** Maior número de jogos de um time no grupo. */
  played: number;
}

/**
 * Fase em andamento: a última fase do regulamento (ordem do YAML = ordem cronológica) com jogo disputado em
 * algum dos seus grupos; sem jogo em nenhuma, a primeira fase com grupo. Null sem fase classificada.
 */
export function currentPhaseKey(
  rules: Pick<CompetitionRules, 'tables'>,
  groups: readonly GroupActivity[],
): string | null {
  const phases = rules.tables.filter((t) => t.kind === 'phase');
  const byPhase = new Map<string, GroupActivity[]>();
  for (const g of groups) {
    const t = standingsTableOf(rules, g.group);
    if (t?.kind !== 'phase') continue;
    byPhase.set(t.key, [...(byPhase.get(t.key) ?? []), g]);
  }
  let current: string | null = null;
  for (const p of phases) if (byPhase.get(p.key)?.some((g) => g.played > 0)) current = p.key;
  return current ?? phases.find((p) => byPhase.has(p.key))?.key ?? null;
}

/** Prioridade da linha de um time para "a posição dele na competição" (menor = mais importante). */
export function standingsGroupPriority(
  rules: Pick<CompetitionRules, 'tables'>,
  group: string,
  currentPhase: string | null,
): number {
  const t = standingsTableOf(rules, group);
  if (!t) return 3;
  if (t.kind === 'phase') return t.key === currentPhase ? 0 : 1;
  if (t.kind === 'annual') return 2;
  if (t.kind === 'other') return 4;
  return 5;
}

export interface SeedRow {
  group: string;
  participantId: string;
  rank: number;
}

/**
 * Posição dos dois times na tabela de referência do mata-mata decidido pela campanha (`knockout.seeding`):
 * a rodada do mata-mata (rótulo do fornecedor, ex.: "Apertura - Quarter-finals") aponta a tabela (Apertura),
 * e vale o grupo dela que tem os dois. Sem entrada para a rodada ou sem os dois no mesmo grupo, undefined.
 */
export function knockoutSeed(
  rules: Pick<CompetitionRules, 'tables' | 'knockout'>,
  stageLabel: string | null,
  rows: readonly SeedRow[],
  homeId: string,
  awayId: string,
): { home: number; away: number } | undefined {
  const entry = rules.knockout?.seeding.find((sd) => sd.rounds.test(stageLabel ?? ''));
  if (!entry) return undefined;
  const byGroup = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (standingsTableOf(rules, r.group)?.key !== entry.table) continue;
    byGroup.set(r.group, (byGroup.get(r.group) ?? new Map<string, number>()).set(r.participantId, r.rank));
  }
  for (const ranks of byGroup.values()) {
    const home = ranks.get(homeId);
    const away = ranks.get(awayId);
    if (home !== undefined && away !== undefined) return { home, away };
  }
  return undefined;
}

/**
 * Fase de um jogo de rodada que o regulamento não reconhece (estágio `group`/`league_phase` com rótulo novo),
 * pelos grupos de `core.standing`: só quando é inequívoca. Entre as tabelas de fase e as auxiliares (`other`,
 * ex.: quadrangulares da Colômbia), tem de haver exatamente uma com um grupo que contém os dois times; ela tem
 * de ser uma fase; e esse grupo tem de separar times (não conter a tabela inteira), porque numa tabela única
 * quaisquer dois times "estão no mesmo grupo" e isso não diz nada sobre a fase. Sem isso, null: o jogo fica
 * fora (vai para o relatório) em vez de pôr, por exemplo, um quadrangular na tabela do torneio.
 */
export function unknownRoundPhase(
  rules: Pick<CompetitionRules, 'tables'>,
  rows: readonly Pick<SeedRow, 'group' | 'participantId'>[],
  homeId: string,
  awayId: string,
): StandingsTableRule | null {
  const byTable = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    if (r.group === '') continue;
    const t = standingsTableOf(rules, r.group);
    if (!t || (t.kind !== 'phase' && t.kind !== 'other')) continue;
    const groups = byTable.get(t.key) ?? new Map<string, Set<string>>();
    groups.set(r.group, (groups.get(r.group) ?? new Set<string>()).add(r.participantId));
    byTable.set(t.key, groups);
  }
  const shared = (key: string) =>
    [...(byTable.get(key)?.values() ?? [])].filter((teams) => teams.has(homeId) && teams.has(awayId));
  const candidates = rules.tables.filter((t) => shared(t.key).length > 0);
  if (candidates.length !== 1) return null;
  const table = candidates[0]!;
  if (table.kind !== 'phase') return null;
  const everyone = new Set([...byTable.get(table.key)!.values()].flatMap((teams) => [...teams]));
  return shared(table.key).some((teams) => teams.size < everyone.size) ? table : null;
}
