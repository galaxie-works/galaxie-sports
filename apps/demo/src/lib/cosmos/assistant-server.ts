/**
 * Preparo de uma pergunta ao assistente da Cosmos (#1003), só no servidor: valida a entrada, busca na
 * documentação, monta o prompt e estima os créditos. A rota em fluxo e a estimativa da tela usam o mesmo preparo,
 * então o "cerca de N créditos" mostrado antes é o mesmo que a reserva pede.
 */
import {
  activeFunction,
  ASSISTANT_STREAMERS,
  type AssistantStreamer,
  cosmosApiKey,
  type CosmosProvider,
  ASSISTANT_FUNCTION,
  buildPrompt,
  estimateAssistantCredits,
  getWallet,
  readCosmosSettings,
  searchDocs,
  type ChatTurn,
  type CosmosSettings,
  type ScreenContext,
  verifiedHistory,
} from '@galaxie/cosmos';
import type { Actor } from '@galaxie/engage';

import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
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
  /** Respostas vêm com a assinatura do servidor; sem ela, não entram no prompt (`verifiedHistory`). */
  history: (ChatTurn & { sig?: string })[];
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
        .map((t) => {
          const sig = (t as { sig?: unknown }).sig;
          // a resposta vai inteira (a assinatura é do texto exato); a pergunta é cortada
          return t.role === 'assistant'
            ? { role: t.role, text: t.text, ...(typeof sig === 'string' ? { sig: sig.slice(0, 100) } : {}) }
            : { role: t.role, text: t.text.slice(0, TURN_MAX) };
        })
        .filter((t) => t.text.length <= TURN_MAX * 4)
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
  /** Provedor e modelo da função no catálogo (#1088). */
  provider: CosmosProvider;
  model: string;
  /** Chamada ao provedor da função, já com a chave da Cosmos nele. */
  streamer: AssistantStreamer;
  apiKey: string;
}

/**
 * Monta o prompt e a estimativa no preço do modelo da função; null quando o assistente está indisponível: função
 * fora do catálogo ou desligada, provedor que o assistente ainda não chama, ou sem a chave da Cosmos nele.
 */
export async function prepareQuestion(
  scope: { tenantId: string; userId: string },
  req: AssistantRequest,
  locale: Locale,
): Promise<PreparedQuestion | null> {
  const tenantId = scope.tenantId;
  const db = builderDb();
  const [settings, fn, wallet] = await Promise.all([
    readCosmosSettings(db),
    activeFunction(db, ASSISTANT_FUNCTION),
    getWallet(db, tenantId),
  ]);
  if (!fn) return null;
  const streamer = ASSISTANT_STREAMERS[fn.provider];
  const apiKey = assistantApiKey(fn.provider);
  if (!streamer || !apiKey) return null;
  const docs = searchDocs(req.question, docChunks(getDictionary(locale).docs));
  const history = verifiedHistory(req.history, assistantSigningKey(), scope);
  const prompt = buildPrompt({ question: req.question, context: req.context, docs, history, locale });
  const credits = estimateAssistantCredits({
    system: prompt.system,
    messages: prompt.messages,
    creditUsd: settings.creditUsd,
    multiplier: wallet?.multiplier ?? 1,
    minCredits: fn.minCredits,
    model: fn.model,
  });
  return { prompt, credits, settings, provider: fn.provider, model: fn.model, streamer, apiKey };
}

/** Chave que assina as respostas do histórico (a mesma da sessão); sem ela, respostas antigas não voltam ao prompt. */
export function assistantSigningKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.BETTER_AUTH_SECRET?.trim() || null;
}

/**
 * Quem pode perguntar: o cliente do próprio tenant, com o módulo Cosmos AI no contrato e cargo que abre
 * `cosmos.assistant.ask` (#996; voluntário não). A equipe Galaxie acompanhando um tenant não gasta os créditos dele.
 */
export function assistantAccessError(ctx: {
  role: 'admin' | 'client';
  tenant: { id: string; modules: readonly string[] } | null;
  actor: Actor | null;
}): 'unauthorized' | 'staff' | 'module' | 'role' | null {
  if (!ctx.tenant) return 'unauthorized';
  if (ctx.role === 'admin') return 'staff';
  if (!ctx.tenant.modules.includes('cosmos_ai')) return 'module';
  if (!can(ctx, 'cosmos.assistant.ask')) return 'role';
  return null;
}

/**
 * Chave da Cosmos no provedor (COSMOS_<PROVEDOR>_API_KEY, separada das chaves da IA interna); vazia = o assistente
 * fica indisponível enquanto a função usar esse provedor.
 */
export function assistantApiKey(
  provider: CosmosProvider,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return cosmosApiKey(provider, env);
}
