/**
 * Texto de pré e pós-jogo no tom da marca (#1009), no servidor: lê o jogo, as estatísticas e o cenário ou resumo na
 * API, aplica o guia de tom salvo e chama a função pela carteira (`runCosmosTask`). Nada é publicado aqui: o cliente
 * recebe o rascunho para revisar e copiar.
 */
import { SUPPORTED_LOCALES, type SupportedLocale } from '@galaxie/contracts';
import {
  activeFunctionMinCredits,
  DEFAULT_BRAND_VOICE,
  parseBrandVoice,
  parseModelJson,
  readBrandVoice,
  readCosmosSettings,
  runCosmosTask,
  saveBrandVoice,
  type BrandVoice,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import type { ClientContext } from '@/lib/client/session';
import { getEvent, getEventContext, getStats } from '@/lib/galaxie/api';

import {
  allowedNumbers,
  CONTEXT_KIND,
  MATCH_TEXT_FUNCTION,
  MATCH_TEXT_MAX_OUTPUT_TOKENS,
  matchFacts,
  matchTextPrompt,
  parseMatchTextAnswer,
  type MatchText,
  type MatchTextKind,
} from './match-text';
import { widgetTaskAccess, type WidgetTaskError } from './widget-tasks';

export type MatchTextError = WidgetTaskError | 'event' | 'noContext' | 'invalid';

/** Mesma regra das outras funções do painel: `settings.manage` com a Cosmos contratada. */
export const matchTextAccess = widgetTaskAccess;

export async function matchTextMinimum(): Promise<number | null> {
  return activeFunctionMinCredits(builderDb(), MATCH_TEXT_FUNCTION);
}

export const isContentLocale = (v: unknown): v is SupportedLocale =>
  (SUPPORTED_LOCALES as readonly unknown[]).includes(v);

/** Idioma do texto pelo locale do conteúdo (o mesmo do cenário e do resumo). */
function languageOf(locale: SupportedLocale): string {
  if (locale === 'pt-BR') return 'Brazilian Portuguese';
  if (locale === 'en') return 'English';
  return `Spanish (${locale})`;
}

/** Guia do tenant (ou o padrão, para quem nunca salvou). */
export async function brandVoiceFor(tenantId: string): Promise<{ voice: BrandVoice; saved: boolean }> {
  const stored = await readBrandVoice(builderDb(), tenantId);
  return stored
    ? { voice: { tone: stored.tone, avoid: stored.avoid, length: stored.length }, saved: true }
    : { voice: DEFAULT_BRAND_VOICE, saved: false };
}

export async function saveTenantBrandVoice(
  ctx: ClientContext,
  input: unknown,
): Promise<{ ok: true; voice: BrandVoice } | { ok: false; error: MatchTextError }> {
  const denied = matchTextAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const voice = parseBrandVoice(input);
  if (!voice) return { ok: false, error: 'invalid' };
  await saveBrandVoice(builderDb(), ctx.tenant!.id, voice, ctx.userId);
  return { ok: true, voice };
}

export async function draftMatchText(
  ctx: ClientContext,
  eventId: string,
  kind: MatchTextKind,
  locale: SupportedLocale,
): Promise<{ ok: true; text: MatchText } | { ok: false; error: MatchTextError }> {
  const denied = matchTextAccess(ctx);
  if (denied) return { ok: false, error: denied };

  let data;
  try {
    data = await Promise.all([
      getEvent(eventId, locale),
      getStats(eventId, locale),
      getEventContext(eventId, locale),
    ]);
  } catch {
    return { ok: false, error: 'event' };
  }
  const [event, stats, context] = data;
  const start = context?.data.find((c) => c.kind === CONTEXT_KIND[kind])?.text.trim();
  if (!start) return { ok: false, error: 'noContext' };

  const facts = matchFacts(event, stats);
  const { voice } = await brandVoiceFor(ctx.tenant!.id);
  const allowed = allowedNumbers(facts, start);
  const prompt = matchTextPrompt({ kind, facts, context: start, voice, language: languageOf(locale) });
  const db = builderDb();
  const r = await runCosmosTask(
    db,
    {
      tenantId: ctx.tenant!.id,
      userId: ctx.userId,
      functionName: MATCH_TEXT_FUNCTION,
      scope: 'events',
      system: prompt.system,
      message: prompt.message,
      maxOutputTokens: MATCH_TEXT_MAX_OUTPUT_TOKENS,
      metadata: { kind, eventId, tone: voice.tone },
      evaluate: async (text) => {
        const parsed = parseMatchTextAnswer(parseModelJson(text), allowed, voice.avoid);
        return { usable: parsed.ok, value: parsed.ok ? parsed.text : null! };
      },
      ...(ctx.role === 'admin' ? { staff: { route: `/eventos/${eventId}#cosmos-text` } } : {}),
    },
    { settings: await readCosmosSettings(db) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: r.value };
}
