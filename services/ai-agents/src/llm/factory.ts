import { defaultAiPolicyFile, isManualRun, loadAiPolicyOrEmpty, type BandPolicy } from '@galaxie/ai-ledger';
import type { Database } from '@galaxie/db';
import type { BudgetDay } from '@galaxie/runtime-config';
import {
  BudgetedLlmClient,
  MemoryTokenBudgetStore,
  PgTokenBudgetStore,
  TokenBudget,
  ledgerPolicy,
  type BudgetPolicy,
} from './budget.js';
import { llmSettingsFromEnv, type AiStatus, type LlmSettings } from './config.js';
import { priorityResolver } from './priority.js';
import { AnthropicLlmClient } from './providers/anthropic.js';
import { GeminiLlmClient } from './providers/gemini.js';
import { OpenAiLlmClient } from './providers/openai.js';
import type { LlmClient } from './types.js';

export interface CreateLlmClientOptions {
  env?: Record<string, string | undefined>;
  /** Com banco, o orçamento usa ops.llm_usage; sem, um ledger em memória. */
  db?: Database;
  /** Limites por agente em tokens (somados ao global AI_DAILY_TOKEN_BUDGET). */
  agentLimits?: BudgetPolicy['agentLimits'];
  now?: () => Date;
  /**
   * Faixas por prioridade (#357): padrão ligadas, com config/ai-policy.yaml (AI_POLICY_FILE), a audiência
   * de config/geo e a faixa `manual` fora do scheduler. `false` desliga (só os tetos global e por agente).
   */
  bands?: boolean | Omit<BandPolicy, 'shares'>;
}

/**
 * Faixas da política de execução lidas do ambiente: a política versionada, quem chama (scheduler ou
 * manual: GALAXIE_INVOKER) e a prioridade por competição com o corte AI_P0_MIN_AUDIENCE.
 */
export function bandsFromEnv(
  env: Record<string, string | undefined>,
  settings: Pick<LlmSettings, 'p0MinAudience'>,
): Omit<BandPolicy, 'shares'> {
  // política ausente ou inválida: sai no log e vale a vazia (os jobs gravam o determinístico, não saem com erro)
  const policy = loadAiPolicyOrEmpty(defaultAiPolicyFile(env));
  return {
    policy,
    manual: isManualRun(env),
    priorityOf: priorityResolver({ minAudience: settings.p0MinAudience, policy, env }),
  };
}

/**
 * Política do orçamento lida do ambiente: estado (global e por agente), tokens, US$ (global, por
 * agente e o padrão do agente fora da lista) e buscas por chamada.
 */
export function budgetPolicyFromSettings(
  settings: Pick<
    LlmSettings,
    'dailyTokenBudget' | 'dailyUsdBudget' | 'agentUsdBudgets' | 'maxSearchesPerCall'
  > &
    Partial<
      Pick<
        LlmSettings,
        'status' | 'agentStatus' | 'agentDefaultUsdBudget' | 'agentUsdOrigins' | 'bandShares' | 'budgetDay'
      >
    >,
  agentLimits?: BudgetPolicy['agentLimits'],
  bands?: Omit<BandPolicy, 'shares'>,
): BudgetPolicy {
  return {
    ...ledgerPolicy(settings, bands),
    ...(agentLimits ? { agentLimits } : {}),
    maxSearchesPerCall: settings.maxSearchesPerCall,
  };
}

export interface LlmRuntime {
  client: LlmClient;
  settings: LlmSettings;
  budget: TokenBudget;
}

/** Cria o cliente do provedor escolhido por AI_PROVIDER (openai, anthropic ou gemini), já com orçamento diário e registro de uso. */
export function createLlmClient(options: CreateLlmClientOptions = {}): LlmRuntime {
  const env = options.env ?? process.env;
  const settings = llmSettingsFromEnv(env);
  const bands =
    options.bands === false
      ? undefined
      : options.bands === undefined || options.bands === true
        ? bandsFromEnv(env, settings)
        : options.bands;
  const common = {
    models: settings.models,
    maxRetries: settings.maxRetries,
    timeoutMs: settings.timeoutMs,
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
  };
  const raw: LlmClient =
    settings.provider === 'anthropic'
      ? new AnthropicLlmClient(common)
      : settings.provider === 'gemini'
        ? new GeminiLlmClient(common)
        : new OpenAiLlmClient(common);
  const budget = new TokenBudget(
    options.db ? new PgTokenBudgetStore(options.db) : new MemoryTokenBudgetStore(),
    budgetPolicyFromSettings(settings, options.agentLimits, bands),
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
  /** Teto global em US$ (padrão: AI_DAILY_USD_BUDGET do ambiente; null = sem teto). */
  dailyUsdLimit?: number | null;
  /** Tetos em US$ por agente (padrão: AI_AGENT_USD_BUDGETS do ambiente); null = sem teto próprio. */
  agentUsdLimits?: Record<string, number | null>;
  /** Teto em US$ do agente fora da lista (padrão: AI_AGENT_DEFAULT_USD_BUDGET do ambiente; null = sem teto). */
  agentDefaultUsdLimit?: number | null;
  /** Estado global (padrão: AI_STATUS do ambiente). */
  status?: AiStatus;
  /** Estado por agente (padrão: AI_AGENT_STATUS do ambiente). */
  agentStatus?: Record<string, AiStatus>;
  /** Buscas por chamada (padrão: AI_MAX_SEARCHES_PER_CALL do ambiente; null = sem teto). */
  maxSearchesPerCall?: number | null;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Usado no registro de falhas (o sucesso registra o provedor/modelo da resposta). */
  provider?: string;
  /** Faixas por prioridade (#357; as % de AI_BAND_SHARES do ambiente); ausente = sem faixas. */
  bands?: Omit<BandPolicy, 'shares'>;
  /** Virada do dia de orçamento; ausente = 00:00 UTC. */
  budgetDay?: BudgetDay;
}

/**
 * Envolve QUALQUER LlmClient (inclusive o FakeLlmClient dos testes) com o orçamento diário (tokens e US$,
 * global e por agente) e o registro de uso por agente (prefixo de `purpose`).
 */
export function withTokenBudget(client: LlmClient, options: WithTokenBudgetOptions = {}): BudgetedLlmClient {
  const fromEnv = llmSettingsFromEnv(options.env ?? process.env);
  const budget = new TokenBudget(
    options.db ? new PgTokenBudgetStore(options.db) : new MemoryTokenBudgetStore(),
    budgetPolicyFromSettings(
      {
        status: options.status ?? fromEnv.status,
        agentStatus: options.agentStatus ?? fromEnv.agentStatus,
        dailyTokenBudget: options.dailyLimit !== undefined ? options.dailyLimit : fromEnv.dailyTokenBudget,
        dailyUsdBudget: options.dailyUsdLimit !== undefined ? options.dailyUsdLimit : fromEnv.dailyUsdBudget,
        agentUsdBudgets: options.agentUsdLimits ?? fromEnv.agentUsdBudgets,
        ...(options.agentUsdLimits ? {} : { agentUsdOrigins: fromEnv.agentUsdOrigins }),
        agentDefaultUsdBudget:
          options.agentDefaultUsdLimit !== undefined
            ? options.agentDefaultUsdLimit
            : fromEnv.agentDefaultUsdBudget,
        maxSearchesPerCall:
          options.maxSearchesPerCall !== undefined ? options.maxSearchesPerCall : fromEnv.maxSearchesPerCall,
        bandShares: fromEnv.bandShares,
        ...(options.budgetDay ? { budgetDay: options.budgetDay } : {}),
      },
      options.agentLimits,
      options.bands,
    ),
    options.now,
  );
  return new BudgetedLlmClient(client, budget, (t) => t, options.provider ?? 'unknown');
}
