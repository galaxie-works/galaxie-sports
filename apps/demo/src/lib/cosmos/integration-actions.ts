'use server';

/**
 * Ações da ajuda de integração da Cosmos (#1007): diagnóstico das chaves, das entregas de um webhook e o relatório de
 * uso do mês. O tenant e o cargo saem da sessão; do navegador só vem o id do webhook.
 */
import { readClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

import { isHelpKind, type HelpAnswer } from './integration-help';
import { diagnoseKeys, diagnoseWebhook, reportUsage, type HelpTaskError } from './integration-tasks';

export type HelpActionResult = { ok: true; answer: HelpAnswer | null } | { ok: false; error: string };

export async function askCosmosHelp(input: {
  kind: unknown;
  webhookId?: unknown;
}): Promise<HelpActionResult> {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const T = getDictionary(locale).client.cosmosHelp.errors;
  const message = (code: HelpTaskError) => T[code] ?? T.failed;
  if (!ctx?.tenant) return { ok: false, error: T.unauthorized };
  if (!isHelpKind(input.kind)) return { ok: false, error: T.failed };
  let r;
  if (input.kind === 'keys') r = await diagnoseKeys(ctx, locale);
  else if (input.kind === 'usage') r = await reportUsage(ctx, locale);
  else {
    if (!isUuid(input.webhookId)) return { ok: false, error: T.notFound };
    r = await diagnoseWebhook(ctx, input.webhookId, locale);
  }
  return r.ok ? r : { ok: false, error: message(r.error) };
}
