/**
 * Orçamento diário de IA compartilhado por TODOS os agentes, em duas medidas:
 * - tokens (AI_DAILY_TOKEN_BUDGET), o teto original;
 * - US$ (AI_DAILY_USD_BUDGET global e AI_AGENT_USD_BUDGETS por agente), somando o custo dos tokens e o
 *   das buscas na web (`cost_usd` de cada linha; o grounding do Gemini é cobrado por consulta).
 * Cada chamada ao LLM vira uma linha em `ops.llm_usage` (fonte da verdade); antes de chamar,
 * `TokenBudget.reserve` soma o consumo do dia UTC e recusa se a estimativa (de uma tentativa) não
 * couber; antes de cada retentativa ou continuação, o provedor confere de novo com o gasto parcial da
 * chamada (`LlmJsonRequest.budgetCheck`). Agente que bate o próprio teto em US$ fica sem IA até a
 * virada do dia UTC (segue com o determinístico); AI_DAILY_USD_BUDGET=0 desliga a IA de todos.
 *
 * Uso por outros agentes: envolva o cliente com `new BudgetedLlmClient(client, budget)` e use
 * `purpose` no formato `<agente>:<detalhe>` (ex.: `live:priorities:2026-10-21`) — o prefixo é a
 * chave do limite por agente (opcional) e das métricas.
 *
 * O limite é "macio" entre processos (a checagem lê o ledger; duas execuções simultâneas podem
 * ultrapassar por no máximo uma chamada cada) — suficiente para conter custo descontrolado.
 */
import { and, eq, sql } from 'drizzle-orm';
import { llmUsage, type Database } from '@galaxie/db';
import { BudgetExceededError, LlmError } from './errors.js';
import { budgetPriceFor, searchUsdFor } from './pricing.js';
import type { LlmClient, LlmJsonRequest, LlmResult, LlmTier, LlmUsage } from './types.js';

/** `LlmUsage` com o número de buscas na web (campo extra preenchido pelos provedores). */
export type UsageWithSearches = LlmUsage & { webSearchCalls?: number };

export interface UsageRecord {
  agent: string;
  purpose: string;
  provider: string;
  model: string;
  tier: LlmTier;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  costUsd?: number | undefined;
  outcome: 'ok' | 'error';
  error?: string | undefined;
  at: Date;
}

export interface TokenBudgetStore {
  /** Tokens (entrada + saída) usados no dia UTC — de um agente ou de todos. */
  usedTokens(dayUtc: string, agent?: string): Promise<number>;
  /** US$ gastos no dia UTC (tokens + buscas, `cost_usd`) — de um agente ou de todos. */
  usedUsd(dayUtc: string, agent?: string): Promise<number>;
  record(entry: UsageRecord): Promise<void>;
}

export const dayUtcOf = (d: Date) => d.toISOString().slice(0, 10);

/** Agente = prefixo de `purpose` (antes do primeiro ":"). */
export function agentOf(purpose: string): string {
  return purpose.split(':')[0]?.trim() || 'unknown';
}

export class PgTokenBudgetStore implements TokenBudgetStore {
  constructor(private readonly db: Database) {}

  async usedTokens(dayUtc: string, agent?: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens})` })
      .from(llmUsage)
      .where(
        agent ? and(eq(llmUsage.dayUtc, dayUtc), eq(llmUsage.agent, agent)) : eq(llmUsage.dayUtc, dayUtc),
      );
    return Number(row?.total ?? 0);
  }

  async usedUsd(dayUtc: string, agent?: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${llmUsage.costUsd})` })
      .from(llmUsage)
      .where(
        agent ? and(eq(llmUsage.dayUtc, dayUtc), eq(llmUsage.agent, agent)) : eq(llmUsage.dayUtc, dayUtc),
      );
    return Number(row?.total ?? 0);
  }

  async record(e: UsageRecord): Promise<void> {
    await this.db.insert(llmUsage).values({
      dayUtc: dayUtcOf(e.at),
      agent: e.agent,
      purpose: e.purpose.slice(0, 200),
      provider: e.provider,
      model: e.model,
      tier: e.tier,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      webSearches: e.webSearches,
      costUsd: e.costUsd === undefined ? null : e.costUsd.toFixed(6),
      outcome: e.outcome,
      error: e.error?.slice(0, 500) ?? null,
      createdAt: e.at,
    });
  }
}

/** Ledger em memória (testes e execuções sem banco). */
export class MemoryTokenBudgetStore implements TokenBudgetStore {
  readonly entries: UsageRecord[] = [];

  async usedTokens(dayUtc: string, agent?: string): Promise<number> {
    return this.entries
      .filter((e) => dayUtcOf(e.at) === dayUtc && (!agent || e.agent === agent))
      .reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);
  }

  async usedUsd(dayUtc: string, agent?: string): Promise<number> {
    return this.entries
      .filter((e) => dayUtcOf(e.at) === dayUtc && (!agent || e.agent === agent))
      .reduce((s, e) => s + (e.costUsd ?? 0), 0);
  }

  async record(entry: UsageRecord): Promise<void> {
    this.entries.push(entry);
  }
}

export interface BudgetPolicy {
  /** Limite global do dia (todos os agentes); null = sem limite. */
  dailyLimit: number | null;
  /** Limites opcionais por agente (ex.: { wtw: 1_200_000 }). */
  agentLimits?: Record<string, number>;
  /** Teto global em US$ do dia (tokens + buscas); null/ausente = sem teto. */
  dailyUsdLimit?: number | null;
  /** Tetos em US$ por agente (ex.: { lineups: 2 }); 0 = agente sem IA. */
  agentUsdLimits?: Record<string, number>;
  /** Buscas na web por chamada; null/ausente = sem teto. */
  maxSearchesPerCall?: number | null;
}

export interface BudgetStatus {
  dayUtc: string;
  used: number;
  limit: number | null;
  remaining: number | null;
}

/** Teto que valeu na reserva, com o uso do dia lido do ledger naquele momento. */
export interface ReservedLimit {
  who: string;
  unit: 'tokens' | 'usd';
  used: number;
  limit: number;
}

export interface UsdBudgetStatus {
  dayUtc: string;
  usedUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
  /** Gasto bateu o teto: o agente (ou todos) fica sem IA até a virada do dia UTC. */
  exhausted: boolean;
}

export class TokenBudget {
  constructor(
    readonly store: TokenBudgetStore,
    readonly policy: BudgetPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async status(agent?: string): Promise<BudgetStatus> {
    const dayUtc = dayUtcOf(this.now());
    const limit = agent
      ? (this.policy.agentLimits?.[agent] ?? this.policy.dailyLimit)
      : this.policy.dailyLimit;
    const used = await this.store.usedTokens(
      dayUtc,
      agent && this.policy.agentLimits?.[agent] ? agent : undefined,
    );
    return { dayUtc, used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
  }

  /** Gasto em US$ do dia: global (sem agente) ou do agente, contra o teto que vale para ele. */
  async usdStatus(agent?: string): Promise<UsdBudgetStatus> {
    const dayUtc = dayUtcOf(this.now());
    const limitUsd = agent
      ? (this.policy.agentUsdLimits?.[agent] ?? null)
      : (this.policy.dailyUsdLimit ?? null);
    const usedUsd = await this.store.usedUsd(dayUtc, agent);
    return {
      dayUtc,
      usedUsd,
      limitUsd,
      remainingUsd: limitUsd === null ? null : Math.max(0, limitUsd - usedUsd),
      exhausted: limitUsd !== null && usedUsd >= limitUsd,
    };
  }

  /**
   * Lança BudgetExceededError se `estimate` (tokens) não couber no global nem no limite do agente, ou se
   * `estimateUsd` não couber no teto em US$ global ou do agente. Devolve os tetos conferidos (para
   * `checkPartial` conferir de novo a cada retentativa sem reler o ledger).
   */
  async reserve(agent: string, estimate: number, estimateUsd = 0): Promise<ReservedLimit[]> {
    const dayUtc = dayUtcOf(this.now());
    const limits: ReservedLimit[] = [];
    if (this.policy.dailyLimit !== null) {
      const used = await this.store.usedTokens(dayUtc);
      limits.push({ who: 'global', unit: 'tokens', used, limit: this.policy.dailyLimit });
    }
    const agentLimit = this.policy.agentLimits?.[agent];
    if (agentLimit !== undefined) {
      const used = await this.store.usedTokens(dayUtc, agent);
      limits.push({ who: agent, unit: 'tokens', used, limit: agentLimit });
    }
    const usdLimit = this.policy.dailyUsdLimit ?? null;
    if (usdLimit !== null) {
      const used = await this.store.usedUsd(dayUtc);
      limits.push({ who: 'global', unit: 'usd', used, limit: usdLimit });
    }
    const agentUsd = this.policy.agentUsdLimits?.[agent];
    if (agentUsd !== undefined) {
      const used = await this.store.usedUsd(dayUtc, agent);
      limits.push({ who: agent, unit: 'usd', used, limit: agentUsd });
    }
    this.checkPartial(limits, { tokens: 0, usd: 0 }, estimate, estimateUsd);
    return limits;
  }

  /**
   * Confere os tetos da reserva somando o gasto parcial desta chamada (`spent`: retentativas e
   * continuações já cobradas) e mais uma rodada estimada; lança BudgetExceededError se não couber.
   */
  checkPartial(
    limits: readonly ReservedLimit[],
    spent: { tokens: number; usd: number },
    estimate: number,
    estimateUsd: number,
  ): void {
    for (const l of limits) {
      if (l.unit === 'tokens') {
        const used = l.used + spent.tokens;
        if (used + estimate > l.limit) throw new BudgetExceededError(l.who, used, l.limit, estimate);
      } else {
        const used = l.used + spent.usd;
        if (used >= l.limit || used + estimateUsd > l.limit)
          throw this.usdExceeded(dayUtcOf(this.now()), l.who, used, l.limit, estimateUsd);
      }
    }
  }

  /** Avisos já dados neste processo (um por dia e teto: o log não repete a cada chamada recusada). */
  private readonly warned = new Set<string>();

  private usdExceeded(
    dayUtc: string,
    who: string,
    used: number,
    limit: number,
    estimate: number,
  ): BudgetExceededError {
    const err = new BudgetExceededError(who, used, limit, estimate, 'usd');
    const key = `${dayUtc}:${who}`;
    if (!this.warned.has(key)) {
      this.warned.add(key);
      console.warn(
        `[orçamento de IA] ${err.message} ${who === 'global' ? 'Todos os agentes seguem' : `O agente ${who} segue`} só com o determinístico até a virada do dia UTC.`,
      );
    }
    return err;
  }

  async record(entry: Omit<UsageRecord, 'at'> & { at?: Date }): Promise<void> {
    await this.store.record({ ...entry, at: entry.at ?? this.now() });
  }
}

/** Overhead aproximado de uma rodada com busca na web (resultados entram como tokens de entrada). */
export const WEB_SEARCH_TOKEN_ESTIMATE = 20_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;

/** Estimativa conservadora de tokens de uma requisição (~4 caracteres por token). */
export function estimateRequestTokens(req: LlmJsonRequest): number {
  const chars =
    req.system.length +
    req.messages.reduce((s, m) => s + m.content.length, 0) +
    JSON.stringify(req.schema).length;
  return (
    Math.ceil(chars / 4) +
    (req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) +
    (req.webSearch ? WEB_SEARCH_TOKEN_ESTIMATE : 0)
  );
}

/** Buscas presumidas numa chamada com busca quando não há teto configurado. */
export const UNCAPPED_SEARCH_ESTIMATE = 10;

/**
 * Estimativa conservadora em US$ de uma requisição: tokens de entrada (com o overhead da busca) e a saída
 * máxima ao preço do modelo, mais o teto de buscas ao preço por busca do provedor. Modelo fora da tabela
 * de preços usa o preço mais caro do provedor (sem provedor conhecido, conta só as buscas).
 */
export function estimateRequestUsd(req: LlmJsonRequest, model: string, provider: string): number {
  const p = budgetPriceFor(model, provider);
  const outputTokens = req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const inputTokens = Math.max(0, estimateRequestTokens(req) - outputTokens);
  const tokensUsd = p ? (inputTokens * p.input + outputTokens * p.output) / 1_000_000 : 0;
  const searches = req.webSearch ? (req.maxSearches ?? UNCAPPED_SEARCH_ESTIMATE) : 0;
  return tokensUsd + searches * searchUsdFor(provider);
}

/** A chamada fez mais buscas que o teto (o Gemini não aplica o teto na API: o alerta é a defesa). */
export function overSearchCap(searches: number, cap: number | null | undefined): boolean {
  return cap !== null && cap !== undefined && searches > cap;
}

/** Decorador de LlmClient que aplica o orçamento e registra o uso de cada chamada. */
export class BudgetedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly budget: TokenBudget,
    private readonly modelOf: (tier: LlmTier) => string = (t) => t,
    private readonly providerName = 'unknown',
  ) {}

  async generateJson<T>(original: LlmJsonRequest): Promise<LlmResult<T>> {
    const agent = agentOf(original.purpose);
    const cap = this.budget.policy.maxSearchesPerCall ?? null;
    // o teto de buscas vai para o provedor (OpenAI e Anthropic aplicam; o Gemini recebe no prompt)
    const req: LlmJsonRequest =
      original.webSearch && original.maxSearches === undefined && cap !== null
        ? { ...original, maxSearches: cap }
        : original;
    const estimate = estimateRequestTokens(req);
    const estimateUsd = estimateRequestUsd(req, req.model ?? this.modelOf(req.tier), this.providerName);
    const limits = await this.budget.reserve(agent, estimate, estimateUsd);
    // a reserva cobre uma tentativa: o provedor confere de novo antes de cada retentativa/continuação
    const call: LlmJsonRequest = {
      ...req,
      budgetCheck: (spent) => this.budget.checkPartial(limits, spent, estimate, estimateUsd),
    };
    let result: LlmResult<T>;
    try {
      result = await this.inner.generateJson<T>(call);
    } catch (err) {
      const partial = (err as { usage?: UsageWithSearches }).usage;
      await this.budget.record({
        agent,
        purpose: req.purpose,
        provider: this.providerName,
        model: req.model ?? this.modelOf(req.tier),
        tier: req.tier,
        inputTokens: partial?.inputTokens ?? 0,
        outputTokens: partial?.outputTokens ?? 0,
        webSearches: partial?.webSearchCalls ?? 0,
        costUsd: partial?.costUsd,
        outcome: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err instanceof LlmError ? err : new LlmError(String(err), 'provider', false, { cause: err });
    }
    const usage = result.usage as UsageWithSearches;
    const searches = usage.webSearchCalls ?? 0;
    const searchCap = req.maxSearches ?? cap;
    // fica no ledger (web_searches): o painel conta as chamadas acima do teto
    if (overSearchCap(searches, searchCap))
      console.warn(
        `[orçamento de IA] ${req.purpose}: ${searches} buscas na web, acima do teto de ${searchCap} por chamada (${result.provider}/${result.model}).`,
      );
    // a chamada já foi paga: falha ao gravar o ledger não descarta o resultado (nem faz o agente pagar de novo)
    try {
      await this.budget.record({
        agent,
        purpose: req.purpose,
        provider: result.provider,
        model: result.model,
        tier: req.tier,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        webSearches: searches,
        costUsd: usage.costUsd,
        outcome: 'ok',
      });
    } catch (recordErr) {
      console.error(
        `[orçamento de IA] ${req.purpose}: falha ao gravar o uso no ledger (US$ ${usage.costUsd ?? '?'} fora do teto do dia): ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
      );
    }
    return result;
  }
}
