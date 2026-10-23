import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

interface CatalogEntryBase {
  slug: string;
  name: string;
  country: string;
  /**
   * País que o fornecedor devolve quando está errado: se o /leagues trouxer este país, vale `country`
   * (a Súper Rugby Américas vem como "South-Africa" no rúgbi).
   */
  provider_country?: string;
  type: 'league' | 'cup';
  verify?: boolean;
  tier: number;
  region?: string;
  seasons_strategy?: string;
  live_priority?: 'high' | 'medium' | 'low' | 'none';
  /**
   * Prestígio editorial (0–10) somado à importância dos eventos (docs/06 §3): 10 nas principais copas
   * continentais e torneios de seleções, 5 nas secundárias e eliminatórias. Ausente = 0.
   */
  prestige?: number;
  labels?: Record<string, string>;
}

/** Entrada de config/competitions/football.yaml. */
export interface CatalogCompetition extends CatalogEntryBase {
  api_sports_id: number | null;
}

/**
 * Entrada de config/competitions/<esporte>.yaml (mesmo schema do futebol). `api_sports_id` é numérico na
 * maioria das APIs; na NBA v2 as ligas são texto (`standard`, `vegas`...) e na F1/MMA, que não têm entidade
 * de campeonato, é uma chave sintética documentada no próprio YAML (`world-championship`, `all-fights`).
 */
export interface SportCatalogCompetition extends CatalogEntryBase {
  api_sports_id: number | string | null;
}

export interface CompetitionCatalogFile<T> {
  sport: string;
  competitions: T[];
}

export async function loadFootballCatalog(path: string): Promise<CatalogCompetition[]> {
  const doc = parse(await readFile(path, 'utf8')) as { competitions?: CatalogCompetition[] };
  return doc.competitions ?? [];
}

/** Lê config/competitions/<esporte>.yaml; arquivo ausente equivale a catálogo vazio (tudo vira tier 3). */
export async function loadSportCatalog(path: string): Promise<SportCatalogCompetition[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const doc = parse(text) as { competitions?: SportCatalogCompetition[] } | null;
  return doc?.competitions ?? [];
}
