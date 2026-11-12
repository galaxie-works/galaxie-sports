'use server';

/**
 * Ações do texto de pré e pós-jogo (#1009): pedir o rascunho na página do jogo e salvar o guia de tom nas
 * configurações da Cosmos. O tenant e o cargo saem da sessão.
 */
import type { BrandVoice } from '@galaxie/cosmos';

import { readClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

import type { MatchText } from './match-text';
import {
  draftMatchText,
  isContentLocale,
  saveTenantBrandVoice,
  type MatchTextError,
} from './match-text-tasks';

async function texts() {
  const locale = await getRequestLocale();
  return getDictionary(locale).client.cosmosMatchText.errors;
}

const message = (T: Record<string, string>, code: MatchTextError) => T[code] ?? T.failed!;

export async function draftMatchTextWithCosmos(input: {
  eventId: unknown;
  kind: unknown;
  locale: unknown;
}): Promise<{ ok: true; text: MatchText } | { ok: false; error: string }> {
  const [ctx, T] = await Promise.all([readClientContext(), texts()]);
  if (!ctx?.tenant) return { ok: false, error: T.unauthorized };
  if (typeof input.eventId !== 'string' || !isUuid(input.eventId)) return { ok: false, error: T.event };
  if (input.kind !== 'pre' && input.kind !== 'post') return { ok: false, error: T.failed };
  if (!isContentLocale(input.locale)) return { ok: false, error: T.failed };
  const r = await draftMatchText(ctx, input.eventId, input.kind, input.locale);
  return r.ok ? r : { ok: false, error: message(T, r.error) };
}

export async function saveBrandVoiceAction(
  input: unknown,
): Promise<{ ok: true; voice: BrandVoice } | { ok: false; error: string }> {
  const [ctx, T] = await Promise.all([readClientContext(), texts()]);
  if (!ctx?.tenant) return { ok: false, error: T.unauthorized };
  const r = await saveTenantBrandVoice(ctx, input);
  return r.ok ? r : { ok: false, error: message(T, r.error) };
}
