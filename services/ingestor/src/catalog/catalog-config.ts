import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

/** Entrada de config/competitions/football.yaml. */
export interface CatalogCompetition {
  slug: string;
  name: string;
  country: string;
  type: 'league' | 'cup';
  api_sports_id: number | null;
  verify?: boolean;
  tier: number;
  region?: string;
  seasons_strategy?: string;
  live_priority?: 'high' | 'medium' | 'low' | 'none';
  labels?: Record<string, string>;
}

export async function loadFootballCatalog(path: string): Promise<CatalogCompetition[]> {
  const doc = parse(await readFile(path, 'utf8')) as { competitions?: CatalogCompetition[] };
  return doc.competitions ?? [];
}
