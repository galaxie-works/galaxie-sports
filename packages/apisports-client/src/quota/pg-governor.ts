import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { quotaBudget, quotaLedger, quotaSnapshot, type Database } from '@galaxie/db';
import { QuotaExceededError, RequestInFlightError } from '../errors.js';
import type { Outcome, Priority } from '../types.js';
import {
  buildReport,
  IN_FLIGHT_STALE_MS,
  utcDayString,
  type AcquireRequest,
  type QuotaGovernor,
  type QuotaTicket,
  type UsageReport,
} from './governor.js';
import { decide, emptyUsage, type QuotaPolicy, type UsageSnapshot } from './policy.js';

const PROVIDER = 'api-sports';

/**
 * Quota Governor sobre Postgres. A reserva é uma linha `pending` em ops.quota_ledger inserida
 * sob advisory lock por (api, dia) — vários workers concorrentes nunca ultrapassam o orçamento.
 * Com `perMinute` na política, a reserva também espera a vaga do limite por minuto da API, somando
 * todos os processos que usam a chave.
 */
export class PgQuotaGovernor implements QuotaGovernor {
  constructor(
    private readonly db: Database,
    private readonly policyFor: (api: string) => QuotaPolicy,
    private readonly now: () => Date = () => new Date(),
    /** Espera pela vaga do limite por minuto (testes injetam um relógio falso). */
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async countSince(
    tx: Pick<Database, 'select'>,
    api: string,
    day: string,
    since: Date,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(quotaLedger)
      .where(
        and(
          eq(quotaLedger.provider, PROVIDER),
          eq(quotaLedger.api, api),
          eq(quotaLedger.dayUtc, day),
          gte(quotaLedger.sentAt, since),
        ),
      );
    return row?.n ?? 0;
  }

  private async snapshot(tx: Pick<Database, 'select'>, api: string, day: string): Promise<UsageSnapshot> {
    const used = emptyUsage();
    const counts = await tx
      .select({ priority: quotaLedger.priority, n: sql<number>`count(*)::int` })
      .from(quotaLedger)
      .where(and(eq(quotaLedger.provider, PROVIDER), eq(quotaLedger.api, api), eq(quotaLedger.dayUtc, day)))
      .groupBy(quotaLedger.priority);
    for (const c of counts) used[c.priority as Priority] = c.n;

    const planRows = await tx
      .select({ priority: quotaBudget.priority, planned: quotaBudget.planned })
      .from(quotaBudget)
      .where(and(eq(quotaBudget.provider, PROVIDER), eq(quotaBudget.api, api), eq(quotaBudget.dayUtc, day)));
    const planned = planRows.length
      ? (Object.fromEntries(planRows.map((r) => [r.priority, r.planned])) as Partial<
          Record<Priority, number>
        >)
      : undefined;

    const [snap] = await tx
      .select({
        providerUsed: quotaSnapshot.providerUsed,
        providerLimit: quotaSnapshot.providerLimit,
        capturedAt: quotaSnapshot.capturedAt,
      })
      .from(quotaSnapshot)
      .where(
        and(eq(quotaSnapshot.provider, PROVIDER), eq(quotaSnapshot.api, api), eq(quotaSnapshot.dayUtc, day)),
      );

    return {
      used,
      ...(planned ? { planned } : {}),
      ...(snap
        ? {
            providerUsed: snap.providerUsed + (await this.countSince(tx, api, day, snap.capturedAt)),
            providerLimit: snap.providerLimit,
          }
        : {}),
    };
  }

  async acquire(req: AcquireRequest): Promise<QuotaTicket> {
    for (;;) {
      const attempt = await this.tryAcquire(req);
      if ('ticket' in attempt) return attempt.ticket;
      await this.sleep(attempt.waitMs);
    }
  }

  /** Uma tentativa sob o lock: o ticket, ou quanto esperar pela próxima vaga do limite por minuto. */
  private async tryAcquire(req: AcquireRequest): Promise<{ ticket: QuotaTicket } | { waitMs: number }> {
    const day = utcDayString(this.now());
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${PROVIDER}|${req.api}|${day}`}))`);
      // provider/api/dia usam o índice quota_ledger_day_idx (só pelo hash seria seq scan sob o lock);
      // o dia anterior cobre a pendência de até IN_FLIGHT_STALE_MS atrás na virada da meia-noite UTC
      const [inFlight] = await tx
        .select({ id: quotaLedger.id })
        .from(quotaLedger)
        .where(
          and(
            eq(quotaLedger.provider, PROVIDER),
            eq(quotaLedger.api, req.api),
            inArray(quotaLedger.dayUtc, [day, previousUtcDay(day)]),
            eq(quotaLedger.requestHash, req.requestHash),
            eq(quotaLedger.outcome, 'pending'),
            gte(quotaLedger.sentAt, new Date(this.now().getTime() - IN_FLIGHT_STALE_MS)),
          ),
        )
        .limit(1);
      if (inFlight) throw new RequestInFlightError(req.requestHash);
      const policy = this.policyFor(req.api);
      const decision = decide(policy, await this.snapshot(tx, req.api, day), req.priority, {
        critical: req.critical ?? false,
      });
      if (!decision.allow) throw new QuotaExceededError(req.api, req.priority, decision.reason);
      if (policy.perMinute !== undefined && policy.perMinute > 0) {
        const waitMs = await this.minuteWait(tx, req.api, day, policy.perMinute);
        if (waitMs > 0) return { waitMs };
      }
      const [row] = await tx
        .insert(quotaLedger)
        .values({
          provider: PROVIDER,
          api: req.api,
          dayUtc: day,
          priority: req.priority,
          endpoint: req.endpoint,
          requestHash: req.requestHash,
          outcome: 'pending',
          jobId: req.jobId ?? null,
          sentAt: this.now(),
        })
        .returning({ id: quotaLedger.id });
      return {
        ticket: {
          id: row!.id,
          api: req.api,
          priority: req.priority,
          dayUtc: day,
          borrowed: decision.borrowed,
        },
      };
    });
  }

  /**
   * Limite por minuto da chave somando todos os processos: no máximo 1 envio a cada 60/perMinute s por API
   * (a mesma regra sem rajada do RateLimiter local), contado pelo sent_at do ledger. O cliente reserva logo
   * antes do fetch, então sent_at é o instante do envio. O lock próprio por API (sem o dia) fecha a
   * virada da meia-noite UTC, quando dois processos seguram locks de dias diferentes.
   */
  private async minuteWait(
    tx: Pick<Database, 'select' | 'execute'>,
    api: string,
    day: string,
    perMinute: number,
  ): Promise<number> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${PROVIDER}|${api}|per-minute`}))`);
    const spacingMs = 60_000 / perMinute;
    const nowMs = this.now().getTime();
    const [row] = await tx
      .select({ last: sql<Date | null>`max(${quotaLedger.sentAt})`.mapWith(quotaLedger.sentAt) })
      .from(quotaLedger)
      .where(
        and(
          eq(quotaLedger.provider, PROVIDER),
          eq(quotaLedger.api, api),
          inArray(quotaLedger.dayUtc, [day, previousUtcDay(day)]),
          gte(quotaLedger.sentAt, new Date(nowMs - spacingMs)),
        ),
      );
    return row?.last ? Math.ceil(row.last.getTime() + spacingMs - nowMs) : 0;
  }

  async settle(ticket: QuotaTicket, outcome: Outcome, remainingAfter?: number): Promise<void> {
    await this.db
      .update(quotaLedger)
      // sent_at fica o do envio: reescrever com a hora do desfecho contaria de novo, no piso do
      // fornecedor, uma chamada que já estava no contador lido por um /status no meio dela
      .set({ outcome, remainingAfter: remainingAfter ?? null })
      .where(eq(quotaLedger.id, ticket.id));
  }

  async release(ticket: QuotaTicket): Promise<void> {
    await this.db
      .delete(quotaLedger)
      .where(and(eq(quotaLedger.id, ticket.id), eq(quotaLedger.outcome, 'pending')));
  }

  async reconcile(api: string, providerUsed: number, providerLimit: number, plan?: string): Promise<void> {
    const dayUtc = utcDayString(this.now());
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${PROVIDER}|${api}|${dayUtc}`}))`);
      const [prev] = await tx
        .select({ providerUsed: quotaSnapshot.providerUsed, capturedAt: quotaSnapshot.capturedAt })
        .from(quotaSnapshot)
        .where(
          and(
            eq(quotaSnapshot.provider, PROVIDER),
            eq(quotaSnapshot.api, api),
            eq(quotaSnapshot.dayUtc, dayUtc),
          ),
        );
      // O contador do fornecedor é eventualmente consistente: uma leitura atrasada não pode "esquecer"
      // as chamadas feitas desde a leitura anterior. Incorporamos essas chamadas ao piso antes de avançar.
      const baseline = prev
        ? prev.providerUsed + (await this.countSince(tx, api, dayUtc, prev.capturedAt))
        : 0;
      const values = {
        providerUsed: Math.max(baseline, providerUsed),
        providerLimit,
        plan: plan ?? null,
        capturedAt: this.now(),
      };
      await tx
        .insert(quotaSnapshot)
        .values({ provider: PROVIDER, api, dayUtc, ...values })
        .onConflictDoUpdate({
          target: [quotaSnapshot.provider, quotaSnapshot.api, quotaSnapshot.dayUtc],
          set: values,
        });
    });
  }

  async plan(api: string, dayUtc: string, planned: Partial<Record<Priority, number>>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [priority, value] of Object.entries(planned)) {
        await tx
          .insert(quotaBudget)
          .values({ provider: PROVIDER, api, dayUtc, priority: priority as Priority, planned: value })
          .onConflictDoUpdate({
            target: [quotaBudget.provider, quotaBudget.api, quotaBudget.dayUtc, quotaBudget.priority],
            set: { planned: value },
          });
      }
    });
  }

  async usage(api: string, dayUtc = utcDayString(this.now())): Promise<UsageReport> {
    return buildReport(this.policyFor(api), api, dayUtc, await this.snapshot(this.db, api, dayUtc));
  }
}

/** "2026-10-21" → "2026-10-20". */
function previousUtcDay(day: string): string {
  return utcDayString(new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000));
}
