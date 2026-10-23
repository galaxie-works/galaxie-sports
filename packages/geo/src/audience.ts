import type { AudienceFile } from './schema.js';

/**
 * Importância até a qual a audiência vale inteira: a rodada comum de uma competição tier 1 (40 do tier +
 * 4 da fase). Acima disso ela preenche só a distância proporcional até 100 — o jogo grande já está
 * perto do topo, e somar a audiência inteira o empataria no teto com a rodada comum.
 */
export const AUDIENCE_FULL_UNTIL = 44;

/** Pontos de audiência que valem para um jogo com essa importância (inteiros, ≤ `points`). */
export function audienceFor(points: number, importance: number): number {
  if (points <= 0) return 0;
  const room = Math.max(0, 100 - importance);
  return Math.min(points, Math.round((points * room) / (100 - AUDIENCE_FULL_UNTIL)));
}

/** Competição com audiência num mercado (lista para a expressão SQL da API). */
export interface AudienceEntry {
  sport: string;
  slug: string;
  points: number;
}

/**
 * Audiência das competições por mercado (config/geo/market-audience.yaml): pontos somados à relevância
 * por país além do bônus do país (docs/06 §3.2). O mercado sobrescreve `common` na mesma competição.
 */
export class MarketAudience {
  private readonly common: Map<string, number>;
  private readonly byMarket = new Map<string, Map<string, number>>();

  constructor(file: AudienceFile = { schema_version: 1, common: {}, markets: {} }) {
    this.common = flatten(file.common);
    for (const [market, sports] of Object.entries(file.markets))
      this.byMarket.set(market, new Map([...this.common, ...flatten(sports)]));
  }

  /** Pontos da competição no mercado (GB cobre GB-ENG; mercado sem linha própria usa `common`). */
  points(market: string, sport: string | null | undefined, slug: string | null | undefined): number {
    if (!sport || !slug) return 0;
    return this.table(market).get(`${sport}|${slug}`) ?? 0;
  }

  /** Competições com audiência > 0 no mercado. */
  entries(market: string): AudienceEntry[] {
    return [...this.table(market)]
      .filter(([, points]) => points > 0)
      .map(([key, points]) => {
        const [sport, slug] = key.split('|') as [string, string];
        return { sport, slug, points };
      });
  }

  /** Mercados com linha própria. */
  markets(): string[] {
    return [...this.byMarket.keys()];
  }

  private table(market: string): Map<string, number> {
    return this.byMarket.get(market.toUpperCase().slice(0, 2)) ?? this.common;
  }
}

function flatten(sports: Record<string, Record<string, number>>): Map<string, number> {
  return new Map(
    Object.entries(sports).flatMap(([sport, comps]) =>
      Object.entries(comps).map(([slug, points]) => [`${sport}|${slug}`, points] as const),
    ),
  );
}
