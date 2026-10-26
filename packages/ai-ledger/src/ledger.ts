/**
 * Ledger diário de IA compartilhado por TODOS os agentes e pelo ingestor (ordem das fotos), em duas medidas:
 * - tokens (AI_DAILY_TOKEN_BUDGET), o teto original;
 * - US$ (AI_DAILY_USD_BUDGET global, AI_AGENT_USD_BUDGETS por agente e AI_AGENT_DEFAULT_USD_BUDGET para o
 *   agente fora da lista), somando o custo dos tokens e o das buscas na web (`cost_usd` de cada linha).
 * Cada chamada ao LLM vira uma linha em `ops.llm_usage` (fonte da verdade); antes de chamar,
 * `TokenBudget.reserve` soma o consumo do dia UTC e recusa se a estimativa (de uma tentativa) não
 * couber; antes de cada retentativa ou continuação, quem chama confere de novo com o gasto parcial
 * (`checkPartial`). Agente que bate o próprio teto em US$ fica sem IA até a virada do dia UTC (segue com
 * o determinístico). Ligar e desligar é outra chave, literal: AI_STATUS (global) e AI_AGENT_STATUS (por
 * agente), `on`/`off`; desligado, nenhuma chamada sai.
 *
 * O limite é "macio" entre processos (a checagem lê o ledger; duas execuções simultâneas podem
 * ultrapassar por no máximo uma chamada cada) — suficiente para conter custo descontrolado.
 */
import { and, eq, sql } from 'drizzle-orm';
import { llmUsage, type Database } from '@galaxie/db';
import { AiDisabledError, BudgetExceededError } from './errors.js';
import {
  agentKey,
  describeAiState,
  formatUsdPt,
  type AgentCapOrigin,
  type AiStatus,
  type LedgerSettings,
} from './state.js';

export interface UsageRecord {
  agent: string;
  purpose: string;
  provider: string;
  model: string;
  /** Nível do modelo (`light`, `standard`, `research`). */
  tier: string;
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

/** Agente = prefixo de `purpose` (antes do primeiro ":"), sem a versão do prompt. */
export function agentOf(purpose: string): string {
  return agentKey(purpose.split(':')[0] ?? '') || 'unknown';
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
  /** AI_STATUS: `off` recusa toda chamada antes do provedor; ausente = `on`. */
  status?: AiStatus;
  /** AI_AGENT_STATUS: `off` recusa as chamadas do agente; `on` ou ausente segue o global (status off vence). */
  agentStatus?: Record<string, AiStatus>;
  /** Limite global do dia (todos os agentes); null = sem limite. */
  dailyLimit: number | null;
  /** Limites opcionais por agente (ex.: { wtw: 1_200_000 }). */
  agentLimits?: Record<string, number>;
  /** Teto global em US$ do dia (tokens + buscas); null/ausente = sem teto. */
  dailyUsdLimit?: number | null;
  /** Tetos em US$ por agente (ex.: { lineups: 2 }); null = sem teto próprio (só o global). */
  agentUsdLimits?: Record<string, number | null>;
  /**
   * Teto em US$ do agente fora de `agentUsdLimits` (AI_AGENT_DEFAULT_USD_BUDGET); null/ausente = sem teto
   * próprio. O agente novo não fica sem IA nem sem teto: fica no padrão, com aviso uma vez por dia.
   */
  agentDefaultUsdLimit?: number | null;
  /** Origem de cada teto de `agentUsdLimits` (lista configurada ou padrão do código), para o `ai:status`. */
  agentUsdOrigins?: Record<string, AgentCapOrigin>;
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

  /** Estado do global (sem agente) ou do agente: o do agente vale se definido, senão o global. */
  statusOf(agent?: string): AiStatus {
    if (this.policy.status === 'off') return 'off';
    return (agent && this.policy.agentStatus?.[agent]) || 'on';
  }

  /**
   * Teto em US$ do agente: o da lista (null = sem teto próprio) ou, fora dela, o padrão. `origin`: de onde
   * veio — `config` (AI_AGENT_USD_BUDGETS do painel ou do env), `code` (padrão do código) ou `default`
   * (AI_AGENT_DEFAULT_USD_BUDGET, o agente fora da lista).
   */
  agentUsdLimitOf(agent: string): {
    limit: number | null;
    isDefault: boolean;
    origin: AgentCapOrigin | 'default';
  } {
    const own = this.policy.agentUsdLimits?.[agent];
    if (own !== undefined)
      return { limit: own, isDefault: false, origin: this.policy.agentUsdOrigins?.[agent] ?? 'config' };
    return { limit: this.policy.agentDefaultUsdLimit ?? null, isDefault: true, origin: 'default' };
  }

  /**
   * Estado literal (logs, CLI, painel): "desligado", "ligado · sem limite" ou
   * "ligado · limitado · US$ 10/dia · 2.000.000 tokens/dia". Do agente: o teto próprio em US$, se houver.
   */
  describe(agent?: string): string {
    return describeAiState(
      agent
        ? {
            status: this.statusOf(agent),
            usdPerDay: this.agentUsdLimitOf(agent).limit,
            tokensPerDay: this.policy.agentLimits?.[agent] ?? null,
          }
        : {
            status: this.statusOf(),
            usdPerDay: this.policy.dailyUsdLimit ?? null,
            tokensPerDay: this.policy.dailyLimit,
          },
    );
  }

  /** Gasto em US$ do dia: global (sem agente) ou do agente, contra o teto que vale para ele. */
  async usdStatus(agent?: string): Promise<UsdBudgetStatus> {
    const dayUtc = dayUtcOf(this.now());
    const limitUsd = agent ? this.agentUsdLimitOf(agent).limit : (this.policy.dailyUsdLimit ?? null);
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
    // desligado (AI_STATUS / AI_AGENT_STATUS): recusa antes de ler o ledger e de chamar o provedor
    if (this.policy.status === 'off') throw this.disabled(dayUtc, 'global');
    if (this.policy.agentStatus?.[agent] === 'off') throw this.disabled(dayUtc, agent);
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
    const agentUsd = this.agentUsdLimitOf(agent);
    if (agentUsd.limit !== null) {
      if (agentUsd.isDefault) this.warnDefault(dayUtc, agent, agentUsd.limit);
      const used = await this.store.usedUsd(dayUtc, agent);
      limits.push({ who: agent, unit: 'usd', used, limit: agentUsd.limit });
    }
    this.check(limits, { tokens: 0, usd: 0 }, estimate, estimateUsd, false);
    return limits;
  }

  /**
   * Confere os tetos da reserva somando o gasto parcial desta chamada (`spent`: retentativas e
   * continuações já cobradas) e mais uma rodada estimada; lança BudgetExceededError (`midCall`) se não
   * couber. A recusa aqui não é "orçamento esgotado": não consome o aviso único do dia.
   */
  checkPartial(
    limits: readonly ReservedLimit[],
    spent: { tokens: number; usd: number },
    estimate: number,
    estimateUsd: number,
  ): void {
    this.check(limits, spent, estimate, estimateUsd, true);
  }

  private check(
    limits: readonly ReservedLimit[],
    spent: { tokens: number; usd: number },
    estimate: number,
    estimateUsd: number,
    midCall: boolean,
  ): void {
    for (const l of limits) {
      const tokens = l.unit === 'tokens';
      const used = l.used + (tokens ? spent.tokens : spent.usd);
      const next = tokens ? estimate : estimateUsd;
      if (used + next <= l.limit && (tokens || used < l.limit)) continue;
      if (midCall) {
        const err = new BudgetExceededError(l.who, used, l.limit, next, l.unit, true);
        console.warn(`[orçamento de IA] ${err.message}`);
        throw err;
      }
      throw tokens
        ? new BudgetExceededError(l.who, used, l.limit, estimate)
        : this.usdExceeded(dayUtcOf(this.now()), l.who, used, l.limit, estimateUsd);
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
        `[orçamento de IA] ${err.message} (${this.describe(who === 'global' ? undefined : who)}) ${who === 'global' ? 'Todos os agentes seguem' : `O agente ${who} segue`} só com o determinístico até a virada do dia UTC.`,
      );
    }
    return err;
  }

  /** Agente fora de AI_AGENT_USD_BUDGETS: segue no teto padrão; o aviso sai uma vez por dia e agente. */
  private warnDefault(dayUtc: string, agent: string, limit: number): void {
    const key = `${dayUtc}:default:${agent}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      `[orçamento de IA] agente ${agent} fora de AI_AGENT_USD_BUDGETS: segue no teto padrão de US$ ${formatUsdPt(limit)}/dia (AI_AGENT_DEFAULT_USD_BUDGET). Para dar a ele um teto próprio, ponha ${agent}=<US$> na lista.`,
    );
  }

  /** Recusa por IA desligada; o aviso sai uma vez por dia e escopo. */
  private disabled(dayUtc: string, who: string): AiDisabledError {
    const err = new AiDisabledError(who);
    const key = `${dayUtc}:off:${who}`;
    if (!this.warned.has(key)) {
      this.warned.add(key);
      console.warn(`[orçamento de IA] ${err.message}`);
    }
    return err;
  }

  async record(entry: Omit<UsageRecord, 'at'> & { at?: Date }): Promise<void> {
    await this.store.record({ ...entry, at: entry.at ?? this.now() });
  }
}

/** Política do ledger a partir das configurações (estado e tetos do dia). */
export function ledgerPolicy(
  settings: Pick<LedgerSettings, 'dailyTokenBudget' | 'dailyUsdBudget' | 'agentUsdBudgets'> &
    Partial<Pick<LedgerSettings, 'status' | 'agentStatus' | 'agentDefaultUsdBudget' | 'agentUsdOrigins'>>,
): BudgetPolicy {
  return {
    status: settings.status ?? 'on',
    agentStatus: settings.agentStatus ?? {},
    dailyLimit: settings.dailyTokenBudget,
    dailyUsdLimit: settings.dailyUsdBudget,
    agentUsdLimits: settings.agentUsdBudgets,
    agentDefaultUsdLimit: settings.agentDefaultUsdBudget ?? null,
    ...(settings.agentUsdOrigins ? { agentUsdOrigins: settings.agentUsdOrigins } : {}),
  };
}
