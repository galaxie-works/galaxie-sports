import { ledgerSettingsFromEnv, type LedgerSettings } from '@galaxie/ai-ledger';
import { AI_PROVIDERS, AI_PROVIDER_KEY_ENV, defaultModelsOf, type AiProvider } from '@galaxie/runtime-config';
import { LlmError } from './errors.js';
import type { LlmTier } from './types.js';

// Estado e tetos do dia vivem no ledger compartilhado (@galaxie/ai-ledger): o ingestor lê as mesmas regras.
export {
  AGENT_STATUS_ENTRY,
  AGENT_USD_BUDGET_ENTRY,
  DEFAULT_AGENT_DEFAULT_USD_BUDGET,
  DEFAULT_AGENT_USD_BUDGETS,
  DEFAULT_DAILY_TOKEN_BUDGET,
  DEFAULT_DAILY_USD_BUDGET,
  ZERO_BUDGET_HINT,
  agentKey,
  agentStatusFromEnv,
  agentUsdBudgetsFromEnv,
  aiStatusFromEnv,
  describeAiState,
  ledgerSettingsFromEnv,
  parseAgentStatus,
  parseAgentUsdBudgets,
  type AiStatus,
  type LedgerSettings,
} from '@galaxie/ai-ledger';

// Provedores, chaves e modelos padrão: catálogo único no registro (@galaxie/runtime-config, #1437).
export type LlmProviderName = AiProvider;
export const LLM_PROVIDERS: readonly LlmProviderName[] = AI_PROVIDERS;

/** Modelos padrão por provedor e nível (do catálogo; sobrescreva com AI_MODEL_LIGHT / _STANDARD / _RESEARCH). */
export const DEFAULT_MODELS: Record<LlmProviderName, Record<LlmTier, string>> = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p, defaultModelsOf(p)]),
) as Record<LlmProviderName, Record<LlmTier, string>>;

/** Variável da chave de cada provedor. */
export const API_KEY_ENV: Readonly<Record<LlmProviderName, string>> = AI_PROVIDER_KEY_ENV;

/** Buscas na web por chamada (teto do provedor quando existe; senão instrução no prompt + alerta). */
export const DEFAULT_MAX_SEARCHES_PER_CALL = 5;

export interface LlmSettings extends LedgerSettings {
  provider: LlmProviderName;
  apiKey: string | undefined;
  models: Record<LlmTier, string>;
  /** Buscas na web por chamada; null = sem teto. */
  maxSearchesPerCall: number | null;
  /** Tentativas extras em erros transitórios (429, 5xx, timeout, saída fora do schema). */
  maxRetries: number;
  timeoutMs: number;
}

type Env = Record<string, string | undefined>;

function intEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0)
    throw new LlmError(`${name} precisa ser um inteiro ≥ 0.`, 'config', false);
  return n;
}

const isUnlimited = (raw: string | undefined) => {
  const v = raw?.trim().toLowerCase();
  return v === 'unlimited' || v === '0';
};

/** Lê AI_PROVIDER, chaves, modelos por nível e orçamento do ambiente. */
export function llmSettingsFromEnv(env: Env = process.env): LlmSettings {
  const provider = (env.AI_PROVIDER?.trim().toLowerCase() || 'openai') as LlmProviderName;
  if (!LLM_PROVIDERS.includes(provider))
    throw new LlmError(
      `AI_PROVIDER inválido: ${env.AI_PROVIDER} (use openai, anthropic, gemini ou deepseek).`,
      'config',
      false,
    );
  const defaults = DEFAULT_MODELS[provider];
  return {
    provider,
    apiKey: env[API_KEY_ENV[provider]]?.trim() || undefined,
    models: {
      light: env.AI_MODEL_LIGHT?.trim() || defaults.light,
      standard: env.AI_MODEL_STANDARD?.trim() || defaults.standard,
      research: env.AI_MODEL_RESEARCH?.trim() || defaults.research,
    },
    ...ledgerSettingsFromEnv(env),
    maxSearchesPerCall: isUnlimited(env.AI_MAX_SEARCHES_PER_CALL)
      ? null
      : intEnv(env, 'AI_MAX_SEARCHES_PER_CALL', DEFAULT_MAX_SEARCHES_PER_CALL),
    maxRetries: intEnv(env, 'AI_MAX_RETRIES', 3),
    timeoutMs: intEnv(env, 'AI_TIMEOUT_MS', 180_000),
  };
}

/**
 * Ambiente do cliente da pesquisa de direitos por temporada (`wtw-rights`): `AI_RIGHTS_PROVIDER`
 * escolhe um provedor só para ela (ex.: `gemini`, com `GEMINI_API_KEY`) e `AI_RIGHTS_MODEL` o modelo.
 * Sem `AI_RIGHTS_PROVIDER`, vale o `AI_PROVIDER` dos demais agentes. Trocando de provedor, os
 * `AI_MODEL_*` (nomes de modelo do outro provedor) não se aplicam.
 */
export function rightsLlmEnv(env: Env = process.env): Env {
  return agentLlmEnv(env, env.AI_RIGHTS_PROVIDER, env.AI_RIGHTS_MODEL, 'AI_MODEL_RESEARCH');
}

/**
 * Ambiente do cliente da revisão de sugestões (`review-suggestions`): o Gemini por padrão
 * (`AI_REVIEW_PROVIDER`, com `GEMINI_API_KEY`), modelo `AI_REVIEW_MODEL` (nível standard). Com
 * `AI_REVIEW_PROVIDER` igual ao `AI_PROVIDER`, valem os `AI_MODEL_*` dos demais agentes.
 */
export function reviewLlmEnv(env: Env = process.env): Env {
  return agentLlmEnv(env, env.AI_REVIEW_PROVIDER || 'gemini', env.AI_REVIEW_MODEL, 'AI_MODEL_STANDARD');
}

/**
 * Ambiente do casamento da lista de canais do cliente (`channel-lists`): o Gemini por padrão
 * (`AI_CHANNELS_PROVIDER`, com `GEMINI_API_KEY`), modelo `AI_CHANNELS_MODEL` (nível standard). A IA
 * só vê as sobras do casamento por código e só devolve índices e enums.
 */
export function channelsLlmEnv(env: Env = process.env): Env {
  return agentLlmEnv(env, env.AI_CHANNELS_PROVIDER || 'gemini', env.AI_CHANNELS_MODEL, 'AI_MODEL_STANDARD');
}

/**
 * Ambiente do canal do jogo (`wtw-channel`): o Gemini por padrão (`AI_MATCH_CHANNEL_PROVIDER`, com
 * `GEMINI_API_KEY`) — o pedido em dois passos garante que toda URL de evidência veio da busca —,
 * modelo `AI_MATCH_CHANNEL_MODEL` (nível research).
 */
export function matchChannelLlmEnv(env: Env = process.env): Env {
  return agentLlmEnv(
    env,
    env.AI_MATCH_CHANNEL_PROVIDER || 'gemini',
    env.AI_MATCH_CHANNEL_MODEL,
    'AI_MODEL_RESEARCH',
  );
}

function agentLlmEnv(
  env: Env,
  providerValue: string | undefined,
  modelValue: string | undefined,
  modelKey: 'AI_MODEL_RESEARCH' | 'AI_MODEL_STANDARD',
): Env {
  const provider = providerValue?.trim().toLowerCase();
  const model = modelValue?.trim();
  const current = env.AI_PROVIDER?.trim().toLowerCase() || 'openai';
  if (!provider || provider === current) return model ? { ...env, [modelKey]: model } : env;
  return {
    ...env,
    AI_PROVIDER: provider,
    AI_MODEL_LIGHT: undefined,
    AI_MODEL_STANDARD: undefined,
    AI_MODEL_RESEARCH: undefined,
    [modelKey]: model || undefined,
  };
}

/**
 * Modelos que os agentes usam com este ambiente: os três níveis do AI_PROVIDER e os modelos das funções com provedor
 * próprio (revisão, canais, canal do jogo, direitos). Para os avisos da tabela de preços (#1438).
 */
export function modelsInUseFromEnv(env: Env = process.env): string[] {
  const models = new Set<string>();
  for (const e of [env, reviewLlmEnv(env), channelsLlmEnv(env), matchChannelLlmEnv(env), rightsLlmEnv(env)]) {
    try {
      const m = llmSettingsFromEnv(e).models;
      models.add(m.light).add(m.standard).add(m.research);
    } catch {
      // provedor inválido: o próprio job falha com a mensagem de configuração
    }
  }
  return [...models];
}
