/**
 * Bastão entre líder e reserva (issue #536): o que o processo do ao vivo só guardava na memória e que muda a
 * decisão de chamar a api-sports. Sem isto a nova líder repetiria o tick que a antiga acabou de fazer e a
 * confirmação do resultado que ela já tentou. O resto (candidatos, retratos do diff, orçamento do dia) já vem
 * do Postgres. Fica em `ops.sync_cursor` (endpoint `live:scheduler`, chave `handoff`, uma linha por esporte)
 * e é gravado a cada tick, então vale também quando a líder morre sem aviso.
 */
import { and, eq } from 'drizzle-orm';
import { syncCursor, type Database } from '@galaxie/db';
import type { FinalizeAttempt } from './poller.js';
import { LIVE_STATE_ENDPOINT } from './state.js';

export const LIVE_HANDOFF_KEY = 'handoff';

export interface LiveHandoff {
  lastTickAt: string | null;
  backoffUntil: string | null;
  consecutiveFailures: number;
  /** Quando cada jogo foi visto no intervalo (`core.event.id`). */
  halftimeSeenAt: Record<string, string>;
  /** Tentativas de confirmar o resultado (ID do provedor). */
  finalizeAttempts: Record<string, FinalizeAttempt>;
}

export interface LiveHandoffStore {
  load(sport: string): Promise<LiveHandoff | null>;
  save(sport: string, handoff: LiveHandoff, at: Date): Promise<void>;
}

export class PgLiveHandoffStore implements LiveHandoffStore {
  constructor(
    private readonly db: Database,
    private readonly provider = 'api-sports',
  ) {}

  async load(sport: string): Promise<LiveHandoff | null> {
    const [row] = await this.db
      .select({ cursor: syncCursor.cursor })
      .from(syncCursor)
      .where(
        and(
          eq(syncCursor.provider, this.provider),
          eq(syncCursor.sport, sport),
          eq(syncCursor.endpoint, LIVE_STATE_ENDPOINT),
          eq(syncCursor.key, LIVE_HANDOFF_KEY),
        ),
      );
    return (row?.cursor as LiveHandoff | undefined) ?? null;
  }

  async save(sport: string, handoff: LiveHandoff, at: Date): Promise<void> {
    await this.db
      .insert(syncCursor)
      .values({
        provider: this.provider,
        sport,
        endpoint: LIVE_STATE_ENDPOINT,
        key: LIVE_HANDOFF_KEY,
        cursor: handoff,
        completedAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
        set: { cursor: handoff, completedAt: at, updatedAt: at },
      });
  }
}

export class InMemoryLiveHandoffStore implements LiveHandoffStore {
  readonly rows = new Map<string, LiveHandoff>();

  async load(sport: string): Promise<LiveHandoff | null> {
    return this.rows.get(sport) ?? null;
  }

  async save(sport: string, handoff: LiveHandoff): Promise<void> {
    // cópia, como o JSON do banco: a líder seguinte não enxerga o que a antiga ainda mexer na memória
    this.rows.set(sport, structuredClone(handoff));
  }
}
