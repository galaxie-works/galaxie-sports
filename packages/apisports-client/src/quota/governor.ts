import { QuotaExceededError } from '../errors.js';
import type { Outcome, Priority } from '../types.js';
import { budgetFor, decide, emptyUsage, reserveOf, type QuotaPolicy, type UsageSnapshot } from './policy.js';

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
}

/** Orçamento diário de chamadas por API e prioridade (docs/03 §9). */
export interface QuotaGovernor {
  /** Reserva 1 chamada ou lança QuotaExceededError. A reserva já conta no orçamento. */
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
  policy: QuotaPolicy,
  api: string,
  dayUtc: string,
  usage: UsageSnapshot,
): UsageReport {
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
  };
}

/** Implementação em memória (testes, scripts locais). Mesma política da versão Postgres. */
export class InMemoryQuotaGovernor implements QuotaGovernor {
  private seq = 0;
  private readonly ledger = new Map<
    number,
    { api: string; day: string; priority: Priority; outcome: string }
  >();
  /** Contador do fornecedor e o último id do ledger no momento da leitura. */
  private readonly snapshots = new Map<string, { providerUsed: number; seqAtCapture: number }>();
  private readonly plans = new Map<string, Partial<Record<Priority, number>>>();

  constructor(
    private readonly policyFor: (api: string) => QuotaPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private snapshot(api: string, day: string): UsageSnapshot {
    const used = emptyUsage();
    for (const row of this.ledger.values()) if (row.api === api && row.day === day) used[row.priority] += 1;
    const snap = this.snapshots.get(`${api}|${day}`);
    const providerUsed = snap
      ? snap.providerUsed +
        [...this.ledger.entries()].filter(
          ([id, r]) => id > snap.seqAtCapture && r.api === api && r.day === day,
        ).length
      : undefined;
    const planned = this.plans.get(`${api}|${day}`);
    return { used, ...(providerUsed !== undefined ? { providerUsed } : {}), ...(planned ? { planned } : {}) };
  }

  async acquire(req: AcquireRequest): Promise<QuotaTicket> {
    const day = utcDayString(this.now());
    const decision = decide(this.policyFor(req.api), this.snapshot(req.api, day), req.priority, {
      critical: req.critical ?? false,
    });
    if (!decision.allow) throw new QuotaExceededError(req.api, req.priority, decision.reason);
    const id = ++this.seq;
    this.ledger.set(id, { api: req.api, day, priority: req.priority, outcome: 'pending' });
    return { id, api: req.api, priority: req.priority, dayUtc: day, borrowed: decision.borrowed };
  }

  async settle(ticket: QuotaTicket, outcome: Outcome): Promise<void> {
    const row = this.ledger.get(ticket.id);
    if (row) row.outcome = outcome;
  }

  async release(ticket: QuotaTicket): Promise<void> {
    this.ledger.delete(ticket.id);
  }

  async reconcile(api: string, providerUsed: number, _providerLimit?: number, _plan?: string): Promise<void> {
    const key = `${api}|${utcDayString(this.now())}`;
    const previous = this.snapshots.get(key)?.providerUsed ?? 0;
    this.snapshots.set(key, { providerUsed: Math.max(previous, providerUsed), seqAtCapture: this.seq });
  }

  async plan(api: string, dayUtc: string, planned: Partial<Record<Priority, number>>): Promise<void> {
    this.plans.set(`${api}|${dayUtc}`, planned);
  }

  async usage(api: string, dayUtc = utcDayString(this.now())): Promise<UsageReport> {
    return buildReport(this.policyFor(api), api, dayUtc, this.snapshot(api, dayUtc));
  }
}
