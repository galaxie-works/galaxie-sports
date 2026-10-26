/**
 * Ledger diário de IA compartilhado por TODOS os agentes e pelo ingestor (ordem das fotos), em duas medidas:
 * - tokens (AI_DAILY_TOKEN_BUDGET), o teto original;
 * - US$ (AI_DAILY_USD_BUDGET global, AI_AGENT_USD_BUDGETS por agente e AI_AGENT_DEFAULT_USD_BUDGET para o
 *   agente fora da lista), somando o custo dos tokens e o das buscas na web (`cost_usd` de cada linha).
 * Cada chamada ao LLM vira uma linha em `ops.llm_usage` (fonte da verdade); antes de chamar,
 * `TokenBudget.reserve` soma o consumo do dia de orçamento e recusa se a estimativa (de uma tentativa) não
 * couber; antes de cada retentativa ou continuação, quem chama confere de novo com o gasto parcial
 * (`checkPartial`). Agente que bate o próprio teto em US$ fica sem IA até a virada do dia (segue com o
 * determinístico). Ligar e desligar é outra chave, literal: AI_STATUS (global) e AI_AGENT_STATUS (por
 * agente), `on`/`off`; desligado, nenhuma chamada sai.
 *
 * Política de execução (#357): o teto global em US$ é dividido em faixas por prioridade (AI_BAND_SHARES;
 * `bands` na política) e cada chamada desconta da sua faixa (`bandOf`). A faixa esgotada não pega saldo de
 * outra; a reserva só serve a P0. O dia de orçamento vira em AI_BUDGET_DAY_START no fuso AI_BUDGET_TIMEZONE
 * (padrão 06:00 em Brasília; `day` na política, coluna `budget_day`); sem `day`, o dia é o UTC.
 *
 * O limite é "macio" entre processos (a checagem lê o ledger; duas execuções simultâneas podem
 * ultrapassar por no máximo uma chamada cada) — suficiente para conter custo descontrolado.
 */
import { and, eq, sql } from 'drizzle-orm';
import { llmUsage, type Database } from '@galaxie/db';
import {
  AI_CALL_BANDS,
  UTC_BUDGET_DAY,
  bandLimitsUsd,
  budgetDayOf,
  describeBudgetDay,
  type AiBand,
  type AiCallBand,
  type BudgetDay,
} from '@galaxie/runtime-config';
import { AiDisabledError, BudgetExceededError } from './errors.js';
import { bandFor, type AiPolicy, type AiPriority } from './policy.js';
import { agentKey, describeAiState, formatUsdPt, type AiStatus, type LedgerSettings } from './state.js';

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
  /** Dia de orçamento (o TokenBudget preenche; sem ele, o dia UTC de `at`). */
  budgetDay?: string | undefined;
  /** Faixa de orçamento da chamada (AI_BAND_SHARES); null/ausente sem a política de faixas. */
  band?: AiCallBand | null | undefined;
}

export interface TokenBudgetStore {
  /** Tokens (entrada + saída) usados no dia de orçamento — de um agente ou de todos. */
  usedTokens(day: string, agent?: string): Promise<number>;
  /** US$ gastos no dia de orçamento (tokens + buscas, `cost_usd`) — de um agente ou de todos. */
  usedUsd(day: string, agent?: string): Promise<number>;
  /** US$ gastos no dia de orçamento por faixa (só as linhas com faixa). */
  usedUsdByBand(day: string): Promise<Partial<Record<AiCallBand, number>>>;
  record(entry: UsageRecord): Promise<void>;
}

export const dayUtcOf = (d: Date) => d.toISOString().slice(0, 10);
const dayOfEntry = (e: UsageRecord) => e.budgetDay ?? dayUtcOf(e.at);

/** Agente = prefixo de `purpose` (antes do primeiro ":"), sem a versão do prompt. */
export function agentOf(purpose: string): string {
  return agentKey(purpose.split(':')[0] ?? '') || 'unknown';
}

export class PgTokenBudgetStore implements TokenBudgetStore {
  constructor(private readonly db: Database) {}

  /**
   * Linhas do dia de orçamento. Linha sem `budget_day` (gravada por uma versão anterior durante a troca)
   * conta pelo dia UTC: o gasto dela não some do teto.
   */
  private where(day: string, agent?: string) {
    const ofDay = sql`coalesce(${llmUsage.budgetDay}, ${llmUsage.dayUtc}) = ${day}`;
    return agent ? and(ofDay, eq(llmUsage.agent, agent)) : ofDay;
  }

  async usedTokens(day: string, agent?: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens})` })
      .from(llmUsage)
      .where(this.where(day, agent));
    return Number(row?.total ?? 0);
  }

  async usedUsd(day: string, agent?: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${llmUsage.costUsd})` })
      .from(llmUsage)
      .where(this.where(day, agent));
    return Number(row?.total ?? 0);
  }

  async usedUsdByBand(day: string): Promise<Partial<Record<AiCallBand, number>>> {
    const rows = await this.db
      .select({ band: llmUsage.band, total: sql<string | null>`sum(${llmUsage.costUsd})` })
      .from(llmUsage)
      .where(this.where(day))
      .groupBy(llmUsage.band);
    const out: Partial<Record<AiCallBand, number>> = {};
    for (const r of rows) if (r.band) out[r.band as AiCallBand] = Number(r.total ?? 0);
    return out;
  }

  async record(e: UsageRecord): Promise<void> {
    await this.db.insert(llmUsage).values({
      dayUtc: dayUtcOf(e.at),
      budgetDay: dayOfEntry(e),
      band: e.band ?? null,
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

  async usedTokens(day: string, agent?: string): Promise<number> {
    return this.entries
      .filter((e) => dayOfEntry(e) === day && (!agent || e.agent === agent))
      .reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);
  }

  async usedUsd(day: string, agent?: string): Promise<number> {
    return this.entries
      .filter((e) => dayOfEntry(e) === day && (!agent || e.agent === agent))
      .reduce((s, e) => s + (e.costUsd ?? 0), 0);
  }

  async usedUsdByBand(day: string): Promise<Partial<Record<AiCallBand, number>>> {
    const out: Partial<Record<AiCallBand, number>> = {};
    for (const e of this.entries)
      if (e.band && dayOfEntry(e) === day) out[e.band] = (out[e.band] ?? 0) + (e.costUsd ?? 0);
    return out;
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
  /** Buscas na web por chamada; null/ausente = sem teto. */
  maxSearchesPerCall?: number | null;
  /** Virada do dia de orçamento (padrão: 00:00 UTC). */
  day?: BudgetDay;
  /** Faixas por prioridade (#357); ausente = sem faixas (só os tetos global e por agente). */
  bands?: BandPolicy;
}

/** Faixas de orçamento: as % do teto global, a política versionada e quem está chamando. */
export interface BandPolicy {
  shares: Readonly<Record<AiBand, number>>;
  policy: AiPolicy;
  /** Execução fora do scheduler: toda chamada cai na faixa `manual`. */
  manual: boolean;
  /** Prioridade da competição da chamada (agentes `priority`); ausente = `rest`. */
  priorityOf?: (competition: { sport?: string | null; slug: string } | null | undefined) => AiPriority;
}

/** Gasto do dia numa faixa, contra o teto dela (a P0 inclui a reserva). */
export interface BandStatus {
  band: AiCallBand;
  usedUsd: number;
  limitUsd: number | null;
}

export interface BudgetStatus {
  /** Dia de orçamento (YYYY-MM-DD). */
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
  /** Dia de orçamento (YYYY-MM-DD). */
  dayUtc: string;
  usedUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
  /** Gasto bateu o teto: o agente (ou todos) fica sem IA até a virada do dia de orçamento. */
  exhausted: boolean;
}

export class TokenBudget {
  constructor(
    readonly store: TokenBudgetStore,
    readonly policy: BudgetPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async status(agent?: string): Promise<BudgetStatus> {
    const dayUtc = this.today();
    const limit = agent
      ? (this.policy.agentLimits?.[agent] ?? this.policy.dailyLimit)
      : this.policy.dailyLimit;
    const used = await this.store.usedTokens(
      dayUtc,
      agent && this.policy.agentLimits?.[agent] ? agent : undefined,
    );
    return { dayUtc, used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
  }

  /** Dia de orçamento de agora (vira em `policy.day`; padrão 00:00 UTC). */
  today(): string {
    return budgetDayOf(this.now(), this.policy.day ?? UTC_BUDGET_DAY);
  }

  /** Faixa da chamada do agente (null sem a política de faixas); `priority`: a da competição da chamada. */
  bandOf(agent: string, priority?: AiPriority): AiCallBand | null {
    const b = this.policy.bands;
    return b ? bandFor(b.policy, agent, priority, b.manual) : null;
  }

  /** Faixa de uma chamada com a competição dela (a prioridade sai de `bands.priorityOf`). */
  bandOfCall(agent: string, competition?: { sport?: string | null; slug: string } | null): AiCallBand | null {
    const b = this.policy.bands;
    if (!b) return null;
    return this.bandOf(agent, competition && b.priorityOf ? b.priorityOf(competition) : undefined);
  }

  /** Teto em US$ da faixa no dia (a % do teto global; a P0 soma a reserva); null = sem teto. */
  bandLimitOf(band: AiCallBand): number | null {
    const b = this.policy.bands;
    return b ? bandLimitsUsd(this.policy.dailyUsdLimit ?? null, b.shares)[band] : null;
  }

  /** Gasto do dia por faixa (painel, `ai:status`); vazio sem a política de faixas. */
  async bandStatus(): Promise<BandStatus[]> {
    if (!this.policy.bands) return [];
    const used = await this.store.usedUsdByBand(this.today());
    return AI_CALL_BANDS.map((band) => ({
      band,
      usedUsd: used[band] ?? 0,
      limitUsd: this.bandLimitOf(band),
    }));
  }

  /** Estado do global (sem agente) ou do agente: o do agente vale se definido, senão o global. */
  statusOf(agent?: string): AiStatus {
    if (this.policy.status === 'off') return 'off';
    return (agent && this.policy.agentStatus?.[agent]) || 'on';
  }

  /** Teto em US$ do agente: o da lista (null = sem teto próprio) ou, fora dela, o padrão. */
  agentUsdLimitOf(agent: string): { limit: number | null; isDefault: boolean } {
    const own = this.policy.agentUsdLimits?.[agent];
    if (own !== undefined) return { limit: own, isDefault: false };
    return { limit: this.policy.agentDefaultUsdLimit ?? null, isDefault: true };
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
    const dayUtc = this.today();
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
  async reserve(
    agent: string,
    estimate: number,
    estimateUsd = 0,
    band: AiCallBand | null = null,
  ): Promise<ReservedLimit[]> {
    const dayUtc = this.today();
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
    // faixa da prioridade: só o saldo dela (a P0 com a reserva); faixa esgotada não pega de outra
    const bandLimit = band ? this.bandLimitOf(band) : null;
    if (band && bandLimit !== null) {
      const used = (await this.store.usedUsdByBand(dayUtc))[band] ?? 0;
      limits.push({ who: `faixa:${band}`, unit: 'usd', used, limit: bandLimit });
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
        : this.usdExceeded(this.today(), l.who, used, l.limit, estimateUsd);
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
      const band = who.startsWith('faixa:') ? who.slice('faixa:'.length) : null;
      const scope = band
        ? `faixa ${band}${band === 'p0' ? ' (com a reserva)' : ''}: US$ ${formatUsdPt(limit)}/dia`
        : this.describe(who === 'global' ? undefined : who);
      const who_ = band
        ? `As chamadas da faixa ${band} seguem`
        : who === 'global'
          ? 'Todos os agentes seguem'
          : `O agente ${who} segue`;
      console.warn(
        `[orçamento de IA] ${err.message} (${scope}) ${who_} só com o determinístico até a virada do dia de orçamento (${describeBudgetDay(this.policy.day ?? UTC_BUDGET_DAY)}).`,
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
    const at = entry.at ?? this.now();
    await this.store.record({
      ...entry,
      at,
      budgetDay: entry.budgetDay ?? budgetDayOf(at, this.policy.day ?? UTC_BUDGET_DAY),
    });
  }
}

/**
 * Política do ledger a partir das configurações (estado, tetos e virada do dia). Com `policy` (a política
 * versionada), liga as faixas por prioridade; `manual` = execução fora do scheduler (faixa `manual`).
 */
export function ledgerPolicy(
  settings: Pick<LedgerSettings, 'dailyTokenBudget' | 'dailyUsdBudget' | 'agentUsdBudgets'> &
    Partial<
      Pick<LedgerSettings, 'status' | 'agentStatus' | 'agentDefaultUsdBudget' | 'bandShares' | 'budgetDay'>
    >,
  bands?: Omit<BandPolicy, 'shares'>,
): BudgetPolicy {
  return {
    status: settings.status ?? 'on',
    agentStatus: settings.agentStatus ?? {},
    dailyLimit: settings.dailyTokenBudget,
    dailyUsdLimit: settings.dailyUsdBudget,
    agentUsdLimits: settings.agentUsdBudgets,
    agentDefaultUsdLimit: settings.agentDefaultUsdBudget ?? null,
    ...(settings.budgetDay ? { day: settings.budgetDay } : {}),
    ...(bands && settings.bandShares ? { bands: { ...bands, shares: settings.bandShares } } : {}),
  };
}

/** Execução fora do scheduler (o scheduler marca os jobs com GALAXIE_INVOKER=scheduler). */
export const isManualRun = (env: Record<string, string | undefined> = process.env) =>
  env.GALAXIE_INVOKER?.trim() !== 'scheduler';
