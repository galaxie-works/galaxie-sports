import { LlmError } from './errors.js';
import type { LlmTier } from './types.js';

export type LlmProviderName = 'openai' | 'anthropic' | 'gemini';
export const LLM_PROVIDERS: readonly LlmProviderName[] = ['openai', 'anthropic', 'gemini'];

/**
 * Modelos padrão por nível (conferidos nas páginas oficiais de modelos/preços em 2026-10-21).
 * Sobrescreva com AI_MODEL_LIGHT / AI_MODEL_STANDARD / AI_MODEL_RESEARCH.
 *
 * OpenAI (padrão):
 * - light → `gpt-6-luna`: o modelo mais eficiente para tarefas focadas e de alto volume (US$ 0,10/0,50 por MTok).
 * - standard → `gpt-6.1-sol`: equilíbrio capacidade × custo, perto do topo de linha (US$ 2/10).
 * - research → `gpt-6.1-sol`: suporta web_search com filtro de domínios e saída estruturada; o topo
 *   de linha (`gpt-6-astra`, US$ 10/50) custa 5× mais sem ganho claro para "achar e citar a grade".
 * Anthropic:
 * - light → `claude-haiku-5-5` (US$ 0,10/0,50) · standard/research → `claude-sonnet-5-5` (US$ 2/10),
 *   o modelo indicado em docs/07 §5 para o onde assistir.
 * Gemini (API Interactions; saída estruturada + Grounding with Google Search só no Gemini 3+):
 * - light → `gemini-3.5-flash-lite` (US$ 0,30/2,50) · standard/research → `gemini-3.8-flash`
 *   (US$ 0,75/3,75 até 31/12/2026), + US$ 14 por 1.000 consultas de busca.
 */
export const DEFAULT_MODELS: Record<LlmProviderName, Record<LlmTier, string>> = {
  openai: { light: 'gpt-6-luna', standard: 'gpt-6.1-sol', research: 'gpt-6.1-sol' },
  anthropic: { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', research: 'claude-sonnet-5-5' },
  gemini: { light: 'gemini-3.5-flash-lite', standard: 'gemini-3.8-flash', research: 'gemini-3.8-flash' },
};

/** Variável da chave de cada provedor. */
export const API_KEY_ENV: Record<LlmProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export const DEFAULT_DAILY_TOKEN_BUDGET = 2_000_000;

export interface LlmSettings {
  provider: LlmProviderName;
  apiKey: string | undefined;
  models: Record<LlmTier, string>;
  /** Tokens (entrada + saída) por dia UTC para todos os agentes; null = sem limite. */
  dailyTokenBudget: number | null;
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

/** Lê AI_PROVIDER, chaves, modelos por nível e orçamento do ambiente. */
export function llmSettingsFromEnv(env: Env = process.env): LlmSettings {
  const provider = (env.AI_PROVIDER?.trim().toLowerCase() || 'openai') as LlmProviderName;
  if (!LLM_PROVIDERS.includes(provider))
    throw new LlmError(
      `AI_PROVIDER inválido: ${env.AI_PROVIDER} (use openai, anthropic ou gemini).`,
      'config',
      false,
    );
  const defaults = DEFAULT_MODELS[provider];
  const budgetRaw = env.AI_DAILY_TOKEN_BUDGET?.trim().toLowerCase();
  const dailyTokenBudget =
    budgetRaw === 'unlimited' || budgetRaw === '0'
      ? null
      : intEnv(env, 'AI_DAILY_TOKEN_BUDGET', DEFAULT_DAILY_TOKEN_BUDGET);
  return {
    provider,
    apiKey: env[API_KEY_ENV[provider]]?.trim() || undefined,
    models: {
      light: env.AI_MODEL_LIGHT?.trim() || defaults.light,
      standard: env.AI_MODEL_STANDARD?.trim() || defaults.standard,
      research: env.AI_MODEL_RESEARCH?.trim() || defaults.research,
    },
    dailyTokenBudget,
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
  const rights = env.AI_RIGHTS_PROVIDER?.trim().toLowerCase();
  const model = env.AI_RIGHTS_MODEL?.trim();
  const current = env.AI_PROVIDER?.trim().toLowerCase() || 'openai';
  if (!rights || rights === current) return model ? { ...env, AI_MODEL_RESEARCH: model } : env;
  return {
    ...env,
    AI_PROVIDER: rights,
    AI_MODEL_LIGHT: undefined,
    AI_MODEL_STANDARD: undefined,
    AI_MODEL_RESEARCH: model || undefined,
  };
}
