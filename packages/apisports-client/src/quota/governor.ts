import { QuotaExceededError, RequestInFlightError } from '../errors.js';
import type { Outcome, Priority } from '../types.js';
import {
  budgetFor,
  decide,
  effectivePolicy,
  emptyUsage,
  exhaustedSince,
  headerFloorApplies,
  RATE_LIMIT_PAUSE_MS,
  reserveOf,
  type QuotaPolicy,
  type UsageSnapshot,
} from './policy.js';

export interface AcquireRequest {
  api: string;
  priority: Priority;
  endpoint: string;
  requestHash: string;
  jobId?: string | undefined;
}

export interface QuotaTicket {
  id: number;
  api: string;
  priority: Priority;
  dayUtc: string;
  borrowed: boolean;
}

export interface UsageReport {
  api: string;
  dayUtc: string;
  dailyLimit: number;
  reserve: number;
  used: Record<Priority, number>;
  budget: Record<Priority, number>;
  totalUsed: number;
  providerUsed?: number | undefined;
  providerLimit?: number | undefined;
  /** true enquanto um quota_exhausted recente do fornecedor nega a API (ver `exhaustedSince`). */
  providerExhausted?: boolean | undefined;
  /** Fim da pausa da API depois de um limite por minuto do fornecedor (ver `RATE_LIMIT_PAUSE_MS`). */
  pausedUntil?: string | undefined;
}

/** Pendências mais antigas que isso são consideradas abandonadas (processo caiu) e não bloqueiam. */
export const IN_FLIGHT_STALE_MS = 5 * 60_000;

/** Orçamento diário de chamadas por API e prioridade (docs/03 §9). */
export interface QuotaGovernor {
  /**
   * Reserva 1 chamada ou lança QuotaExceededError. A reserva já conta no orçamento.
   * Lança RequestInFlightError se uma chamada com o mesmo request hash ainda estiver pendente.
   * Durante a pausa de um limite por minuto (`rate_limited` recente), espera ela acabar.
   */
  acquire(req: AcquireRequest): Promise<QuotaTicket>;
  /**
   * Registra o desfecho da chamada enviada. `remainingAfter` (header `x-ratelimit-requests-remaining`) e
   * `providerLimit` (`x-ratelimit-requests-limit`) contam a conta inteira, as duas pontas que usam a chave:
   * `limite − restante` vira piso do contador do fornecedor, como uma leitura do /status.
   */
  settle(
    ticket: QuotaTicket,
    outcome: Outcome,
    remainingAfter?: number,
    providerLimit?: number,
  ): Promise<void>;
  /** Desfaz uma reserva que não chegou a ser enviada. */
  release(ticket: QuotaTicket): Promise<void>;
  /** Registra o contador do fornecedor (/status) como piso para o dia. */
  reconcile(api: string, providerUsed: number, providerLimit: number, plan?: string): Promise<void>;
  /** Planeja o dia (ex.: LIVE = 0 em dia sem jogos libera folga para o BOOTSTRAP). */
  plan(api: string, dayUtc: string, planned: Partial<Record<Priority, number>>): Promise<void>;
  usage(api: string, dayUtc?: string): Promise<UsageReport>;
}

export function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildReport(
  configured: QuotaPolicy,
  api: string,
  dayUtc: string,
  usage: UsageSnapshot,
): UsageReport {
  const policy = effectivePolicy(configured, usage);
  const budget = Object.fromEntries(
    (Object.keys(usage.used) as Priority[]).map((p) => [p, budgetFor(policy, usage, p)]),
  ) as Record<Priority, number>;
  return {
    api,
    dayUtc,
    dailyLimit: policy.dailyLimit,
    reserve: reserveOf(policy),
    used: usage.used,
    budget,
    totalUsed: Object.values(usage.used).reduce((a, b) => a + b, 0),
    providerUsed: usage.providerUsed,
    providerLimit: usage.providerLimit,
    ...(usage.providerExhausted ? { providerExhausted: true } : {}),
    ...(usage.pausedUntil !== undefined ? { pausedUntil: new Date(usage.pausedUntil).toISOString() } : {}),
  };
}

/**
 * Leitura do header de cota como piso do contador do fornecedor: `limite − restante`, ou nada quando a resposta
 * não serve de piso (quota_exhausted tem a sua própria espera, header fora da faixa, começo do dia).
 */
export function headerFloor(
  ticket: Pick<QuotaTicket, 'dayUtc'>,
  outcome: Outcome,
  nowMs: number,
  remainingAfter: number | undefined,
  limit: number,
): number | undefined {
  if (remainingAfter === undefined || outcome === 'quota_exhausted') return undefined;
  if (remainingAfter < 0 || remainingAfter > limit || !headerFloorApplies(ticket.dayUtc, nowMs))
    return undefined;
  return limit - remainingAfter;
}

/** Implementação em memória (testes, scripts locais). Mesma política da versão Postgres. */
export class InMemoryQuotaGovernor implements QuotaGovernor {
  private seq = 0;
  private readonly ledger = new Map<
    number,
    {
      api: string;
      day: string;
      priority: Priority;
      outcome: string;
      requestHash: string;
      at: number;
      remainingAfter?: number | undefined;
    }
  >();
  /** Contador do fornecedor e o último id do ledger no momento da leitura. */
  private readonly snapshots = new Map<
    string,
    { providerUsed: number; providerLimit: number; seqAtCapture: number }
  >();
  private readonly plans = new Map<string, Partial<Record<Priority, number>>>();

  constructor(
    private readonly policyFor: (api: string) => QuotaPolicy,
    private readonly now: () => Date = () => new Date(),
    /** Espera pelo fim da pausa de um limite por minuto (testes injetam um relógio falso). */
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private callsAfter(api: string, day: string, seq: number): number {
    return [...this.ledger.entries()].filter(([id, r]) => id > seq && r.api === api && r.day === day).length;
  }

  private snapshot(api: string, day: string): UsageSnapshot {
    const used = emptyUsage();
    const nowMs = this.now().getTime();
    const since = exhaustedSince(day, nowMs);
    let providerExhausted = false;
    let lastRateLimited: number | undefined;
    for (const row of this.ledger.values()) {
      if (row.api !== api || row.day !== day) continue;
      used[row.priority] += 1;
      if (row.outcome === 'quota_exhausted' && !row.remainingAfter && row.at >= since)
        providerExhausted = true;
      if (row.outcome === 'rate_limited' && row.at > (lastRateLimited ?? -Infinity)) lastRateLimited = row.at;
    }
    const pausedUntil =
      lastRateLimited !== undefined ? Math.min(lastRateLimited, nowMs) + RATE_LIMIT_PAUSE_MS : undefined;
    const snap = this.snapshots.get(`${api}|${day}`);
    const planned = this.plans.get(`${api}|${day}`);
    return {
      used,
      ...(snap
        ? {
            providerUsed: snap.providerUsed + this.callsAfter(api, day, snap.seqAtCapture),
            providerLimit: snap.providerLimit,
          }
        : {}),
      ...(planned ? { planned } : {}),
      ...(providerExhausted ? { providerExhausted } : {}),
      ...(pausedUntil !== undefined && pausedUntil > nowMs ? { pausedUntil } : {}),
    };
  }

  async acquire(req: AcquireRequest): Promise<QuotaTicket> {
    for (;;) {
      const day = utcDayString(this.now());
      const nowMs = this.now().getTime();
      for (const row of this.ledger.values()) {
        if (
          row.requestHash === req.requestHash &&
          row.outcome === 'pending' &&
          nowMs - row.at < IN_FLIGHT_STALE_MS
        ) {
          throw new RequestInFlightError(req.requestHash);
        }
      }
      const usage = this.snapshot(req.api, day);
      if (usage.pausedUntil !== undefined) {
        await this.sleep(usage.pausedUntil - nowMs);
        continue;
      }
      const decision = decide(this.policyFor(req.api), usage, req.priority);
      if (!decision.allow) throw new QuotaExceededError(req.api, req.priority, decision.reason);
      const id = ++this.seq;
      this.ledger.set(id, {
        api: req.api,
        day,
        priority: req.priority,
        outcome: 'pending',
        requestHash: req.requestHash,
        at: nowMs,
      });
      return { id, api: req.api, priority: req.priority, dayUtc: day, borrowed: decision.borrowed };
    }
  }

  async settle(
    ticket: QuotaTicket,
    outcome: Outcome,
    remainingAfter?: number,
    providerLimit?: number,
  ): Promise<void> {
    const row = this.ledger.get(ticket.id);
    const day = utcDayString(this.now());
    // como no Pg: a pausa de um rate_limited conta da chegada da resposta (no mesmo dia UTC)
    if (row)
      Object.assign(row, {
        outcome,
        remainingAfter,
        ...(outcome === 'rate_limited' && day === ticket.dayUtc ? { at: this.now().getTime() } : {}),
      });
    const limit =
      providerLimit ??
      this.snapshots.get(`${ticket.api}|${day}`)?.providerLimit ??
      this.policyFor(ticket.api).dailyLimit;
    const floor = headerFloor(ticket, outcome, this.now().getTime(), remainingAfter, limit);
    if (floor !== undefined) this.raiseFloor(ticket.api, floor, limit);
  }

  async release(ticket: QuotaTicket): Promise<void> {
    this.ledger.delete(ticket.id);
  }

  async reconcile(api: string, providerUsed: number, providerLimit: number, _plan?: string): Promise<void> {
    this.raiseFloor(api, providerUsed, providerLimit);
  }

  private raiseFloor(api: string, providerUsed: number, providerLimit: number): void {
    const day = utcDayString(this.now());
    const key = `${api}|${day}`;
    const prev = this.snapshots.get(key);
    // leitura atrasada não pode "esquecer" chamadas feitas desde a leitura anterior
    const baseline = prev ? prev.providerUsed + this.callsAfter(api, day, prev.seqAtCapture) : 0;
    this.snapshots.set(key, {
      providerUsed: Math.max(baseline, providerUsed),
      providerLimit,
      seqAtCapture: this.seq,
    });
  }

  async plan(api: string, dayUtc: string, planned: Partial<Record<Priority, number>>): Promise<void> {
    this.plans.set(`${api}|${dayUtc}`, planned);
  }

  async usage(api: string, dayUtc = utcDayString(this.now())): Promise<UsageReport> {
    return buildReport(this.policyFor(api), api, dayUtc, this.snapshot(api, dayUtc));
  }
}
