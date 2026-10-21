/**
 * Agendamento do onde assistir (issue #50): janelas T-7d, T-24h (busca completa), T-3h e T-30min
 * (revalidação das URLs salvas; busca de novo só se algo mudou ou faltar opção). Tier 1 desde T-7d,
 * tier 2 desde T-24h. Cada (evento, país, janela) vira um registro idempotente em enrich.wtw_run
 * (`run_key` único) — reexecutar o planejamento não duplica nada.
 */
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { competition, event, wtwRun, type Database, type WtwWindow } from '@galaxie/db';
import type { WtwConfig } from '@galaxie/where-to-watch';

export interface WindowSpec {
  window: Exclude<WtwWindow, 'manual'>;
  offsetMs: number;
  mode: 'full' | 'revalidate';
  tiers: number[];
}

const H = 3_600_000;

/** Da mais distante para a mais próxima do início. */
export const WTW_WINDOWS: WindowSpec[] = [
  { window: 'T-7d', offsetMs: 7 * 24 * H, mode: 'full', tiers: [1] },
  { window: 'T-24h', offsetMs: 24 * H, mode: 'full', tiers: [1, 2] },
  { window: 'T-3h', offsetMs: 3 * H, mode: 'revalidate', tiers: [1, 2] },
  { window: 'T-30min', offsetMs: 0.5 * H, mode: 'revalidate', tiers: [1, 2] },
];

/**
 * Janela vigente: a mais próxima do início que já abriu (`now ≥ início − offset`) e se aplica ao
 * tier. Janelas anteriores perdidas não são recuperadas — a vigente cobre (e, sem opções salvas,
 * a revalidação vira busca completa).
 */
export function dueWindow(startsAt: Date, now: Date, tier: number): WindowSpec | null {
  if (now.getTime() >= startsAt.getTime()) return null;
  let due: WindowSpec | null = null;
  for (const w of WTW_WINDOWS) {
    if (!w.tiers.includes(tier)) continue;
    if (now.getTime() >= startsAt.getTime() - w.offsetMs) due = w;
  }
  return due;
}

export const runKeyOf = (eventId: string, country: string, window: string) =>
  `${eventId}:${country}:${window}`;

export interface DueRun {
  runKey: string;
  eventId: string;
  country: string;
  window: WindowSpec['window'];
  mode: WindowSpec['mode'];
  startsAt: Date;
  tier: number;
  competition: string | null;
}

export interface PlanOptions {
  now: Date;
  markets: string[];
  config: WtwConfig;
  eventId?: string;
  /** Horizonte de busca de eventos (padrão 7 dias + folga). */
  horizonMs?: number;
}

/**
 * O mercado se importa com o jogo? Há linha na tabela de direitos, a competição é do próprio país
 * ou é internacional (WORLD/sem país).
 */
export function marketRelevant(
  config: WtwConfig,
  country: string,
  comp: { slug: string; countryCode: string | null },
  startsAt: Date,
): boolean {
  if (!config.has(country)) return false;
  if (!comp.countryCode || comp.countryCode === 'WORLD' || comp.countryCode === country) return true;
  return config.directory(country).rightsFor(comp.slug, startsAt) !== null;
}

/** Execuções devidas agora e ainda não registradas. */
export async function planDueRuns(db: Database, opts: PlanOptions): Promise<DueRun[]> {
  const horizon = opts.horizonMs ?? 7 * 24 * H + 5 * 60_000;
  const conds = [
    gt(event.startsAt, opts.now),
    lte(event.startsAt, new Date(opts.now.getTime() + horizon)),
    inArray(event.status, ['scheduled', 'starting']),
    lte(competition.tier, 2),
  ];
  if (opts.eventId) conds.push(eq(event.id, opts.eventId));
  const events = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      tier: competition.tier,
      slug: competition.slug,
      countryCode: competition.countryCode,
    })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(and(...conds))
    .orderBy(asc(event.startsAt));

  const due: DueRun[] = [];
  for (const e of events) {
    const w = dueWindow(e.startsAt, opts.now, e.tier);
    if (!w) continue;
    for (const country of opts.markets) {
      if (!marketRelevant(opts.config, country, e, e.startsAt)) continue;
      due.push({
        runKey: runKeyOf(e.id, country, w.window),
        eventId: e.id,
        country,
        window: w.window,
        mode: w.mode,
        startsAt: e.startsAt,
        tier: e.tier,
        competition: e.slug,
      });
    }
  }
  if (!due.length) return due;
  const existing = await db
    .select({ runKey: wtwRun.runKey })
    .from(wtwRun)
    .where(
      inArray(
        wtwRun.runKey,
        due.map((d) => d.runKey),
      ),
    );
  const done = new Set(existing.map((r) => r.runKey));
  return due.filter((d) => !done.has(d.runKey));
}

/** Registra as execuções devidas (idempotente: `run_key` único). Retorna quantas entraram. */
export async function enqueueRuns(db: Database, due: DueRun[], now: Date): Promise<number> {
  if (!due.length) return 0;
  const rows = await db
    .insert(wtwRun)
    .values(
      due.map((d) => ({
        runKey: d.runKey,
        eventId: d.eventId,
        countryCode: d.country,
        window: d.window,
        mode: d.mode,
        status: 'queued',
        requestedBy: 'scheduler',
        scheduledFor: now,
      })),
    )
    .onConflictDoNothing({ target: wtwRun.runKey })
    .returning({ id: wtwRun.id });
  return rows.length;
}

export type WtwRunRow = typeof wtwRun.$inferSelect;

/**
 * Reserva execuções enfileiradas (status queued → running) com `FOR UPDATE SKIP LOCKED`:
 * vários workers podem rodar em paralelo sem pegar a mesma execução.
 */
export async function claimRuns(
  db: Database,
  opts: { now: Date; limit: number; eventId?: string; country?: string },
): Promise<WtwRunRow[]> {
  const filters = [sql`status = 'queued'`, sql`scheduled_for <= ${opts.now.toISOString()}::timestamptz`];
  if (opts.eventId) filters.push(sql`event_id = ${opts.eventId}`);
  if (opts.country) filters.push(sql`country_code = ${opts.country}`);
  const ids = await db.execute<{ id: string }>(sql`
    select id from enrich.wtw_run
     where ${sql.join(filters, sql` and `)}
     order by scheduled_for, created_at
     limit ${opts.limit}
     for update skip locked`);
  if (!ids.length) return [];
  return db
    .update(wtwRun)
    .set({ status: 'running', startedAt: opts.now })
    .where(
      and(
        inArray(
          wtwRun.id,
          ids.map((r) => r.id),
        ),
        eq(wtwRun.status, 'queued'),
      ),
    )
    .returning();
}

/** Execuções que ficaram `running` por mais de `staleMs` (worker caiu) voltam para a fila. */
export async function requeueStale(db: Database, now: Date, staleMs = 30 * 60_000): Promise<number> {
  const rows = await db
    .update(wtwRun)
    .set({ status: 'queued', startedAt: null })
    .where(and(eq(wtwRun.status, 'running'), lte(wtwRun.startedAt, new Date(now.getTime() - staleMs))))
    .returning({ id: wtwRun.id });
  return rows.length;
}
