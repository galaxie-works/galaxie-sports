import { and, eq, gte, sql } from 'drizzle-orm';
import { quotaBudget, quotaLedger, quotaSnapshot, type Database } from '@galaxie/db';
import { QuotaExceededError } from '../errors.js';
import type { Outcome, Priority } from '../types.js';
import {
  buildReport,
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
 */
export class PgQuotaGovernor implements QuotaGovernor {
  constructor(
    private readonly db: Database,
    private readonly policyFor: (api: string) => QuotaPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
      .select({ providerUsed: quotaSnapshot.providerUsed, capturedAt: quotaSnapshot.capturedAt })
      .from(quotaSnapshot)
      .where(
        and(eq(quotaSnapshot.provider, PROVIDER), eq(quotaSnapshot.api, api), eq(quotaSnapshot.dayUtc, day)),
      );

    let providerUsed: number | undefined;
    if (snap) {
      const [after] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quotaLedger)
        .where(
          and(
            eq(quotaLedger.provider, PROVIDER),
            eq(quotaLedger.api, api),
            eq(quotaLedger.dayUtc, day),
            gte(quotaLedger.sentAt, snap.capturedAt),
          ),
        );
      providerUsed = snap.providerUsed + (after?.n ?? 0);
    }

    return {
      used,
      ...(planned ? { planned } : {}),
      ...(providerUsed !== undefined ? { providerUsed } : {}),
    };
  }

  async acquire(req: AcquireRequest): Promise<QuotaTicket> {
    const day = utcDayString(this.now());
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${PROVIDER}|${req.api}|${day}`}))`);
      const decision = decide(this.policyFor(req.api), await this.snapshot(tx, req.api, day), req.priority, {
        critical: req.critical ?? false,
      });
      if (!decision.allow) throw new QuotaExceededError(req.api, req.priority, decision.reason);
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
      return { id: row!.id, api: req.api, priority: req.priority, dayUtc: day, borrowed: decision.borrowed };
    });
  }

  async settle(ticket: QuotaTicket, outcome: Outcome, remainingAfter?: number): Promise<void> {
    await this.db
      .update(quotaLedger)
      .set({ outcome, remainingAfter: remainingAfter ?? null, sentAt: this.now() })
      .where(eq(quotaLedger.id, ticket.id));
  }

  async release(ticket: QuotaTicket): Promise<void> {
    await this.db
      .delete(quotaLedger)
      .where(and(eq(quotaLedger.id, ticket.id), eq(quotaLedger.outcome, 'pending')));
  }

  async reconcile(api: string, providerUsed: number, providerLimit: number, plan?: string): Promise<void> {
    const dayUtc = utcDayString(this.now());
    await this.db
      .insert(quotaSnapshot)
      .values({ provider: PROVIDER, api, dayUtc, providerUsed, providerLimit, plan: plan ?? null })
      .onConflictDoUpdate({
        target: [quotaSnapshot.provider, quotaSnapshot.api, quotaSnapshot.dayUtc],
        // o contador do fornecedor só cresce no dia: nunca regredir por leitura atrasada
        set: {
          providerUsed: sql`greatest(${quotaSnapshot.providerUsed}, excluded.provider_used)`,
          providerLimit,
          plan: plan ?? null,
          capturedAt: this.now(),
        },
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
