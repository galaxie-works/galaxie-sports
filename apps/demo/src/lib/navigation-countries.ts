/**
 * Países do menu lateral no navegador: os de `/v1/navigation` (pelo proxy autenticado da demo), que vêm do banco — os
 * países com liga nacional de primeira divisão no catálogo, na ordem da home. Até a resposta chegar, e com a API fora do
 * ar, o menu mostra a lista de reserva (`FALLBACK_COUNTRIES`).
 */
import type { Navigation } from '@galaxie/contracts';

import { countryNav, type CountryNav } from './navigation';

/** Chave do react-query (com o idioma: o nome do país vem traduzido pela API). */
export const NAV_COUNTRIES_QUERY_KEY = 'navigation-countries';

export interface NavCountry extends CountryNav {
  /** Nome no idioma pedido, como a API devolveu. */
  name: string;
}

export async function fetchNavigationCountries(
  fetchImpl: typeof fetch,
  locale: string,
): Promise<NavCountry[]> {
  const res = await fetchImpl(`/api/galaxie/v1/navigation?locale=${encodeURIComponent(locale)}`);
  if (!res.ok) throw new Error(`navigation ${res.status}`);
  const body = (await res.json()) as Pick<Navigation, 'countries'>;
  return body.countries.map((c) => ({ ...countryNav(c.code, c.confederation.code), name: c.name }));
}
