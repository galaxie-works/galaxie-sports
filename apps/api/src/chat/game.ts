/**
 * O jogo dentro do chat (#965): ouve o tempo real (`ChangeStream`) e transforma gol, cartão vermelho, VAR, início,
 * intervalo e fim em mensagens de sistema da sala. Toda instância recebe a mesma mudança; a mensagem é gravada uma vez
 * só (`chat.game_message`, único por jogo e lance) e só a instância que gravou põe no lote do jogo (`game:<jogo>`).
 * Gol anulado pelo VAR: a mensagem do gol é marcada como anulada (e sai de novo no lote), não some.
 *
 * As mensagens do jogo são iguais para todos os clientes; cada stream filtra pelos tipos que o cliente ligou.
 */
import type { RealtimeChange } from '@galaxie/contracts';
import {
  chatGameMessage,
  event,
  participant,
  person,
  type ChatGameData,
  type ChatGameKind,
  type Database,
} from '@galaxie/db';
import { gameSignals, gameText, type GameText } from '@galaxie/engage';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { assetUrl } from '../util.js';
import { ChatHub } from './hub.js';

/** Mensagem do jogo como sai para o widget. */
export interface GameMessageView {
  id: string;
  kind: ChatGameKind;
  minute: number | null;
  extra: number | null;
  team: ChatGameData['team'];
  player: string | null;
  score: ChatGameData['score'];
  cancelled: boolean;
  text: GameText;
  created_at: string;
  updated_at: string;
}

export const gameRoomKey = (fixtureId: string) => `game:${fixtureId}`;

export function gameView(row: {
  id: string;
  kind: ChatGameKind;
  data: ChatGameData;
  createdAt: Date;
  updatedAt: Date;
}): GameMessageView {
  const d = row.data;
  return {
    id: row.id,
    kind: row.kind,
    minute: d.minute,
    extra: d.extra,
    team: d.team,
    player: d.player,
    score: d.score,
    cancelled: d.cancelled === true,
    text: gameText({ kind: row.kind, ...d }),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

const cols = {
  id: chatGameMessage.id,
  kind: chatGameMessage.kind,
  data: chatGameMessage.data,
  createdAt: chatGameMessage.createdAt,
  updatedAt: chatGameMessage.updatedAt,
};

/** Mensagens do jogo, da mais antiga para a mais nova (no máximo `limit`, as mais recentes). */
export async function gameMessages(db: Database, eventId: string, limit = 100): Promise<GameMessageView[]> {
  const rows = await db
    .select(cols)
    .from(chatGameMessage)
    .where(eq(chatGameMessage.eventId, eventId))
    .orderBy(desc(chatGameMessage.id))
    .limit(limit);
  return rows.reverse().map(gameView);
}

export class ChatGameFeed {
  constructor(
    private readonly db: Database,
    private readonly hub: ChatHub,
    private readonly options: {
      assetsBaseUrl?: string | undefined;
      logger?: { warn(obj: object, msg?: string): void };
    } = {},
  ) {}

  /** Ouvinte do `ChangeStream`: nunca lança (falha vira log). */
  handle = (change: RealtimeChange): void => {
    if (change.topic !== 'event.incident_added' && change.topic !== 'event.status_changed') return;
    const signals = gameSignals(change);
    if (!signals.length) return;
    void this.apply(change.event_id, signals).catch((err: unknown) =>
      this.options.logger?.warn({ err, event: change.event_id }, 'chat: mensagem do jogo falhou'),
    );
  };

  private async apply(eventId: string, signals: ReturnType<typeof gameSignals>): Promise<void> {
    const [ev] = await this.db
      .select({ score: event.score })
      .from(event)
      .where(eq(event.id, eventId))
      .limit(1);
    if (!ev) return;
    const score =
      ev.score && typeof ev.score.home === 'number'
        ? { home: ev.score.home, away: ev.score.away ?? 0 }
        : null;
    for (const s of signals) {
      const base: ChatGameData = { minute: null, extra: null, detail: null, team: null, player: null, score };
      const data: ChatGameData =
        'incident' in s
          ? {
              ...base,
              minute: s.incident.minute,
              extra: s.incident.extra,
              detail: s.incident.detail,
              team: await this.team(s.incident.participantId),
              player: await this.player(s.incident.personId),
              // o placar do cartão e do VAR não interessa; o do gol é o depois do gol
              score: s.kind === 'goal' ? score : null,
            }
          : base;
      const [created] = await this.db
        .insert(chatGameMessage)
        .values({ eventId, sourceKey: s.sourceKey, kind: s.kind, data })
        .onConflictDoNothing({ target: [chatGameMessage.eventId, chatGameMessage.sourceKey] })
        .returning(cols);
      // outra instância já gravou este lance: ela põe no lote
      if (!created) continue;
      await this.publish(eventId, created);
      if ('cancelsGoal' in s && s.cancelsGoal) await this.cancelGoal(eventId, s.incident.participantId);
    }
  }

  /** Marca o último gol ainda válido do time (ou do jogo) como anulado; só uma instância consegue (UPDATE ... RETURNING). */
  private async cancelGoal(eventId: string, participantId: string | null): Promise<void> {
    const [target] = await this.db
      .select({ id: chatGameMessage.id })
      .from(chatGameMessage)
      .where(
        and(
          eq(chatGameMessage.eventId, eventId),
          eq(chatGameMessage.kind, 'goal'),
          sql`coalesce((${chatGameMessage.data}->>'cancelled')::boolean, false) = false`,
          participantId ? sql`${chatGameMessage.data}->'team'->>'id' = ${participantId}` : undefined,
        ),
      )
      .orderBy(desc(chatGameMessage.id))
      .limit(1);
    if (!target) return;
    const [updated] = await this.db
      .update(chatGameMessage)
      .set({ data: sql`${chatGameMessage.data} || '{"cancelled": true}'::jsonb` })
      .where(
        and(
          eq(chatGameMessage.id, target.id),
          sql`coalesce((${chatGameMessage.data}->>'cancelled')::boolean, false) = false`,
        ),
      )
      .returning(cols);
    if (updated) await this.publish(eventId, updated);
  }

  private async publish(eventId: string, row: Parameters<typeof gameView>[0]): Promise<void> {
    await this.hub.enqueue(gameRoomKey(eventId), gameView(row));
  }

  private async team(id: string | null): Promise<ChatGameData['team']> {
    if (!id) return null;
    const rows = await this.db.execute<{
      id: string;
      name: string;
      key: string | null;
      url: string | null;
    }>(sql`
      select p.id, coalesce(p.short_name, p.name) as name, a.storage_key as key, a.source_url as url
        from ${participant} p
        left join core.asset a on a.id = coalesce(p.custom_logo_asset_id, p.logo_asset_id)
       where p.id = ${id}
       limit 1`);
    const r = rows[0];
    return r
      ? { id: r.id, name: r.name, crest_url: assetUrl(this.options.assetsBaseUrl, r.key, r.url) }
      : null;
  }

  private async player(id: string | null): Promise<string | null> {
    if (!id) return null;
    const [r] = await this.db.select({ name: person.name }).from(person).where(eq(person.id, id)).limit(1);
    return r?.name ?? null;
  }
}

/** Para os testes e o GET: mensagens do jogo em ordem de criação. */
export async function allGameMessages(db: Database, eventId: string): Promise<GameMessageView[]> {
  const rows = await db
    .select(cols)
    .from(chatGameMessage)
    .where(eq(chatGameMessage.eventId, eventId))
    .orderBy(asc(chatGameMessage.id));
  return rows.map(gameView);
}
