import { eq } from 'drizzle-orm';
import { competition, type Database } from '@galaxie/db';
import { slugify } from './slug.js';

/**
 * Slug de competição fora do catálogo: país e nome, sem número do fornecedor e sem repetir o trecho
 * comum (`World` + `World Cup` -> `world-cup`). Apóstrofo não separa palavra (`Seven's` -> `sevens`).
 * Futebol não usa isto: os slugs dele seguem congelados.
 */
export function competitionSlugBase(country: string, name: string): string {
  const head = slugify(country).split('-').filter(Boolean);
  const tail = slugify(name.replace(/['’]/g, '')).split('-').filter(Boolean);
  for (let k = Math.min(head.length, tail.length); k > 0; k -= 1) {
    if (head.slice(-k).join('-') === tail.slice(0, k).join('-')) {
      return [...head, ...tail.slice(k)].join('-');
    }
  }
  return [...head, ...tail].join('-');
}

/**
 * Primeiro slug livre entre `base`, `base-esporte` e `base-esporte-id`. A checagem é entre todos os
 * esportes porque a API e o site acham a competição só pelo slug, sem o esporte.
 */
export async function uniqueCompetitionSlug(
  db: Pick<Database, 'select'>,
  base: string,
  sport: string,
  providerId: string,
): Promise<string> {
  const last = `${base}-${sport}-${slugify(providerId)}`;
  for (const candidate of [base, `${base}-${sport}`]) {
    const [taken] = await db
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return last;
}
