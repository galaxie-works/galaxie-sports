import type { Dictionary } from '@/lib/i18n/dictionary';

/** Só os assuntos que vão ao navegador (nav e review). */
type T = Pick<Dictionary, 'nav' | 'review'>;
import type { ReviewState } from '@/lib/review/types';

/** Cor do status na lista e no detalhe. */
export const STATE_BADGE = {
  draft: 'outline',
  needs_review: 'warning-light',
  reviewed: 'info-light',
  approved: 'success-light',
} as const satisfies Record<ReviewState, string>;

/** Nome do esporte no idioma da tela (o glossário multiesporte e esportes sem rótulo ficam com o slug). */
export const sportLabel = (t: T, sport: string) => (t.nav.sports as Record<string, string>)[sport] ?? sport;

/** Nome do país/mercado (`INT` = clássico entre países). */
export const marketLabel = (t: T, market: string) =>
  market === 'INT'
    ? t.review.filters.international
    : ((t.nav.countries as Record<string, string>)[market] ?? market);
