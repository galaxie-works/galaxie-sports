'use server';

/**
 * Ação do pedido de revisão em texto livre (#1008): o texto do cliente vira o rascunho do pedido. O envio continua
 * na ação de sempre (`requestLineupReview`), depois que o cliente confere.
 */
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

import { LINEUP_REVIEW_TEXT_MAX, type LineupReviewDraft } from './lineup-review';
import { draftLineupReview, type LineupReviewError } from './lineup-review-tasks';

export type LineupReviewActionResult = { ok: true; draft: LineupReviewDraft } | { ok: false; error: string };

export async function draftLineupReviewWithCosmos(input: {
  text: unknown;
}): Promise<LineupReviewActionResult> {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const T = getDictionary(locale).client.cosmosLineup.errors;
  if (!ctx?.tenant) return { ok: false, error: T.unauthorized };
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { ok: false, error: T.empty };
  if ([...text].length > LINEUP_REVIEW_TEXT_MAX)
    return { ok: false, error: fill(T.tooLong, { max: LINEUP_REVIEW_TEXT_MAX }) };
  const r = await draftLineupReview(ctx, text, locale);
  if (!r.ok) return { ok: false, error: T[r.error as LineupReviewError] ?? T.failed };
  return r;
}
