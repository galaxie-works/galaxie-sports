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
