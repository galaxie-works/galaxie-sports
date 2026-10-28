import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { quotaBudget, quotaLedger, quotaSnapshot, type Database } from '@galaxie/db';
import { QuotaExceededError, RequestInFlightError } from '../errors.js';
import type { Outcome, Priority } from '../types.js';
import {
  buildReport,
  headerFloor,
  IN_FLIGHT_STALE_MS,
  utcDayString,
  type AcquireRequest,
  type QuotaGovernor,
  type QuotaTicket,
  type UsageReport,
} from './governor.js';
import {
  decide,
  emptyUsage,
  exhaustedSince,
  RATE_LIMIT_PAUSE_MS,
  type QuotaPolicy,
  type UsageSnapshot,
} from './policy.js';

const PROVIDER = 'api-sports';
/**
 * Intervalo mínimo, por API e processo, entre duas gravações do header de cota como piso: cada gravação disputa o
 * lock do dia com as reservas, e um header de alguns segundos atrás já basta para enxergar a outra ponta.
 */
export const HEADER_FLOOR_INTERVAL_MS = 5_000;

/**
 * Quota Governor sobre Postgres. A reserva é uma linha `pending` em ops.quota_ledger inserida
 * sob advisory lock por (api, dia) — vários workers concorrentes nunca ultrapassam o orçamento.
 * Com `perMinute` na política, a reserva também espera a vaga do limite por minuto da API, somando
 * todos os processos que usam a chave. Depois de um `rate_limited`, as reservas daquela API neste banco
 * esperam a pausa (RATE_LIMIT_PAUSE_MS). O header de cota de cada resposta vira piso do contador do
 * fornecedor em ops.quota_snapshot, junto com a leitura de hora em hora do /status.
 */
export class PgQuotaGovernor implements QuotaGovernor {
  /** Última gravação do header de cota como piso, por API (ver HEADER_FLOOR_INTERVAL_MS). */
  private readonly lastHeaderFloor = new Map<string, number>();

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

  private async snapshot(
    tx: Pick<Database, 'select'>,
    api: string,
    day: string,
    nowMs: number,
  ): Promise<UsageSnapshot> {
    const used = emptyUsage();
    // na mesma passada: um quota_exhausted recente do dia (sem `remaining` positivo) nega a API por um tempo,
    // e um rate_limited recente pausa a API
    const since = new Date(exhaustedSince(day, nowMs)).toISOString();
    const pauseSince = new Date(nowMs - RATE_LIMIT_PAUSE_MS).toISOString();
    const counts = await tx
      .select({
        priority: quotaLedger.priority,
        n: sql<number>`count(*)::int`,
        exhausted: sql<number>`(count(*) filter (where ${quotaLedger.outcome} = 'quota_exhausted'
          and coalesce(${quotaLedger.remainingAfter}, 0) = 0 and ${quotaLedger.sentAt} >= ${since}::timestamptz))::int`,
        rateLimitedAt:
          sql<Date | null>`max(${quotaLedger.sentAt}) filter (where ${quotaLedger.outcome} = 'rate_limited'
          and ${quotaLedger.sentAt} >= ${pauseSince}::timestamptz)`.mapWith(quotaLedger.sentAt),
      })
      .from(quotaLedger)
      .where(and(eq(quotaLedger.provider, PROVIDER), eq(quotaLedger.api, api), eq(quotaLedger.dayUtc, day)))
      .groupBy(quotaLedger.priority);
    for (const c of counts) used[c.priority as Priority] = c.n;
    const providerExhausted = counts.some((c) => c.exhausted > 0);
    // um sent_at no futuro (relógio adiantado de outro processo) não estica a pausa além de RATE_LIMIT_PAUSE_MS
    const rateLimitedAt = Math.max(-Infinity, ...counts.map((c) => c.rateLimitedAt?.getTime() ?? -Infinity));
    const pausedUntil = Math.min(rateLimitedAt, nowMs) + RATE_LIMIT_PAUSE_MS;

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
      ...(providerExhausted ? { providerExhausted } : {}),
      ...(pausedUntil > nowMs ? { pausedUntil } : {}),
    };
  }

  async acquire(req: AcquireRequest): Promise<QuotaTicket> {
    for (;;) {
      const attempt = await this.tryAcquire(req);
      if ('ticket' in attempt) return attempt.ticket;
      await this.sleep(attempt.waitMs);
    }
  }

  /**
   * Uma tentativa sob os locks: o ticket, ou quanto esperar pela próxima vaga do limite por minuto.
   */
  private async tryAcquire(req: AcquireRequest): Promise<{ ticket: QuotaTicket } | { waitMs: number }> {
    const day = utcDayString(this.now());
    const policy = this.policyFor(req.api);
    const perMinute = policy.perMinute !== undefined && policy.perMinute > 0 ? policy.perMinute : undefined;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${PROVIDER}|${req.api}|${day}`}))`);
      // lock por API, sem o dia: na virada da meia-noite UTC, processos com locks de dias diferentes
      // também disputam a mesma vaga do minuto
      if (perMinute)
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${PROVIDER}|${req.api}|per-minute`}))`);
      // O relógio é lido depois dos locks. Se o dia virou durante a espera, tenta de novo com o lock do dia
      // novo: assim day_utc é sempre o dia do sent_at, e as buscas por janela só olham os dias que ela cruza.
      const nowMs = this.now().getTime();
      if (utcDayString(new Date(nowMs)) !== day) return { waitMs: 0 };
      // provider/api/dia usam o índice quota_ledger_day_idx (só pelo hash seria seq scan sob o lock)
      const staleBefore = nowMs - IN_FLIGHT_STALE_MS;
      const [inFlight] = await tx
        .select({ id: quotaLedger.id })
        .from(quotaLedger)
        .where(
          and(
            eq(quotaLedger.provider, PROVIDER),
            eq(quotaLedger.api, req.api),
            inArray(quotaLedger.dayUtc, utcDaysBetween(staleBefore, nowMs)),
            eq(quotaLedger.requestHash, req.requestHash),
            eq(quotaLedger.outcome, 'pending'),
            gte(quotaLedger.sentAt, new Date(staleBefore)),
          ),
        )
        .limit(1);
      if (inFlight) throw new RequestInFlightError(req.requestHash);
      // a vaga vem depois da checagem em voo (o pedido duplicado não espera o espaçamento à toa) e antes do
      // snapshot, para que o retry de quem perdeu a vaga saia barato
      if (perMinute) {
        const waitMs = await this.minuteWait(tx, req.api, perMinute, nowMs);
        if (waitMs > 0) return { waitMs };
      }
      const usage = await this.snapshot(tx, req.api, day, nowMs);
      if (usage.pausedUntil !== undefined) return { waitMs: usage.pausedUntil - nowMs };
      const decision = decide(policy, usage, req.priority);
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
          sentAt: new Date(nowMs),
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
   * antes do fetch, então sent_at é o instante do envio. A espera de UMA tentativa nunca passa do
   * espaçamento, mesmo com um sent_at no futuro; mas, enquanto o relógio de outro processo estiver
   * adiantado, cada nova tentativa volta a esperar, e a espera total acompanha esse adiantamento.
   */
  private async minuteWait(
    tx: Pick<Database, 'select'>,
    api: string,
    perMinute: number,
    nowMs: number,
  ): Promise<number> {
    const spacingMs = 60_000 / perMinute;
    const since = nowMs - spacingMs;
    const [row] = await tx
      .select({ last: sql<Date | null>`max(${quotaLedger.sentAt})`.mapWith(quotaLedger.sentAt) })
      .from(quotaLedger)
      .where(
        and(
          eq(quotaLedger.provider, PROVIDER),
          eq(quotaLedger.api, api),
          inArray(quotaLedger.dayUtc, utcDaysBetween(since, nowMs)),
          gte(quotaLedger.sentAt, new Date(since)),
        ),
      );
    if (!row?.last) return 0;
    return Math.min(spacingMs, Math.ceil(row.last.getTime() + spacingMs - nowMs));
  }

  async settle(
    ticket: QuotaTicket,
    outcome: Outcome,
    remainingAfter?: number,
    providerLimit?: number,
  ): Promise<void> {
    const nowMs = this.now().getTime();
    await this.db
      .update(quotaLedger)
      // sent_at fica o do envio: reescrever com a hora do desfecho contaria de novo, no piso do
      // fornecedor, uma chamada que já estava no contador lido por um /status no meio dela. A exceção é o
      // rate_limited: a pausa conta da chegada da resposta (um 429 que demorou 20 s ainda pausa 30 s), e uma
      // chamada recusada a mais no piso é o preço. Só no mesmo dia UTC: day_utc é sempre o dia do sent_at.
      .set({
        outcome,
        remainingAfter: remainingAfter ?? null,
        ...(outcome === 'rate_limited' && utcDayString(new Date(nowMs)) === ticket.dayUtc
          ? { sentAt: new Date(nowMs) }
          : {}),
      })
      .where(eq(quotaLedger.id, ticket.id));

    // checagem barata antes do lock (o limite de verdade só se sabe com o snapshot)
    if (headerFloor(ticket, outcome, nowMs, remainingAfter, Number.MAX_SAFE_INTEGER) === undefined) return;
    if (nowMs - (this.lastHeaderFloor.get(ticket.api) ?? -Infinity) < HEADER_FLOOR_INTERVAL_MS) return;
    this.lastHeaderFloor.set(ticket.api, nowMs);
    // o piso é uma leitura a mais: se a gravação falhar, a chamada (que deu certo) não falha junto, e o
    // próximo header ou o /status de hora em hora cobrem
    await this.raiseFloorFromHeader(ticket, outcome, nowMs, remainingAfter, providerLimit).catch(() => {});
  }

  private async raiseFloorFromHeader(
    ticket: QuotaTicket,
    outcome: Outcome,
    nowMs: number,
    remainingAfter: number | undefined,
    providerLimit: number | undefined,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const prev = await this.lockedSnapshot(tx, ticket.api, ticket.dayUtc);
      const limit = providerLimit ?? prev?.providerLimit ?? this.policyFor(ticket.api).dailyLimit;
      const floor = headerFloor(ticket, outcome, nowMs, remainingAfter, limit);
      if (floor === undefined) return;
      // a resposta é posterior a todo envio com sent_at < agora: o header já conta essas chamadas (ou o
      // fornecedor ainda não as viu); as enviadas depois de agora entram por cima, como numa leitura do /status
      const baseline = prev
        ? prev.providerUsed + (await this.countSince(tx, ticket.api, ticket.dayUtc, prev.capturedAt))
        : 0;
      // o piso atual já cobre: não reescreve
      if (prev && floor <= baseline && limit === prev.providerLimit) return;
      await this.writeSnapshot(tx, ticket.api, ticket.dayUtc, {
        providerUsed: Math.max(baseline, floor),
        providerLimit: limit,
        capturedAt: new Date(nowMs),
      });
    });
  }

  async release(ticket: QuotaTicket): Promise<void> {
    await this.db
      .delete(quotaLedger)
      .where(and(eq(quotaLedger.id, ticket.id), eq(quotaLedger.outcome, 'pending')));
  }

  async reconcile(api: string, providerUsed: number, providerLimit: number, plan?: string): Promise<void> {
    const dayUtc = utcDayString(this.now());
    await this.db.transaction(async (tx) => {
      const prev = await this.lockedSnapshot(tx, api, dayUtc);
      // O contador do fornecedor é eventualmente consistente: uma leitura atrasada não pode "esquecer"
      // as chamadas feitas desde a leitura anterior. Incorporamos essas chamadas ao piso antes de avançar.
      const baseline = prev
        ? prev.providerUsed + (await this.countSince(tx, api, dayUtc, prev.capturedAt))
        : 0;
      await this.writeSnapshot(tx, api, dayUtc, {
        providerUsed: Math.max(baseline, providerUsed),
        providerLimit,
        plan: plan ?? null,
        capturedAt: this.now(),
      });
    });
  }

  /** Lê o piso do fornecedor do dia sob o lock do dia (o mesmo das reservas). */
  private async lockedSnapshot(
    tx: Pick<Database, 'select' | 'execute'>,
    api: string,
    dayUtc: string,
  ): Promise<{ providerUsed: number; providerLimit: number; capturedAt: Date } | undefined> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${PROVIDER}|${api}|${dayUtc}`}))`);
    const [prev] = await tx
      .select({
        providerUsed: quotaSnapshot.providerUsed,
        providerLimit: quotaSnapshot.providerLimit,
        capturedAt: quotaSnapshot.capturedAt,
      })
      .from(quotaSnapshot)
      .where(
        and(
          eq(quotaSnapshot.provider, PROVIDER),
          eq(quotaSnapshot.api, api),
          eq(quotaSnapshot.dayUtc, dayUtc),
        ),
      );
    return prev;
  }

  /** Grava o piso do dia. Sem `plan` (header de uma resposta), mantém o plano lido do /status. */
  private async writeSnapshot(
    tx: Pick<Database, 'insert'>,
    api: string,
    dayUtc: string,
    values: { providerUsed: number; providerLimit: number; capturedAt: Date; plan?: string | null },
  ): Promise<void> {
    await tx
      .insert(quotaSnapshot)
      .values({ provider: PROVIDER, api, dayUtc, ...values })
      .onConflictDoUpdate({
        target: [quotaSnapshot.provider, quotaSnapshot.api, quotaSnapshot.dayUtc],
        set: values,
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
    return buildReport(
      this.policyFor(api),
      api,
      dayUtc,
      await this.snapshot(this.db, api, dayUtc, this.now().getTime()),
    );
  }
}

/** Dias UTC que a janela [fromMs, toMs] cruza (a janela é sempre menor que um dia): um, ou dois na virada. */
function utcDaysBetween(fromMs: number, toMs: number): string[] {
  const from = utcDayString(new Date(fromMs));
  const to = utcDayString(new Date(toMs));
  return from === to ? [to] : [from, to];
}
