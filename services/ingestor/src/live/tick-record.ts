/**
 * Ritmo do ao vivo (issue #538): o que o runner grava para o `/metrics` do scheduler expor o intervalo entre ticks, a
 * idade do último tick e as pausas de propósito (meio-tempo, orçamento do dia, espera da fonte). Fica em
 * `ops.sync_cursor` (endpoint `live:scheduler`, chave `tick`, uma linha por esporte); o formato e a leitura são do
 * `@galaxie/observability` (`LiveTickCursor`). É gravado a cada tick e quando o ritmo muda, e a gravação passa pela
 * época do mandato (como o bastão): quem perdeu a liderança não pisa no registro da sucessora.
 *
 * O registro guarda o último tick de qualquer cópia, então o intervalo medido pela cópia que assume atravessa a troca
 * de líder ou de versão: é a prova de que a passagem não abriu buraco.
 */
import { and, eq } from 'drizzle-orm';
import { syncCursor, type Database } from '@galaxie/db';
import { LIVE_TICK_CURSOR_KEY, LIVE_TICK_RECENT_MS, type LiveTickCursor } from '@galaxie/observability';
import { assertLiveLeaderEpoch, type LiveLeaderGuard } from './leader-epoch.js';
import { LIVE_STATE_ENDPOINT } from './state.js';

/**
 * Intervalo maior que isto entre dois ticks não é ritmo: é outra janela (outro jogo, outro dia) ou uma queda longa,
 * que a idade do último tick e o `LiveEventStale` já mostram. Fica fora do `live_tick_interval_seconds`.
 */
export const MAX_COUNTED_GAP_MS = 30 * 60_000;

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface LivePace {
  /** `undefined` mantém o que já estava. */
  plannedIntervalSeconds?: number | null;
  /** Até quando o runner não espera tick de propósito; `null` = devia estar ticando no ritmo do plano. */
  pausedUntil: Date | null;
}

export function emptyLiveTick(instance: string, now: Date): LiveTickCursor {
  return {
    instance,
    updatedAt: now.toISOString(),
    lastTickAt: null,
    lastIntervalSeconds: null,
    recent: [],
    plannedIntervalSeconds: null,
    pausedUntil: null,
  };
}

/**
 * O tick de `now` aconteceu. O intervalo é medido desde o último tick registrado (de qualquer cópia) e só conta se
 * não houve pausa de propósito entre os dois (`pausedUntil` do registro anterior) nem passou de `MAX_COUNTED_GAP_MS`.
 */
export function recordLiveTick(
  prev: LiveTickCursor | null,
  now: Date,
  instance: string,
  plannedIntervalSeconds: number | null,
): LiveTickCursor {
  const base = prev ?? emptyLiveTick(instance, now);
  const prevMs = base.lastTickAt ? Date.parse(base.lastTickAt) : null;
  const gapMs = prevMs === null ? null : now.getTime() - prevMs;
  const counted = gapMs !== null && gapMs >= 0 && gapMs <= MAX_COUNTED_GAP_MS && base.pausedUntil === null;
  const seconds = counted ? round1(gapMs / 1000) : null;
  const keep = base.recent.filter((r) => now.getTime() - Date.parse(r.at) <= LIVE_TICK_RECENT_MS);
  return {
    instance,
    updatedAt: now.toISOString(),
    lastTickAt: now.toISOString(),
    lastIntervalSeconds: seconds,
    recent: seconds === null ? keep : [...keep, { at: now.toISOString(), seconds }],
    plannedIntervalSeconds:
      plannedIntervalSeconds === null ? base.plannedIntervalSeconds : round1(plannedIntervalSeconds),
    pausedUntil: null,
  };
}

/** O runner decidiu esperar (ou voltar a ticar): atualiza o intervalo planejado e a pausa, sem mexer no último tick. */
export function recordLivePace(
  prev: LiveTickCursor | null,
  pace: LivePace,
  now: Date,
  instance: string,
): LiveTickCursor {
  const base = prev ?? emptyLiveTick(instance, now);
  return {
    ...base,
    instance,
    updatedAt: now.toISOString(),
    plannedIntervalSeconds:
      pace.plannedIntervalSeconds === undefined
        ? base.plannedIntervalSeconds
        : pace.plannedIntervalSeconds === null
          ? null
          : round1(pace.plannedIntervalSeconds),
    pausedUntil: pace.pausedUntil?.toISOString() ?? null,
  };
}

/**
 * O que obriga a gravar fora de um tick: o último tick e a pausa. O intervalo planejado vai junto com o próximo tick
 * (regravar a cada ajuste dele custaria uma transação com a espera da troca de líder em andamento, e a reserva tem 2 s
 * para assumir).
 */
export function liveTickKey(tick: LiveTickCursor): string {
  return JSON.stringify([tick.lastTickAt, tick.pausedUntil]);
}

export interface LiveTickStore {
  load(sport: string): Promise<LiveTickCursor | null>;
  save(sport: string, tick: LiveTickCursor, at: Date): Promise<void>;
}

export class PgLiveTickStore implements LiveTickStore {
  constructor(
    private readonly db: Database,
    private readonly provider = 'api-sports',
    private readonly leaderEpoch?: LiveLeaderGuard,
  ) {}

  async load(sport: string): Promise<LiveTickCursor | null> {
    const [row] = await this.db
      .select({ cursor: syncCursor.cursor })
      .from(syncCursor)
      .where(
        and(
          eq(syncCursor.provider, this.provider),
          eq(syncCursor.sport, sport),
          eq(syncCursor.endpoint, LIVE_STATE_ENDPOINT),
          eq(syncCursor.key, LIVE_TICK_CURSOR_KEY),
        ),
      );
    return (row?.cursor as LiveTickCursor | undefined) ?? null;
  }

  async save(sport: string, tick: LiveTickCursor, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (this.leaderEpoch) await assertLiveLeaderEpoch(tx, this.leaderEpoch);
      await tx
        .insert(syncCursor)
        .values({
          provider: this.provider,
          sport,
          endpoint: LIVE_STATE_ENDPOINT,
          key: LIVE_TICK_CURSOR_KEY,
          cursor: tick,
          completedAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
          set: { cursor: tick, completedAt: at, updatedAt: at },
        });
    });
  }
}

export class InMemoryLiveTickStore implements LiveTickStore {
  readonly rows = new Map<string, LiveTickCursor>();

  async load(sport: string): Promise<LiveTickCursor | null> {
    const row = this.rows.get(sport);
    return row ? structuredClone(row) : null;
  }

  async save(sport: string, tick: LiveTickCursor): Promise<void> {
    this.rows.set(sport, structuredClone(tick));
  }
}
