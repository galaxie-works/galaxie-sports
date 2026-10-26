/**
 * Estado e tetos da IA, literais: AI_STATUS / AI_AGENT_STATUS (`on`/`off`) e os tetos do dia em tokens e
 * US$ (`unlimited` tira o teto; 0 é inválido). Lidos pelas regras do registro do painel
 * (@galaxie/runtime-config): o serviço aceita exatamente o que o painel aceita.
 */
import {
  DEFAULT_BUDGET_DAY,
  parseBandShares,
  validateSettingKey,
  type AiBand,
  type BudgetDay,
  type ValidationError,
} from '@galaxie/runtime-config';
import { LlmError } from './errors.js';

/**
 * Chave do agente sem a versão do prompt (`channels@v1` → `channels`): o teto e as métricas do agente
 * não mudam de chave quando o prompt sobe de versão.
 */
export function agentKey(name: string): string {
  return name.split('@')[0]!.trim().toLowerCase();
}

/** Estado da IA (AI_STATUS global, AI_AGENT_STATUS por agente): ligada ou desligada. */
export type AiStatus = 'on' | 'off';

export const DEFAULT_DAILY_TOKEN_BUDGET = 2_000_000;

/**
 * Teto diário em US$ (dia UTC) somando todos os agentes: custo dos tokens + custo das buscas na web
 * (`ops.llm_usage.cost_usd`). A busca do Gemini é cobrada por consulta e pesa mais que os tokens
 * (2026-10-24: 1.101 buscas, US$ 20,88 no dia, sem disparar o teto de tokens). Média da semana
 * anterior: ~US$ 5/dia; 10 dá folga para o dia normal e corta o dia de pesquisa descontrolada.
 */
export const DEFAULT_DAILY_USD_BUDGET = 10;

/**
 * Teto diário em US$ por agente (prefixo de `purpose`), pelo uso esperado de cada um:
 * - lineups=2, wtw=3, context=1.5, related=0.5, f1profile=2: os da produção (painel, 2026-10-26);
 * - f1bio=1: lote manual de biografias da F1, rodado à mão; US$ 1 cobre o lote do dia e corta o que fugir;
 * - curator=1: lote manual da curadoria, rodado à mão; mesmo raciocínio do f1bio;
 * - review=0.5: revisão das sugestões, poucas por dia no modelo standard;
 * - channels=1: casamento da lista de canais do cliente, só as sobras do casamento por código, quando chega lista;
 * - live=0.5: prioridades do ao vivo, uma chamada curta por rodada;
 * - assets=1: ordem das fotos da F1 (ingestor), lote manual que continua de onde parou; em 25/10 o lote gastou
 *   ~US$ 4 num dia (fora do ledger), e US$ 1/dia o termina em ~4 dias sem tirar dos outros agentes.
 * A lista configurada (AI_AGENT_USD_BUDGETS, painel ou env) mescla agente a agente sobre esta (ver
 * `mergeAgentUsdBudgets`). Agente fora das duas fica no teto padrão (AI_AGENT_DEFAULT_USD_BUDGET), nunca sem teto.
 */
export const DEFAULT_AGENT_USD_BUDGETS =
  'lineups=2,wtw=3,context=1.5,related=0.5,f1profile=2,f1bio=1,curator=1,review=0.5,channels=1,live=0.5,assets=1';

/**
 * Teto diário em US$ de um agente fora de AI_AGENT_USD_BUDGETS (agente novo, `purpose` sem prefixo):
 * conservador, para o agente novo ter IA sem poder gastar o dia de todos antes de alguém dar a ele um
 * teto próprio. O log avisa uma vez por dia que o agente está no padrão.
 */
export const DEFAULT_AGENT_DEFAULT_USD_BUDGET = 0.5;

/** Formato de AI_AGENT_USD_BUDGETS: `agente=US$` ou `agente=unlimited`, separados por vírgula ou espaço. */
export const AGENT_USD_BUDGET_ENTRY = /^([a-z0-9][a-z0-9@._-]*)=(\d+(?:\.\d+)?|unlimited)$/i;
/** Formato de AI_AGENT_STATUS: `agente=on` ou `agente=off`. */
export const AGENT_STATUS_ENTRY = /^([a-z0-9][a-z0-9@._-]*)=(on|off)$/i;

const entries = (raw: string | undefined | null) => (raw ?? '').split(/[,\s;]+/).filter(Boolean);

/**
 * `lineups=2,wtw=unlimited` → `{ lineups: 2, wtw: null }` (null = sem teto próprio, só o global).
 * Vazio → `{}`; formato inválido ou US$ 0 → null (para desligar um agente: AI_AGENT_STATUS). A chave
 * perde a versão do prompt (`channels@v1=1` vale para o agente `channels`, como o ledger grava).
 */
export function parseAgentUsdBudgets(raw: string | undefined | null): Record<string, number | null> | null {
  const out: Record<string, number | null> = {};
  for (const part of entries(raw)) {
    const m = AGENT_USD_BUDGET_ENTRY.exec(part);
    if (!m) return null;
    const value = m[2]!.toLowerCase() === 'unlimited' ? null : Number(m[2]);
    if (value === 0) return null;
    out[agentKey(m[1]!)] = value;
  }
  return out;
}

/** `lineups=on,wtw=off` → `{ lineups: 'on', wtw: 'off' }`. Vazio → `{}`; formato inválido → null. */
export function parseAgentStatus(raw: string | undefined | null): Record<string, AiStatus> | null {
  const out: Record<string, AiStatus> = {};
  for (const part of entries(raw)) {
    const m = AGENT_STATUS_ENTRY.exec(part);
    if (!m) return null;
    out[agentKey(m[1]!)] = m[2]!.toLowerCase() as AiStatus;
  }
  return out;
}

/** Mensagem do 0 recusado: zero não liga nem desliga nada. */
export const ZERO_BUDGET_HINT =
  'use AI_STATUS=off (ou AI_AGENT_STATUS=agente=off) para desligar a IA, ou "unlimited" para tirar o teto';

const formatPt = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);

/**
 * Estado literal, para logs, CLI e painel: "desligado", "ligado · sem limite" ou
 * "ligado · limitado · US$ 10/dia · 2.000.000 tokens/dia" (só os tetos que existem).
 */
export function describeAiState(state: {
  status: AiStatus;
  usdPerDay?: number | null;
  tokensPerDay?: number | null;
}): string {
  if (state.status === 'off') return 'desligado';
  const limits = [
    state.usdPerDay != null ? `US$ ${formatPt(state.usdPerDay)}/dia` : '',
    state.tokensPerDay != null ? `${formatPt(state.tokensPerDay)} tokens/dia` : '',
  ].filter(Boolean);
  return limits.length ? `ligado · limitado · ${limits.join(' · ')}` : 'ligado · sem limite';
}

/** US$ em pt-BR para os avisos (`0,5` → `0,50`). */
export const formatUsdPt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);

type Env = Record<string, string | undefined>;

/** Dica de cada recusa do registro, na mensagem de configuração inválida. */
function validationHint(name: string, error: ValidationError): string {
  switch (error.code) {
    case 'zero':
      return ZERO_BUDGET_HINT;
    case 'range':
      return `use um valor entre ${error.min} e ${error.max}, ou "unlimited"`;
    case 'integer':
      return 'use um número inteiro, ou "unlimited"';
    case 'number':
      return 'use um número, ou "unlimited"';
    case 'enum':
      return `use ${(error.values ?? []).join(' ou ')}`;
    default:
      return name === 'AI_AGENT_STATUS'
        ? 'use agente=on ou agente=off, ex.: lineups=on,wtw=off'
        : 'use agente=US$ ou agente=unlimited, ex.: lineups=2,wtw=3';
  }
}

/**
 * Valor de uma flag de estado/teto da IA pelas regras do registro do painel (@galaxie/runtime-config):
 * o serviço aceita exatamente o que o painel aceita (mesmo formato e faixa). Vazio → undefined;
 * inválido falha a configuração com a dica (0 nos tetos: "use AI_STATUS=off para desligar").
 */
export function registryEnv(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const checked = validateSettingKey(name, raw);
  if (!checked.ok)
    throw new LlmError(
      `${name}=${raw} não é válido: ${validationHint(name, checked.error)}.`,
      'config',
      false,
    );
  return checked.value || undefined;
}

/** Teto diário: "unlimited" = sem teto; número = limitado a ele (faixa do registro). 0 é inválido. */
export function limitEnv(env: Env, name: string, fallback: number): number | null {
  const value = registryEnv(env, name);
  if (value === undefined) return fallback;
  return value === 'unlimited' ? null : Number(value);
}

/** AI_STATUS do ambiente: on (padrão) ou off. */
export function aiStatusFromEnv(env: Env = process.env): AiStatus {
  return (registryEnv(env, 'AI_STATUS') as AiStatus | undefined) ?? 'on';
}

/**
 * AI_AGENT_STATUS do ambiente (vazio = todos seguem o AI_STATUS; `agente=on` também segue: não religa
 * um agente com AI_STATUS=off); formato inválido falha a configuração.
 */
export function agentStatusFromEnv(env: Env = process.env): Record<string, AiStatus> {
  return parseAgentStatus(registryEnv(env, 'AI_AGENT_STATUS')) ?? {};
}

/** Origem do teto de um agente: `config` = AI_AGENT_USD_BUDGETS (painel ou env); `code` = padrão do código. */
export type AgentCapOrigin = 'config' | 'code';

/**
 * Tetos por agente: os padrões do código (DEFAULT_AGENT_USD_BUDGETS) com a lista configurada por cima,
 * agente a agente. O agente listado vence; o que não está na lista fica com o padrão do código. Assim
 * a sobrescrita do painel (ex.: `lineups=2,wtw=3`) não apaga o teto dos agentes que ela não cita.
 */
export function mergeAgentUsdBudgets(configured: Record<string, number | null>): {
  budgets: Record<string, number | null>;
  origins: Record<string, AgentCapOrigin>;
} {
  const code = parseAgentUsdBudgets(DEFAULT_AGENT_USD_BUDGETS) ?? {};
  const origins: Record<string, AgentCapOrigin> = {};
  for (const agent of Object.keys(code)) origins[agent] = 'code';
  for (const agent of Object.keys(configured)) origins[agent] = 'config';
  return { budgets: { ...code, ...configured }, origins };
}

function agentUsdBudgetsAndOrigins(env: Env) {
  return mergeAgentUsdBudgets(parseAgentUsdBudgets(registryEnv(env, 'AI_AGENT_USD_BUDGETS')) ?? {});
}

/**
 * AI_AGENT_USD_BUDGETS do ambiente mesclado por agente sobre os padrões do código (vazio = só os padrões);
 * formato inválido ou US$ 0 falha a configuração.
 */
export function agentUsdBudgetsFromEnv(env: Env = process.env): Record<string, number | null> {
  return agentUsdBudgetsAndOrigins(env).budgets;
}

/** Estado e tetos do dia lidos do ambiente (com as sobrescritas do painel já aplicadas por quem chama). */
export interface LedgerSettings {
  /** AI_STATUS: `off` = nenhuma chamada ao LLM (todos os agentes seguem com o determinístico). */
  status: AiStatus;
  /**
   * AI_AGENT_STATUS: só desliga agentes com a IA ligada; `on` e agente fora da lista seguem o global
   * (AI_STATUS=off é a chave geral e desliga todos, inclusive os `on`).
   */
  agentStatus: Record<string, AiStatus>;
  /** Tokens (entrada + saída) por dia UTC para todos os agentes; null = sem limite ("unlimited"). */
  dailyTokenBudget: number | null;
  /** US$ (tokens + buscas) por dia UTC para todos os agentes; null = sem limite ("unlimited"). */
  dailyUsdBudget: number | null;
  /**
   * US$ por dia UTC de cada agente (prefixo de `purpose`); null = sem teto próprio (só o global);
   * agente ausente = o teto padrão (`agentDefaultUsdBudget`).
   */
  agentUsdBudgets: Record<string, number | null>;
  /** De onde veio o teto de cada agente de `agentUsdBudgets`: a lista configurada ou o padrão do código. */
  agentUsdOrigins: Record<string, AgentCapOrigin>;
  /** AI_AGENT_DEFAULT_USD_BUDGET: teto do agente fora de `agentUsdBudgets`; null = sem teto próprio. */
  agentDefaultUsdBudget: number | null;
  /** AI_BAND_SHARES: % do teto global de cada faixa (soma 100; a reserva só serve a P0). */
  bandShares: Record<AiBand, number>;
  /** AI_BUDGET_DAY_START e AI_BUDGET_TIMEZONE: virada do dia de orçamento (padrão 06:00 em Brasília). */
  budgetDay: BudgetDay;
  /** AI_P0_MIN_AUDIENCE: audiência mínima (market-audience.yaml) para a competição ser P0. */
  p0MinAudience: number;
}

/** Corte P0/P1 padrão: 25 pontos (a Série B no Brasil e a Sul-Americana entram; as europeias, 16–20, não). */
export const DEFAULT_P0_MIN_AUDIENCE = 25;

/** Lê AI_STATUS, AI_AGENT_STATUS e os tetos do dia; valor inválido falha a configuração (LlmError `config`). */
export function ledgerSettingsFromEnv(env: Env = process.env): LedgerSettings {
  return {
    status: aiStatusFromEnv(env),
    agentStatus: agentStatusFromEnv(env),
    dailyTokenBudget: limitEnv(env, 'AI_DAILY_TOKEN_BUDGET', DEFAULT_DAILY_TOKEN_BUDGET),
    dailyUsdBudget: limitEnv(env, 'AI_DAILY_USD_BUDGET', DEFAULT_DAILY_USD_BUDGET),
    ...(({ budgets, origins }) => ({ agentUsdBudgets: budgets, agentUsdOrigins: origins }))(
      agentUsdBudgetsAndOrigins(env),
    ),
    agentDefaultUsdBudget: limitEnv(env, 'AI_AGENT_DEFAULT_USD_BUDGET', DEFAULT_AGENT_DEFAULT_USD_BUDGET),
    // o registro já conferiu o formato e a soma; vazio = o padrão
    bandShares: parseBandShares(registryEnv(env, 'AI_BAND_SHARES'))!,
    budgetDay: {
      timeZone: registryEnv(env, 'AI_BUDGET_TIMEZONE') ?? DEFAULT_BUDGET_DAY.timeZone,
      start: registryEnv(env, 'AI_BUDGET_DAY_START') ?? DEFAULT_BUDGET_DAY.start,
    },
    p0MinAudience: Number(registryEnv(env, 'AI_P0_MIN_AUDIENCE') ?? DEFAULT_P0_MIN_AUDIENCE),
  };
}
