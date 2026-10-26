/**
 * Bandeiras dos países para o `CountryFlag` (navegador): código ISO em maiúsculas → URL da bandeira.
 * A fonte é /v1/countries, o catálogo inteiro, e não só os países do menu (/v1/navigation).
 */
import type { Country } from '@galaxie/contracts';

/** Chave do react-query (o exemplo público semeia o cache com as bandeiras locais). */
export const FLAGS_QUERY_KEY = ['country-flags'] as const;

export async function fetchFlags(fetchImpl: typeof fetch): Promise<Record<string, string | null>> {
  const res = await fetchImpl('/api/galaxie/v1/countries');
  if (!res.ok) throw new Error(`countries ${res.status}`);
  const { data } = (await res.json()) as { data: Pick<Country, 'code' | 'flag'>[] };
  return Object.fromEntries(data.map((c) => [c.code.toUpperCase(), c.flag]));
}
