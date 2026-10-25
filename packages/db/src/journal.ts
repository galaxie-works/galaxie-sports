/**
 * Ordem das migrations no `drizzle/meta/_journal.json`. O migrator do Drizzle só aplica a migration cujo
 * `when` (folderMillis) é maior que o `created_at` da última aplicada: uma migration renumerada no merge que
 * ficou com `when` menor que o da anterior é pulada em silêncio na produção (no CI, com banco vazio, passa).
 * E mudar o `when` de uma migration já aplicada faz o migrator rodá-la de novo.
 */

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export interface Journal {
  entries: JournalEntry[];
}

/**
 * Problemas do journal, vazio se estiver em ordem: `idx` sequencial, `when` estritamente crescente e, com o
 * journal da base (o `main` em que o PR entra), as migrations dela intactas e na mesma posição.
 */
export function journalProblems(head: Journal, base?: Journal): string[] {
  const problems: string[] = [];
  head.entries.forEach((e, i) => {
    if (e.idx !== i) problems.push(`${e.tag}: idx ${e.idx} na posição ${i} (esperado ${i})`);
    const prev = head.entries[i - 1];
    if (prev && !(e.when > prev.when))
      problems.push(
        `${e.tag}: when ${e.when} não é maior que o de ${prev.tag} (${prev.when}); ` +
          'o migrator pularia esta migration num banco que já tem a anterior. ' +
          `Corrija com when > ${prev.when} no journal (ex.: o horário atual em ms) ou regere a migration`,
      );
  });
  base?.entries.forEach((b, i) => {
    const e = head.entries[i];
    if (!e) problems.push(`${b.tag}: migration da base sumiu do journal`);
    else if (e.tag !== b.tag || e.when !== b.when)
      problems.push(
        `posição ${i}: a base tem ${b.tag} (when ${b.when}) e este journal tem ${e.tag} (when ${e.when}); ` +
          'migration já aplicada não muda (renumere só as novas, depois das da base)',
      );
  });
  return problems;
}
