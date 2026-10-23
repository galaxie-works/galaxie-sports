/**
 * Pontos de bônus do rúgbi XV a partir da tabela do fornecedor, que só traz o total: no regulamento da
 * World Rugby a vitória vale 4 e o empate 2, e o resto é bônus (4+ tries e derrota por até 7 pontos, no
 * máximo 2 por jogo). Uma linha fora disso (rúgbi de 7, que pontua 3/2/1, ou punição) devolve null para a
 * tabela inteira: a coluna só aparece quando a conta fecha em todas as linhas.
 */
export interface RugbyStandingRow {
  points: number;
  played: number;
  won: number;
  drawn: number;
}

export function rugbyBonusPoints(rows: readonly RugbyStandingRow[]): number[] | null {
  if (!rows.length) return null;
  const bonus = rows.map((r) => r.points - 4 * r.won - 2 * r.drawn);
  return bonus.every((b, i) => b >= 0 && b <= 2 * rows[i]!.played) ? bonus : null;
}
