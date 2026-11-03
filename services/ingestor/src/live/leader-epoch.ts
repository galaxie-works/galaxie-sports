/**
 * Época da liderança do ao vivo (issue #536): a cerca que vale no banco. O aviso de que a trava caiu (`onLost`) chega
 * pela conexão dela e pode atrasar: nesse meio-tempo a reserva já pode ter assumido. Por isso cada mandato pega uma
 * época nova ao receber a trava, e toda escrita do mandato roda numa transação que começa travando esta linha e
 * desiste se a época mudou. A sucessora só recebe a época depois que a transação em andamento termina; assim, ela lê
 * o que a antiga gravou, ou a antiga não grava nada. Fica em `ops.sync_cursor`, uma linha por esporte.
 */
import { and, eq, sql } from 'drizzle-orm';
import { syncCursor, type Database } from '@galaxie/db';
import { type Tx } from '@galaxie/core-writer';

export const LIVE_LEADER_EPOCH_ENDPOINT = 'live:leader_epoch';
const LIVE_LEADER_EPOCH_KEY = 'current';

/** O tick foi descartado sem gravar nada: esta cópia perdeu a liderança. */
export class TickFencedError extends Error {
  constructor() {
    super('tick descartado: esta cópia perdeu a liderança do ao vivo');
    this.name = 'TickFencedError';
  }
}

/** A época de um mandato: as escritas dele só valem enquanto ela for a atual. */
export interface LiveLeaderGuard {
  sport: string;
  epoch: number;
  provider?: string | undefined;
}

/** Abre o mandato: grava a época seguinte (espera a transação da líder anterior, se houver) e a devolve. */
export async function claimLiveLeaderEpoch(
  db: Database,
  sport: string,
  instance: string,
  provider = 'api-sports',
): Promise<number> {
  const now = new Date();
  const [row] = await db
    .insert(syncCursor)
    .values({
      provider,
      sport,
      endpoint: LIVE_LEADER_EPOCH_ENDPOINT,
      key: LIVE_LEADER_EPOCH_KEY,
      cursor: { epoch: 1, instance },
      completedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
      set: {
        cursor: sql`jsonb_build_object('epoch', coalesce((${syncCursor.cursor}->>'epoch')::bigint, 0) + 1, 'instance', ${instance}::text)`,
        completedAt: now,
        updatedAt: now,
      },
    })
    .returning({ cursor: syncCursor.cursor });
  return Number((row!.cursor as { epoch: number }).epoch);
}

/** Primeira coisa da transação de escrita: trava a linha da época e desiste se o mandato já passou. */
export async function assertLiveLeaderEpoch(tx: Tx, guard: LiveLeaderGuard): Promise<void> {
  const [row] = await tx
    .select({ cursor: syncCursor.cursor })
    .from(syncCursor)
    .where(
      and(
        eq(syncCursor.provider, guard.provider ?? 'api-sports'),
        eq(syncCursor.sport, guard.sport),
        eq(syncCursor.endpoint, LIVE_LEADER_EPOCH_ENDPOINT),
        eq(syncCursor.key, LIVE_LEADER_EPOCH_KEY),
      ),
    )
    .for('update');
  if (Number((row?.cursor as { epoch?: number } | null | undefined)?.epoch) !== guard.epoch)
    throw new TickFencedError();
}
