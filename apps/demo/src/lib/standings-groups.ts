/**
 * Grupos de nome reservado que o recálculo das tabelas grava (services/ingestor/src/standings/phases.ts):
 * `first_phase` (1ª fase com todos os times), `annual` (soma dos torneios do ano) e `unnamed:<n>` (grupo
 * deduzido dos jogos quando o fornecedor não mandou o nome). Os outros nomes vêm do fornecedor.
 */
import { fill } from '@/lib/i18n/text';

export interface TableGroupLabels {
  annual: string;
  firstPhase: string;
  /** Com `{n}`. */
  unnamed: string;
}

const UNNAMED = /^unnamed:(\d+)$/;

/** Título da tabela; null quando o nome do grupo é do fornecedor (a página decide). */
export function tableGroupTitle(name: string | null, labels: TableGroupLabels): string | null {
  if (name === 'annual') return labels.annual;
  if (name === 'first_phase') return labels.firstPhase;
  const m = name ? UNNAMED.exec(name) : null;
  return m ? fill(labels.unnamed, { n: m[1]! }) : null;
}

/** 1ª fase primeiro, depois os grupos do fornecedor (na ordem da API), os deduzidos e a tabela anual no fim. */
export function orderTableGroups<T extends { name: string | null }>(groups: readonly T[]): T[] {
  const rank = (name: string | null) =>
    name === 'first_phase' ? 0 : name === 'annual' ? 3 : name && UNNAMED.test(name) ? 2 : 1;
  const unnamedNo = (name: string | null) => Number(UNNAMED.exec(name ?? '')?.[1] ?? 0);
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.name) - rank(b.g.name) || unnamedNo(a.g.name) - unnamedNo(b.g.name) || a.i - b.i)
    .map(({ g }) => g);
}
