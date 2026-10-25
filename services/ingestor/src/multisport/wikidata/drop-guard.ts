/**
 * Proteção contra perda de dados nas cargas do Wikidata que substituem o que está gravado (medalhas de uma edição,
 * títulos de uma competição): resposta vazia ou muito menor que o gravado é quase sempre falha da fonte (WDQS
 * fora, consulta cortada, item editado no meio), não o histórico que encolheu. Nesses casos a remoção não roda.
 */

/** Fração mínima do que está gravado que a fonte nova precisa trazer para a substituição valer. */
export const MIN_KEPT_RATIO = 0.5;

/**
 * Motivo para não substituir `before` linhas gravadas por `after` linhas da fonte, ou null se a troca é segura.
 * Sem nada gravado, qualquer resultado vale.
 */
export function suspiciousDrop(before: number, after: number): string | null {
  if (before <= 0) return null;
  if (after === 0) return `a fonte veio vazia e há ${before} gravado(s)`;
  if (after < before * MIN_KEPT_RATIO)
    return `queda abrupta: ${before} gravado(s), a fonte trouxe ${after} (menos de ${MIN_KEPT_RATIO * 100}%)`;
  return null;
}
