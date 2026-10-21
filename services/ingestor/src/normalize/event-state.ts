/**
 * Persistência da máquina de estados do evento (docs/04 §3.1): carrega o estado atual de
 * `core.event`, aplica a lógica pura de `@galaxie/providers` e grava o novo estado e as transições
 * em `core.event_state_log`.
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { EVENT_STATUSES as DB_EVENT_STATUSES, event, eventStateLog, type Database } from '@galaxie/db';
import {
  applyObservation,
  STARTING_WINDOW_MS,
  tick,
  type EventState,
  type EventStatus,
  type FailureReason,
  type MachineOptions,
  type StatusSource,
  type Transition,
} from '@galaxie/providers';
import { chunks, resolveIds, type Executor, type ProviderScope } from './sql-helpers.js';

// O enum do banco e o da lógica pura precisam ser idênticos.
type DbStatus = (typeof DB_EVENT_STATUSES)[number];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const STATUS_ENUMS_MATCH: Same<DbStatus, EventStatus> = true;

export type EventRow = typeof event.$inferSelect;

export function stateFromRow(row: EventRow): EventState {
  return {
    status: row.status,
    statusDetail: row.statusDetail,
    statusSource: (row.statusSource === 'temporal' ? 'temporal' : 'provider') as StatusSource,
    clock: row.clock ?? null,
    score: row.score ?? null,
    startsAt: row.startsAt,
    endsAtExpected: row.endsAtExpected,
    lastValidAt: row.lastValidAt,
    isStale: row.isStale,
  };
}

/** Campos de `core.event` que vêm do estado. */
export function stateColumns(s: EventState) {
  return {
    status: s.status,
    statusDetail: s.statusDetail,
    statusSource: s.statusSource,
    clock: s.clock,
    score: s.score,
    startsAt: s.startsAt,
    endsAtExpected: s.endsAtExpected,
    lastValidAt: s.lastValidAt,
    isStale: s.isStale,
  };
}

export function logRows(eventId: string, transitions: Transition[], provider: string | null) {
  return transitions.map((t) => ({
    eventId,
    fromStatus: t.from,
    toStatus: t.to,
    reason: t.reason,
    payload: { provider, statusDetail: t.statusDetail },
    occurredAt: t.at,
  }));
}

export async function insertLogs(db: Executor, rows: (typeof eventStateLog.$inferInsert)[]): Promise<void> {
  for (const chunk of chunks(rows, 1000)) if (chunk.length) await db.insert(eventStateLog).values(chunk);
}

async function updateStates(
  db: Executor,
  changes: { id: string; state: EventState; transitions: Transition[] }[],
  provider: string | null,
): Promise<void> {
  for (const c of changes)
    await db
      .update(event)
      .set({ ...stateColumns(c.state), updatedAt: new Date() })
      .where(eq(event.id, c.id));
  await insertLogs(
    db,
    changes.flatMap((c) => logRows(c.id, c.transitions, provider)),
  );
}

export interface FailureInput extends ProviderScope {
  /** IDs do provedor dos eventos que a consulta deveria ter trazido. */
  providerEventIds: string[];
  at: Date;
  reason: FailureReason;
}

/**
 * A fonte falhou (4xx/5xx), veio vazia ou não trouxe os eventos pedidos: mantém o último estado
 * válido, marca `is_stale` e deixa o relógio avançar. Devolve quantos eventos mudaram.
 */
export async function applyProviderFailure(
  db: Database,
  input: FailureInput,
  options: MachineOptions = {},
): Promise<{ changed: number; transitions: number }> {
  return db.transaction(async (tx) => {
    const ids = [...(await resolveIds(tx, input, 'event', input.providerEventIds)).values()];
    if (!ids.length) return { changed: 0, transitions: 0 };
    const rows = await tx.select().from(event).where(inArray(event.id, ids)).for('update');
    const changes = [];
    for (const row of rows) {
      const step = applyObservation(
        stateFromRow(row),
        { kind: 'failure', observedAt: input.at, reason: input.reason },
        options,
      );
      if (step.changed) changes.push({ id: row.id, state: step.state, transitions: step.transitions });
    }
    await updateStates(tx, changes, null);
    return { changed: changes.length, transitions: changes.reduce((n, c) => n + c.transitions.length, 0) };
  });
}

const CLOCK_STATUSES: EventStatus[] = ['scheduled', 'starting', 'live', 'break'];

/**
 * Relógio dos eventos (regras 2 e 3 de docs/04 §3.1): `scheduled → starting` em T-10, e — sem dado
 * fresco da fonte — `starting → live` no apito e `live → finished` em `ends_at_expected`.
 * Roda periodicamente (ex.: a cada minuto) e é idempotente para o mesmo `now`.
 */
export async function advanceEventClock(
  db: Database,
  now: Date,
  options: MachineOptions & { sport?: string } = {},
): Promise<{ examined: number; changed: number; transitions: number }> {
  const horizon = new Date(now.getTime() + STARTING_WINDOW_MS);
  const conditions = [inArray(event.status, CLOCK_STATUSES), lte(event.startsAt, horizon)];
  if (options.sport) conditions.push(eq(event.sport, options.sport));
  const candidates = await db
    .select({ id: event.id })
    .from(event)
    .where(and(...conditions));

  let changed = 0;
  let transitions = 0;
  for (const chunk of chunks(
    candidates.map((c) => c.id),
    500,
  )) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(event)
        .where(and(inArray(event.id, chunk), inArray(event.status, CLOCK_STATUSES)))
        .for('update');
      const changes = [];
      for (const row of rows) {
        const step = tick(stateFromRow(row), now, options);
        if (step.changed) changes.push({ id: row.id, state: step.state, transitions: step.transitions });
      }
      await updateStates(tx, changes, null);
      changed += changes.length;
      transitions += changes.reduce((n, c) => n + c.transitions.length, 0);
    });
  }
  return { examined: candidates.length, changed, transitions };
}

/** Conta transições por motivo (relatórios e testes). */
export async function transitionsByReason(db: Executor): Promise<Record<string, number>> {
  const rows = await db
    .select({ reason: eventStateLog.reason, n: sql<number>`count(*)::int` })
    .from(eventStateLog)
    .groupBy(eventStateLog.reason);
  return Object.fromEntries(rows.map((r) => [r.reason, r.n]));
}
