/**
 * Presença ao vivo verificada (#906, B9): janelas de presença por jogo, pelo relógio do banco. As regras (quando o
 * sinal conta, o limite de jogos) chegam de `@galaxie/engage` como valores e funções: este pacote não depende de
 * outro `@galaxie/*`. A contagem de presentes por sala fica no Valkey, na API.
 */
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { fanPresenceWindow, presenceLimit } from './schema/presence.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

export type PresenceVerdict = 'counted' | 'hidden' | 'interaction_needed';

export type HeartbeatResult =
  | { counted: true; startedAt: Date; lastInteractionAt: Date; at: Date; opened: boolean }
  | { counted: false; reason: 'hidden' | 'interaction_needed' | 'too_many_games'; at: Date };

/**
 * Sinal de presença do torcedor. Estende a janela aberta do jogo (último sinal há menos de `gapMs`) ou abre outra;
 * abrir só vale se o Perfil não estiver em `maxGames` outros jogos ao mesmo tempo. O instante é o do banco.
 */
export async function recordHeartbeat(
  db: Database,
  input: {
    tenantId: string;
    profileId: string;
    eventId: string;
    visible: boolean;
    interacted: boolean;
    rules: {
      gapMs: number;
      maxGames: number;
      verdict: (v: {
        visible: boolean;
        interacted: boolean;
        lastInteractionAt: number | null;
        windowStartedAt: number | null;
        now: number;
      }) => PresenceVerdict;
    };
  },
): Promise<HeartbeatResult> {
  return db.transaction(async (tx) => {
    // um sinal por Perfil de cada vez: a contagem de jogos abertos vale com pedidos em paralelo
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`fan.presence:${input.tenantId}:${input.profileId}`}, 0))`,
    );
    // relógio de depois do lock (o now() é o do começo da transação, e um sinal que esperou o lock voltaria no tempo)
    const [clock] = await tx.execute<{ now: string }>(sql`select clock_timestamp()::text as now`);
    const at = new Date(clock!.now);
    const since = new Date(at.getTime() - input.rules.gapMs);
    const [open] = await tx
      .select()
      .from(fanPresenceWindow)
      .where(
        and(
          eq(fanPresenceWindow.tenantId, input.tenantId),
          eq(fanPresenceWindow.profileId, input.profileId),
          eq(fanPresenceWindow.eventId, input.eventId),
          gte(fanPresenceWindow.lastSeenAt, since),
        ),
      )
      .orderBy(desc(fanPresenceWindow.lastSeenAt))
      .limit(1);
    // a última interação no jogo, de qualquer janela: abrir janela nova não zera o relógio
    const [last] = open
      ? [open]
      : await tx
          .select({ lastInteractionAt: fanPresenceWindow.lastInteractionAt })
          .from(fanPresenceWindow)
          .where(
            and(
              eq(fanPresenceWindow.tenantId, input.tenantId),
              eq(fanPresenceWindow.profileId, input.profileId),
              eq(fanPresenceWindow.eventId, input.eventId),
            ),
          )
          .orderBy(desc(fanPresenceWindow.lastInteractionAt))
          .limit(1);
    const verdict = input.rules.verdict({
      visible: input.visible,
      interacted: input.interacted,
      lastInteractionAt: last?.lastInteractionAt.getTime() ?? null,
      windowStartedAt: open?.startedAt.getTime() ?? null,
      now: at.getTime(),
    });
    if (verdict !== 'counted') return { counted: false, reason: verdict, at };
    if (open) {
      const lastInteractionAt = input.interacted ? at : open.lastInteractionAt;
      await tx
        .update(fanPresenceWindow)
        .set({
          lastSeenAt: sql`greatest(${fanPresenceWindow.lastSeenAt}, ${at.toISOString()}::timestamptz)`,
          lastInteractionAt: sql`greatest(${fanPresenceWindow.lastInteractionAt}, ${lastInteractionAt.toISOString()}::timestamptz)`,
          heartbeats: sql`${fanPresenceWindow.heartbeats} + 1`,
        })
        .where(and(eq(fanPresenceWindow.tenantId, input.tenantId), eq(fanPresenceWindow.id, open.id)));
      return { counted: true, startedAt: open.startedAt, lastInteractionAt, at, opened: false };
    }
    const [{ games } = { games: 0 }] = await tx
      .select({ games: sql<number>`count(distinct ${fanPresenceWindow.eventId})::int` })
      .from(fanPresenceWindow)
      .where(
        and(
          eq(fanPresenceWindow.tenantId, input.tenantId),
          eq(fanPresenceWindow.profileId, input.profileId),
          ne(fanPresenceWindow.eventId, input.eventId),
          gte(fanPresenceWindow.lastSeenAt, since),
        ),
      );
    if (games >= input.rules.maxGames) return { counted: false, reason: 'too_many_games', at };
    const lastInteractionAt =
      input.interacted || !last ? at : new Date(Math.min(last.lastInteractionAt.getTime(), at.getTime()));
    await tx.insert(fanPresenceWindow).values({
      tenantId: input.tenantId,
      profileId: input.profileId,
      eventId: input.eventId,
      startedAt: at,
      lastSeenAt: at,
      lastInteractionAt,
    });
    return { counted: true, startedAt: at, lastInteractionAt, at, opened: true };
  });
}

/** Janelas do Perfil no jogo, da mais antiga à mais recente. */
export async function presenceWindows(
  db: Executor,
  input: { tenantId: string; profileId: string; eventId: string },
): Promise<Array<{ startedAt: Date; lastSeenAt: Date; heartbeats: number }>> {
  return db
    .select({
      startedAt: fanPresenceWindow.startedAt,
      lastSeenAt: fanPresenceWindow.lastSeenAt,
      heartbeats: fanPresenceWindow.heartbeats,
    })
    .from(fanPresenceWindow)
    .where(
      and(
        eq(fanPresenceWindow.tenantId, input.tenantId),
        eq(fanPresenceWindow.profileId, input.profileId),
        eq(fanPresenceWindow.eventId, input.eventId),
      ),
    )
    .orderBy(fanPresenceWindow.startedAt);
}

/**
 * Estava presente no jogo no instante `at` (o do evento, pelo relógio do servidor)? A janela tem de ter começado
 * antes e durado até ele, com a folga de um intervalo de sinal (`slackMs`). Quem abriu depois não ganha.
 */
export async function wasPresentAt(
  db: Executor,
  input: { tenantId: string; profileId: string; eventId: string; at: Date; slackMs: number },
): Promise<boolean> {
  const [row] = await db
    .select({ id: fanPresenceWindow.id })
    .from(fanPresenceWindow)
    .where(
      and(
        eq(fanPresenceWindow.tenantId, input.tenantId),
        eq(fanPresenceWindow.profileId, input.profileId),
        eq(fanPresenceWindow.eventId, input.eventId),
        sql`${fanPresenceWindow.startedAt} <= ${input.at.toISOString()}::timestamptz`,
        sql`${fanPresenceWindow.lastSeenAt} >= ${new Date(input.at.getTime() - input.slackMs).toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Limite de jogos ao mesmo tempo que o cliente escolheu (null = o da Galaxie). */
export async function readPresenceLimit(db: Executor, tenantId: string): Promise<number | null> {
  const [row] = await db
    .select({ maxGames: presenceLimit.maxGames })
    .from(presenceLimit)
    .where(eq(presenceLimit.tenantId, tenantId));
  return row?.maxGames ?? null;
}

/** Grava (ou tira, com null) o limite do cliente. Quem chama confere que fica abaixo do da Galaxie. */
export async function writePresenceLimit(
  db: Executor,
  input: { tenantId: string; maxGames: number | null; updatedBy: string },
): Promise<void> {
  if (input.maxGames === null) {
    await db.delete(presenceLimit).where(eq(presenceLimit.tenantId, input.tenantId));
    return;
  }
  await db
    .insert(presenceLimit)
    .values({ tenantId: input.tenantId, maxGames: input.maxGames, updatedBy: input.updatedBy })
    .onConflictDoUpdate({
      target: presenceLimit.tenantId,
      set: { maxGames: input.maxGames, updatedBy: input.updatedBy, updatedAt: sql`now()` },
    });
}

/** Exclusão do torcedor: as janelas dele saem na hora (na transação da exclusão). */
export async function erasePresence(tx: Executor, tenantId: string, profileId: string): Promise<void> {
  await tx
    .delete(fanPresenceWindow)
    .where(and(eq(fanPresenceWindow.tenantId, tenantId), eq(fanPresenceWindow.profileId, profileId)));
}

/** Retenção: apaga as janelas que terminaram antes de `before` (a API roda de hora em hora, em lotes). */
export async function purgePresence(db: Database, before: Date, batchSize = 5000): Promise<number> {
  let total = 0;
  for (;;) {
    // uma transação curta por lote; com várias réplicas da API, só uma apaga de cada vez
    const deleted = await db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended('fan.presence:purge', 0)) as ok`,
      );
      if (!lock?.ok) return 0;
      const rows = await tx
        .delete(fanPresenceWindow)
        .where(
          sql`(${fanPresenceWindow.tenantId}, ${fanPresenceWindow.id}) in (select tenant_id, id from fan.presence_window where last_seen_at < ${before.toISOString()}::timestamptz limit ${batchSize})`,
        )
        .returning({ id: fanPresenceWindow.id });
      return rows.length;
    });
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
