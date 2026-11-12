/**
 * Pedido de revisão da grade em texto livre (#1008), no servidor: lê a grade publicada da operadora do tenant e a
 * biblioteca do país, chama a função pela carteira (`runCosmosTask`) e devolve o rascunho conferido. Nada é enviado
 * aqui: o cliente confere e envia pela ação de sempre (`requestLineupReview`), que confere tudo de novo.
 */
import { activeFunctionMinCredits, parseModelJson, readCosmosSettings, runCosmosTask } from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import type { ClientContext } from '@/lib/client/session';
import type { Locale } from '@/lib/i18n/config';
import { readOperatorPortal } from '@/lib/lineup/server';

import {
  LINEUP_REVIEW_FUNCTION,
  LINEUP_REVIEW_MAX_OUTPUT_TOKENS,
  lineupCatalog,
  lineupReviewPrompt,
  parseLineupReviewAnswer,
  type LineupReviewDraft,
} from './lineup-review';
import { widgetTaskAccess, type WidgetTaskError } from './widget-tasks';

export type LineupReviewError = WidgetTaskError | 'noLineup';

/** Mesma regra das outras funções do painel: `settings.manage` com a Cosmos contratada. */
export const lineupReviewAccess = widgetTaskAccess;

export async function lineupReviewMinimum(): Promise<number | null> {
  return activeFunctionMinCredits(builderDb(), LINEUP_REVIEW_FUNCTION);
}

const LANGUAGE: Record<Locale, string> = {
  'pt-BR': 'Brazilian Portuguese',
  'es-AR': 'Spanish',
  en: 'English',
};

export async function draftLineupReview(
  ctx: ClientContext,
  text: string,
  locale: Locale,
): Promise<{ ok: true; draft: LineupReviewDraft } | { ok: false; error: LineupReviewError }> {
  const denied = lineupReviewAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const tenant = ctx.tenant!;
  const portal = await readOperatorPortal(tenant.id);
  if (!portal.lineup) return { ok: false, error: 'noLineup' };
  const catalog = lineupCatalog(portal.lineup, portal.library);
  const prompt = lineupReviewPrompt(catalog, text, LANGUAGE[locale]);
  const db = builderDb();
  const r = await runCosmosTask(
    db,
    {
      tenantId: tenant.id,
      userId: ctx.userId,
      functionName: LINEUP_REVIEW_FUNCTION,
      scope: 'lineup',
      system: prompt.system,
      message: prompt.message,
      maxOutputTokens: LINEUP_REVIEW_MAX_OUTPUT_TOKENS,
      evaluate: async (answer) => {
        const draft = parseLineupReviewAnswer(parseModelJson(answer), catalog);
        return { usable: draft !== null, value: draft! };
      },
      ...(ctx.role === 'admin' ? { staff: { route: '/cliente/grade#cosmos-review' } } : {}),
    },
    { settings: await readCosmosSettings(db) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, draft: r.value };
}
