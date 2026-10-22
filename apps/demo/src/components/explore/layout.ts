/**
 * Grades da home "Explorar" (cards e esqueleto usam as mesmas). Esportes: 1 coluna no celular até 6 no
 * desktop, com o esporte em destaque ocupando a linha inteira no celular e 2×2 / 3×2 nas telas largas;
 * a conta fecha sem buracos (12 esportes + multiesporte). Países: 1 a 4 colunas, os largos em 2.
 */
export const SPORT_GRID =
  'grid grid-flow-dense grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';

export const FEATURED_SPORT_SPAN = 'sm:col-span-2 md:col-span-3 lg:col-span-2 lg:row-span-2 xl:col-span-3';

export const COUNTRY_GRID =
  'grid grid-flow-dense grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/** Grupos de países, na ordem da navegação. */
export const CONFEDERATIONS = ['CONMEBOL', 'CONCACAF', 'UEFA'] as const;
