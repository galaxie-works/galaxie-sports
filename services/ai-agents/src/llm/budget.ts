/**
 * Orçamento diário de tokens (AI_DAILY_TOKEN_BUDGET) compartilhado por TODOS os agentes.
 * Cada chamada ao LLM vira uma linha em `ops.llm_usage` (fonte da verdade); antes de chamar,
 * `TokenBudget.reserve` soma o consumo do dia UTC e recusa se a estimativa não couber.
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

  async record(entry: UsageRecord): Promise<void> {
    this.entries.push(entry);
  }
}

export interface BudgetPolicy {
  /** Limite global do dia (todos os agentes); null = sem limite. */
  dailyLimit: number | null;
  /** Limites opcionais por agente (ex.: { wtw: 1_200_000 }). */
  agentLimits?: Record<string, number>;
}

export interface BudgetStatus {
  dayUtc: string;
  used: number;
  limit: number | null;
  remaining: number | null;
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

  /** Lança BudgetExceededError se `estimate` não couber no global nem no limite do agente. */
  async reserve(agent: string, estimate: number): Promise<void> {
    const dayUtc = dayUtcOf(this.now());
    if (this.policy.dailyLimit !== null) {
      const used = await this.store.usedTokens(dayUtc);
      if (used + estimate > this.policy.dailyLimit)
        throw new BudgetExceededError('global', used, this.policy.dailyLimit, estimate);
    }
    const agentLimit = this.policy.agentLimits?.[agent];
    if (agentLimit !== undefined) {
      const used = await this.store.usedTokens(dayUtc, agent);
      if (used + estimate > agentLimit) throw new BudgetExceededError(agent, used, agentLimit, estimate);
    }
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

/** Decorador de LlmClient que aplica o orçamento e registra o uso de cada chamada. */
export class BudgetedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly budget: TokenBudget,
    private readonly modelOf: (tier: LlmTier) => string = (t) => t,
    private readonly providerName = 'unknown',
  ) {}

  async generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>> {
    const agent = agentOf(req.purpose);
    await this.budget.reserve(agent, estimateRequestTokens(req));
    try {
      const result = await this.inner.generateJson<T>(req);
      const usage = result.usage as UsageWithSearches;
      await this.budget.record({
        agent,
        purpose: req.purpose,
        provider: result.provider,
        model: result.model,
        tier: req.tier,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        webSearches: usage.webSearchCalls ?? 0,
        costUsd: usage.costUsd,
        outcome: 'ok',
      });
      return result;
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
  }
}
