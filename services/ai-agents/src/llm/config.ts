import { LlmError } from './errors.js';
import type { LlmTier } from './types.js';

/**
 * Chave do agente sem a versão do prompt (`channels@v1` → `channels`): o teto e as métricas do agente
 * não mudam de chave quando o prompt sobe de versão.
 */
export function agentKey(name: string): string {
  return name.split('@')[0]!.trim().toLowerCase();
}

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

/**
 * Teto diário em US$ (dia UTC) somando todos os agentes: custo dos tokens + custo das buscas na web
 * (`ops.llm_usage.cost_usd`). A busca do Gemini é cobrada por consulta e pesa mais que os tokens
 * (2026-10-24: 1.101 buscas, US$ 20,88 no dia, sem disparar o teto de tokens). Média da semana
 * anterior: ~US$ 5/dia; 10 dá folga para o dia normal e corta o dia de pesquisa descontrolada.
 */
export const DEFAULT_DAILY_USD_BUDGET = 10;

/**
 * Teto diário em US$ por agente (prefixo de `purpose`). Agente fora da lista fica só no teto global.
 * Valores pela semana de 2026-10-18 a 24: lineups ~US$ 1,9/dia (concentrado num dia), wtw ~1,7,
 * context ~1, related e f1profile pequenos.
 */
export const DEFAULT_AGENT_USD_BUDGETS = 'lineups=2,wtw=3,context=1.5,related=0.5,f1profile=1';

/** Buscas na web por chamada (teto do provedor quando existe; senão instrução no prompt + alerta). */
export const DEFAULT_MAX_SEARCHES_PER_CALL = 5;

/** Formato de AI_AGENT_USD_BUDGETS: `agente=US$` separados por vírgula ou espaço. */
export const AGENT_USD_BUDGET_ENTRY = /^([a-z0-9][a-z0-9@._-]*)=(\d+(?:\.\d+)?)$/i;

/**
 * `lineups=2,wtw=3` → `{ lineups: 2, wtw: 3 }`. Vazio → `{}`; formato inválido → null.
 * US$ 0 num agente = agente sem IA (só o determinístico). A chave perde a versão do prompt
 * (`channels@v1=1` vale para o agente `channels`, como o ledger grava).
 */
export function parseAgentUsdBudgets(raw: string | undefined | null): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const part of (raw ?? '').split(/[,\s;]+/).filter(Boolean)) {
    const m = AGENT_USD_BUDGET_ENTRY.exec(part);
    if (!m) return null;
    out[agentKey(m[1]!)] = Number(m[2]);
  }
  return out;
}

export interface LlmSettings {
  provider: LlmProviderName;
  apiKey: string | undefined;
  models: Record<LlmTier, string>;
  /** Tokens (entrada + saída) por dia UTC para todos os agentes; null = sem limite. */
  dailyTokenBudget: number | null;
  /** US$ (tokens + buscas) por dia UTC para todos os agentes; null = sem limite; 0 = IA desligada. */
  dailyUsdBudget: number | null;
  /** US$ por dia UTC de cada agente (prefixo de `purpose`); agente ausente = só o teto global. */
  agentUsdBudgets: Record<string, number>;
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

/** Teto em US$: "unlimited" = sem teto; 0 = IA desligada (como `agente=0`), nunca "sem teto". */
function usdEnv(env: Env, name: string, fallback: number): number | null {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === 'unlimited') return null;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0)
    throw new LlmError(`${name} precisa ser um número ≥ 0 (ou "unlimited").`, 'config', false);
  return n;
}

/** AI_AGENT_USD_BUDGETS do ambiente (vazio = o padrão); formato inválido falha a configuração. */
export function agentUsdBudgetsFromEnv(env: Env = process.env): Record<string, number> {
  const raw = env.AI_AGENT_USD_BUDGETS?.trim();
  const parsed = parseAgentUsdBudgets(raw || DEFAULT_AGENT_USD_BUDGETS);
  if (!parsed)
    throw new LlmError(
      `AI_AGENT_USD_BUDGETS inválido: ${raw} (use agente=US$, ex.: lineups=2,wtw=3).`,
      'config',
      false,
    );
  return parsed;
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
    dailyUsdBudget: usdEnv(env, 'AI_DAILY_USD_BUDGET', DEFAULT_DAILY_USD_BUDGET),
    agentUsdBudgets: agentUsdBudgetsFromEnv(env),
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
