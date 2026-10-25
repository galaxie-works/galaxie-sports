/**
 * Estado publicado pelo processo do ao vivo em `ops.sync_cursor` (endpoint `live:scheduler`, chave `state`, uma
 * linha por esporte na coluna `sport`):
 * o intervalo dinâmico, o orçamento e as janelas do dia. As métricas (`galaxie_live_poll_interval_seconds`)
 * e o `live:run --plan` leem daqui — sem métricas em memória, vale com qualquer número de processos.
 */
import { and, eq, lt } from 'drizzle-orm';
import { syncCursor, type Database } from '@galaxie/db';
import { RECONCILE_CURSOR_ENDPOINT } from './reconcile.js';
import { windowEnd } from './schedule.js';
import type { LiveDayPlan } from './types.js';

export const LIVE_STATE_ENDPOINT = 'live:scheduler';

export interface LiveSchedulerState {
  sport: string;
  day: string;
  updatedAt: string;
  /** Intervalo médio planejado (s); `null` sem orçamento ou sem janela. */
  intervalSeconds: number | null;
  /** Intervalo de um minuto de peso 1 (s). */
  baseIntervalSeconds: number | null;
  windowMinutes: number;
  liveBudget: number;
  liveUsed: number;
  ticksLeft: number;
  featured: boolean;
  included: number;
  relevant: number;
  excludedByBudget: number;
  segments: { start: string; end: string; leagues: string[] }[];
  /** Jogos em janela agora. */
  activeEvents: number;
}

const secs = (ms: number) => (Number.isFinite(ms) ? Math.round(ms / 100) / 10 : null);

export function liveStateFromPlan(plan: LiveDayPlan, now: Date): LiveSchedulerState {
  return {
    sport: plan.sport,
    day: plan.day,
    updatedAt: now.toISOString(),
    intervalSeconds: plan.included.length ? secs(plan.nominalIntervalMs) : null,
    baseIntervalSeconds: plan.included.length ? secs(plan.baseIntervalMs) : null,
    windowMinutes: plan.windowMinutes,
    liveBudget: plan.budget.liveTotal,
    liveUsed: plan.budget.liveUsed,
    ticksLeft: plan.budget.ticksLeft,
    featured: plan.featured,
    included: plan.included.length,
    relevant: plan.relevant,
    excludedByBudget: plan.excluded.filter((e) => e.reason === 'budget').length,
    segments: plan.segments.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      leagues: s.leagues,
    })),
    activeEvents: plan.included.filter((i) => i.window.start <= now && now < windowEnd(i.window)).length,
  };
}

/** Grava o estado (upsert); `completed_at` marca o instante da última atualização. */
export async function saveLiveState(
  db: Database,
  state: LiveSchedulerState,
  provider = 'api-sports',
): Promise<void> {
  const now = new Date(state.updatedAt);
  await db
    .insert(syncCursor)
    .values({
      provider,
      sport: state.sport,
      endpoint: LIVE_STATE_ENDPOINT,
      key: 'state',
      cursor: state,
      completedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
      set: { cursor: state, completedAt: now, updatedAt: now },
    });
}

/** Último estado gravado pelo processo do ao vivo (`null` = nunca rodou para o esporte). */
export async function loadLiveState(
  db: Database,
  sport: string,
  provider = 'api-sports',
): Promise<LiveSchedulerState | null> {
  const [row] = await db
    .select({ cursor: syncCursor.cursor })
    .from(syncCursor)
    .where(
      and(
        eq(syncCursor.provider, provider),
        eq(syncCursor.sport, sport),
        eq(syncCursor.endpoint, LIVE_STATE_ENDPOINT),
        eq(syncCursor.key, 'state'),
      ),
    );
  return (row?.cursor as LiveSchedulerState | undefined) ?? null;
}

/**
 * Retenção dos cursores da reconciliação (`live:reconcile`: tentativas por jogo e último lote por data):
 * só servem enquanto o jogo está na janela de horas da reconciliação. Devolve quantos apagou.
 */
export async function pruneReconcileCursors(
  db: Database,
  before: Date,
  provider = 'api-sports',
): Promise<number> {
  const rows = await db
    .delete(syncCursor)
    .where(
      and(
        eq(syncCursor.provider, provider),
        eq(syncCursor.endpoint, RECONCILE_CURSOR_ENDPOINT),
        lt(syncCursor.updatedAt, before),
      ),
    )
    .returning({ key: syncCursor.key });
  return rows.length;
}
