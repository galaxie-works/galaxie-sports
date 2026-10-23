/**
 * Tabela do hóquei: o fornecedor separa as vitórias e as derrotas na prorrogação ou nos pênaltis, que valem
 * pontos diferentes (NHL: 2/2/1/0; Europa e IIHF: 3/2/1/0). A API entrega `won`/`lost` com o total e
 * `ot_won`/`ot_lost` com a parte na prorrogação; aqui a linha vira V · VP · DP · D. Uma linha sem a
 * separação (tabela calculada, dado antigo) devolve null para a tabela inteira, que fica com V/D totais.
 */
export interface HockeyStandingRow {
  won: number;
  lost: number;
  ot_won: number | null;
  ot_lost: number | null;
}

export interface HockeySplit {
  /** Vitórias no tempo normal. */
  won: number;
  otWon: number;
  otLost: number;
  /** Derrotas no tempo normal. */
  lost: number;
}

export function hockeySplit(rows: readonly HockeyStandingRow[]): HockeySplit[] | null {
  if (!rows.length) return null;
  const split = rows.map((r) =>
    r.ot_won == null || r.ot_lost == null
      ? null
      : { won: r.won - r.ot_won, otWon: r.ot_won, otLost: r.ot_lost, lost: r.lost - r.ot_lost },
  );
  return split.every((s) => s != null && s.won >= 0 && s.lost >= 0) ? (split as HockeySplit[]) : null;
}
