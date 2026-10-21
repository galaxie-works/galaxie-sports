import type { Database } from '@galaxie/db';
import {
  BudgetedLlmClient,
  MemoryTokenBudgetStore,
  PgTokenBudgetStore,
  TokenBudget,
  type BudgetPolicy,
} from './budget.js';
import { llmSettingsFromEnv, type LlmSettings } from './config.js';
import { AnthropicLlmClient } from './providers/anthropic.js';
import { OpenAiLlmClient } from './providers/openai.js';
import type { LlmClient } from './types.js';

export interface CreateLlmClientOptions {
  env?: Record<string, string | undefined>;
  /** Com banco, o orçamento usa ops.llm_usage; sem, um ledger em memória. */
  db?: Database;
  /** Limites por agente (somados ao global AI_DAILY_TOKEN_BUDGET). */
  agentLimits?: BudgetPolicy['agentLimits'];
  now?: () => Date;
}

export interface LlmRuntime {
  client: LlmClient;
  settings: LlmSettings;
  budget: TokenBudget;
}

/** Cria o cliente do provedor escolhido por AI_PROVIDER, já com orçamento diário e registro de uso. */
export function createLlmClient(options: CreateLlmClientOptions = {}): LlmRuntime {
  const settings = llmSettingsFromEnv(options.env ?? process.env);
  const common = {
    models: settings.models,
    maxRetries: settings.maxRetries,
    timeoutMs: settings.timeoutMs,
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
  };
  const raw: LlmClient =
    settings.provider === 'anthropic' ? new AnthropicLlmClient(common) : new OpenAiLlmClient(common);
  const budget = new TokenBudget(
    options.db ? new PgTokenBudgetStore(options.db) : new MemoryTokenBudgetStore(),
    {
      dailyLimit: settings.dailyTokenBudget,
      ...(options.agentLimits ? { agentLimits: options.agentLimits } : {}),
    },
    options.now,
  );
  return {
    client: new BudgetedLlmClient(raw, budget, (t) => settings.models[t], settings.provider),
    settings,
    budget,
  };
}

/**
 * Atalho usado pelos demais agentes: cliente do provedor de AI_PROVIDER (OpenAI ou Anthropic),
 * já com o orçamento diário de tokens aplicado. Passe `db` para o orçamento usar ops.llm_usage
 * (compartilhado entre processos); sem `db`, o ledger fica em memória.
 */
export function createLlmClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: Omit<CreateLlmClientOptions, 'env'> = {},
): LlmClient {
  return createLlmClient({ ...options, env }).client;
}

export interface WithTokenBudgetOptions {
  /** Com banco, o orçamento usa ops.llm_usage; sem, um ledger em memória. */
  db?: Database;
  /** Limite global do dia (padrão: AI_DAILY_TOKEN_BUDGET do ambiente; null = sem limite). */
  dailyLimit?: number | null;
  agentLimits?: BudgetPolicy['agentLimits'];
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Usado no registro de falhas (o sucesso registra o provedor/modelo da resposta). */
  provider?: string;
}

/**
 * Envolve QUALQUER LlmClient (inclusive o FakeLlmClient dos testes) com o orçamento diário de tokens
 * e o registro de uso por agente (prefixo de `purpose`).
 */
export function withTokenBudget(client: LlmClient, options: WithTokenBudgetOptions = {}): BudgetedLlmClient {
  const dailyLimit =
    options.dailyLimit !== undefined
      ? options.dailyLimit
      : llmSettingsFromEnv(options.env ?? process.env).dailyTokenBudget;
  const budget = new TokenBudget(
    options.db ? new PgTokenBudgetStore(options.db) : new MemoryTokenBudgetStore(),
    { dailyLimit, ...(options.agentLimits ? { agentLimits: options.agentLimits } : {}) },
    options.now,
  );
  return new BudgetedLlmClient(client, budget, (t) => t, options.provider ?? 'unknown');
}
