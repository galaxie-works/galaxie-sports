import { QuotaExceededError, RequestInFlightError } from '../errors.js';
import type { Outcome, Priority } from '../types.js';
import {
  budgetFor,
  decide,
  effectivePolicy,
  emptyUsage,
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
  critical?: boolean | undefined;
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
}

/** Pendências mais antigas que isso são consideradas abandonadas (processo caiu) e não bloqueiam. */
export const IN_FLIGHT_STALE_MS = 5 * 60_000;

/** Orçamento diário de chamadas por API e prioridade (docs/03 §9). */
export interface QuotaGovernor {
  /**
   * Reserva 1 chamada ou lança QuotaExceededError. A reserva já conta no orçamento.
   * Lança RequestInFlightError se uma chamada com o mesmo request hash ainda estiver pendente.
   */
  acquire(req: AcquireRequest): Promise<QuotaTicket>;
  /** Registra o desfecho da chamada enviada. */
  settle(ticket: QuotaTicket, outcome: Outcome, remainingAfter?: number): Promise<void>;
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
  };
}

/** Implementação em memória (testes, scripts locais). Mesma política da versão Postgres. */
export class InMemoryQuotaGovernor implements QuotaGovernor {
  private seq = 0;
  private readonly ledger = new Map<
    number,
    { api: string; day: string; priority: Priority; outcome: string; requestHash: string; at: number }
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
  ) {}

  private callsAfter(api: string, day: string, seq: number): number {
    return [...this.ledger.entries()].filter(([id, r]) => id > seq && r.api === api && r.day === day).length;
  }

  private snapshot(api: string, day: string): UsageSnapshot {
    const used = emptyUsage();
    for (const row of this.ledger.values()) if (row.api === api && row.day === day) used[row.priority] += 1;
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
    };
  }

  async acquire(req: AcquireRequest): Promise<QuotaTicket> {
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
    const decision = decide(this.policyFor(req.api), this.snapshot(req.api, day), req.priority, {
      critical: req.critical ?? false,
    });
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

  async settle(ticket: QuotaTicket, outcome: Outcome): Promise<void> {
    const row = this.ledger.get(ticket.id);
    if (row) row.outcome = outcome;
  }

  async release(ticket: QuotaTicket): Promise<void> {
    this.ledger.delete(ticket.id);
  }

  async reconcile(api: string, providerUsed: number, providerLimit: number, _plan?: string): Promise<void> {
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
