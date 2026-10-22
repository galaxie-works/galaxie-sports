/**
 * Composição da home "Explorar": que cards ganham destaque (grade bento), o matiz de cada esporte e as
 * unidades dos contadores. Módulo puro (servidor e testes); os dados vêm de `/v1/explore/summary`.
 */
import type { CountryCode, SportNav } from './navigation';

/** Esporte em destaque: card grande no início da grade. */
export const FEATURED_SPORT: SportNav['slug'] = 'football';

/** Países em destaque (card largo, com o jogo em destaque ampliado). */
export const FEATURED_COUNTRIES: readonly CountryCode[] = ['BR', 'AR'];

/**
 * Matiz (OKLCH) do fundo de cada esporte: variações em torno do índigo da marca (279), do azul ao
 * violeta, para cada card ter identidade sem virar arco-íris.
 */
export const SPORT_HUES: Record<SportNav['slug'] | 'multisport', number> = {
  football: 279,
  basketball: 300,
  nba: 262,
  volleyball: 248,
  'formula-1': 312,
  mma: 292,
  'american-football': 268,
  baseball: 255,
  hockey: 238,
  handball: 286,
  rugby: 272,
  afl: 296,
  multisport: 305,
};

/** Matiz neutro (o da marca) dos cards de país: a cor fica por conta da bandeira. */
export const BRAND_HUE = 279;

export type ParticipantUnit = 'teams' | 'participants' | 'fighters';
export type EventUnit = 'games' | 'events';

/** Como contar os participantes e os eventos de cada esporte ("9.094 times", "24 lutadores"). */
export function sportUnits(slug: string): { participants: ParticipantUnit; events: EventUnit } {
  if (slug === 'formula-1') return { participants: 'participants', events: 'events' };
  if (slug === 'mma') return { participants: 'fighters', events: 'events' };
  return { participants: 'teams', events: 'games' };
}

/**
 * Ordem e tamanho dos cards de um grupo de países: os em destaque primeiro (o do mercado do idioma à
 * frente) e largos; num grupo de até dois países, todos largos, para não sobrar um card solto na grade.
 */
export function countryLayout(
  codes: readonly CountryCode[],
  homeMarket: string,
  featured: readonly CountryCode[] = FEATURED_COUNTRIES,
): { code: CountryCode; wide: boolean }[] {
  const rank = (code: CountryCode) => (code === homeMarket ? 0 : featured.includes(code) ? 1 : 2);
  // só os em destaque mudam de lugar; o resto segue a ordem do menu
  return codes
    .map((code, i) => ({ code, i }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.i - b.i)
    .map(({ code }) => ({ code, wide: codes.length <= 2 || featured.includes(code) }));
}

/** Números grandes em forma curta ("9,1 mil", "9.1K"), pelo idioma. */
export function compactNumber(locale: string, n: number): string {
  return new Intl.NumberFormat(locale, { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);
}
