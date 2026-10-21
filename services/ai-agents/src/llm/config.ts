import { LlmError } from './errors.js';
import type { LlmTier } from './types.js';

export type LlmProviderName = 'openai' | 'anthropic';
export const LLM_PROVIDERS: readonly LlmProviderName[] = ['openai', 'anthropic'];

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
 */
export const DEFAULT_MODELS: Record<LlmProviderName, Record<LlmTier, string>> = {
  openai: { light: 'gpt-6-luna', standard: 'gpt-6.1-sol', research: 'gpt-6.1-sol' },
  anthropic: { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', research: 'claude-sonnet-5-5' },
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
      `AI_PROVIDER inválido: ${env.AI_PROVIDER} (use openai ou anthropic).`,
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
    apiKey: (provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY)?.trim() || undefined,
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
