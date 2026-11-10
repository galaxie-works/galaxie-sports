/**
 * Preparo de uma pergunta ao assistente da Cosmos (#1003), só no servidor: valida a entrada, busca na
 * documentação, monta o prompt e estima os créditos. A rota em fluxo e a estimativa da tela usam o mesmo preparo,
 * então o "cerca de N créditos" mostrado antes é o mesmo que a reserva pede.
 */
import {
  activeFunctionMinCredits,
  ASSISTANT_FUNCTION,
  buildPrompt,
  estimateAssistantCredits,
  getWallet,
  readCosmosSettings,
  searchDocs,
  type ChatTurn,
  type CosmosSettings,
  type ScreenContext,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/config';

import { docChunks } from './assistant-docs';

export const QUESTION_MAX = 2000;
const VISIBLE_MAX = 6000;
const HISTORY_MAX = 8;
const TURN_MAX = 4000;

export interface AssistantRequest {
  question: string;
  context: ScreenContext;
  history: ChatTurn[];
}

/** Lê e corta a entrada do navegador (nada passa do tamanho combinado; o resto é descartado). */
export function parseAssistantRequest(body: unknown): AssistantRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question || question.length > QUESTION_MAX) return null;
  const c = (b.context ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const destinations = Array.isArray(c.destinations)
    ? c.destinations
        .filter(
          (d): d is { label: string; href: string } =>
            typeof d?.label === 'string' && typeof d?.href === 'string',
        )
        .filter((d) => d.href.startsWith('/'))
        .slice(0, 20)
        .map((d) => ({ label: d.label.slice(0, 80), href: d.href.slice(0, 200) }))
    : [];
  const history = Array.isArray(b.history)
    ? b.history
        .filter(
          (t): t is ChatTurn =>
            (t?.role === 'user' || t?.role === 'assistant') &&
            typeof t?.text === 'string' &&
            t.text.trim() !== '',
        )
        .slice(-HISTORY_MAX)
        .map((t) => ({ role: t.role, text: t.text.slice(0, TURN_MAX) }))
    : [];
  return {
    question,
    context: {
      route: str(c.route, 200) || '/',
      title: str(c.title, 200),
      visible: str(c.visible, VISIBLE_MAX),
      destinations,
    },
    history,
  };
}

export interface PreparedQuestion {
  prompt: ReturnType<typeof buildPrompt>;
  credits: number;
  settings: CosmosSettings;
}

/** Monta o prompt e a estimativa; null quando a função não está no catálogo (assistente indisponível). */
export async function prepareQuestion(
  tenantId: string,
  req: AssistantRequest,
  locale: Locale,
): Promise<PreparedQuestion | null> {
  const db = builderDb();
  const [settings, minCredits, wallet] = await Promise.all([
    readCosmosSettings(db),
    activeFunctionMinCredits(db, ASSISTANT_FUNCTION),
    getWallet(db, tenantId),
  ]);
  if (minCredits === null) return null;
  const docs = searchDocs(req.question, docChunks(getDictionary(locale).docs));
  const prompt = buildPrompt({
    question: req.question,
    context: req.context,
    docs,
    history: req.history,
    locale,
  });
  const credits = estimateAssistantCredits({
    system: prompt.system,
    messages: prompt.messages,
    creditUsd: settings.creditUsd,
    multiplier: wallet?.multiplier ?? 1,
    minCredits,
  });
  return { prompt, credits, settings };
}

/** Chave do provedor só da Cosmos (separada da dos agentes internos); vazia = assistente indisponível. */
export function assistantApiKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.COSMOS_ANTHROPIC_API_KEY?.trim() || null;
}
