/**
 * Ordem alfabética das opções de filtro e das listas: pt-BR, sem diferenciar acento nem caixa ("Áustria"
 * entre "Argentina" e "Bélgica") e com números em ordem natural ("Liga 2" antes de "Liga 10"). Idioma fixo
 * para o servidor e o navegador ordenarem igual (a hidratação não pode divergir).
 */
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

export const compareAlpha = (a: string, b: string): number => collator.compare(a, b);

/** Cópia da lista em ordem alfabética do rótulo. */
export function sortByLabel<T extends { label: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareAlpha(a.label, b.label));
}
