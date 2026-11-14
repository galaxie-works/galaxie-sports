/**
 * O jogo dentro do chat (#965): ouve o tempo real (`ChangeStream`) e mantém as mensagens de sistema do jogo (gol,
 * cartão vermelho, VAR, início, intervalo, fim) em dia com a linha do tempo.
 *
 * - **Reconciliação, não reação ao lance:** a cada mudança do jogo (lance novo, placar, estado), relê a linha do
 *   tempo inteira e calcula as mensagens que ela pede (`desiredGameMessages`, chave semântica: time, jogador,
 *   minuto). Grava só o que mudou: `INSERT ... ON CONFLICT DO UPDATE ... WHERE data IS DISTINCT FROM` com `RETURNING`,
 *   então entre várias instâncias só quem efetivamente mudou a linha publica no lote do jogo (`game:<jogo>`). Gol
 *   que entrou por UPDATE no fornecedor (sem lance novo) aparece na mudança de placar seguinte.
 * - **Fila por jogo:** mudanças do mesmo jogo são processadas uma de cada vez (a que chega durante uma rodada só pede
 *   outra rodada).
 * - **Portão:** só cria mensagem com o jogo ao vivo (ou no intervalo) e quando algum cliente tem o `live_chat`; jogo
 *   encerrado só atualiza o que já existe (e ganha o "fim de jogo" se foi acompanhado ao vivo). Detalhe que chega
 *   horas depois do fim não despeja gols antigos no chat.
 * - **VAR:** gol anulado continua, marcado como anulado; o gol que volta (o VAR inferido some) deixa de estar anulado.
 *
 * As mensagens do jogo são iguais para todos os clientes e não têm dado de torcedor; cada stream filtra pelos tipos
 * que o cliente ligou.
 */
import type { RealtimeChange } from '@galaxie/contracts';
import {
  chatGameMessage,
  event,
  eventIncident,
  eventParticipant,
  person,
  tenant,
  type ChatGameData,
  type ChatGameKind,
  type Database,
} from '@galaxie/db';
import { desiredGameMessages, gameText, statusSignal, type GameText } from '@galaxie/engage';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { assetUrl } from '../util.js';
import type { ChatHub } from './hub.js';

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

interface Row {
  id: string;
  kind: ChatGameKind;
  sourceKey: string;
  data: ChatGameData;
  createdAt: Date;
  updatedAt: Date;
}

export function gameView(row: Omit<Row, 'sourceKey'>): GameMessageView {
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
  sourceKey: chatGameMessage.sourceKey,
  data: chatGameMessage.data,
  createdAt: chatGameMessage.createdAt,
  updatedAt: chatGameMessage.updatedAt,
};

/** Mensagens do jogo, da mais antiga para a mais nova (as `limit` mais recentes). */
export async function gameMessages(db: Database, eventId: string, limit = 100): Promise<GameMessageView[]> {
  const rows = await db
    .select(cols)
    .from(chatGameMessage)
    .where(eq(chatGameMessage.eventId, eventId))
    .orderBy(desc(chatGameMessage.id))
    .limit(limit);
  return rows.reverse().map(gameView);
}

const TOPICS = new Set(['event.incident_added', 'event.score_changed', 'event.status_changed']);
const LIVE = new Set(['live', 'break']);
const NAME_TTL_MS = 10 * 60_000;

export class ChatGameFeed {
  private readonly running = new Map<string, { pending: boolean }>();
  private enabledAt = 0;
  private enabled = false;
  private readonly names = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly db: Database,
    private readonly hub: ChatHub,
    private readonly options: {
      assetsBaseUrl?: string | undefined;
      logger?: { warn(obj: object, msg?: string): void };
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Ouvinte do `ChangeStream`: nunca lança (falha vira log). */
  handle = (change: RealtimeChange): void => {
    if (!TOPICS.has(change.topic)) return;
    const previousStatus =
      change.topic === 'event.status_changed' && typeof change.previous?.status === 'string'
        ? change.previous.status
        : null;
    const status =
      change.topic === 'event.status_changed' ? (change.data.status as string | undefined) : undefined;
    const signal = status ? statusSignal(status, previousStatus) : null;
    void this.schedule(change.event_id, signal).catch((err: unknown) =>
      this.options.logger?.warn({ err, event: change.event_id }, 'chat: mensagens do jogo falharam'),
    );
  };

  /** Uma rodada por jogo de cada vez; mudança que chega durante a rodada pede outra (o sinal de estado não se perde). */
  private readonly signals = new Map<string, ReturnType<typeof statusSignal>[]>();
  private async schedule(eventId: string, signal: ReturnType<typeof statusSignal>): Promise<void> {
    if (signal) this.signals.set(eventId, [...(this.signals.get(eventId) ?? []), signal]);
    const run = this.running.get(eventId);
    if (run) {
      run.pending = true;
      return;
    }
    const state = { pending: true };
    this.running.set(eventId, state);
    try {
      while (state.pending) {
        state.pending = false;
        const pending = this.signals.get(eventId) ?? [];
        this.signals.delete(eventId);
        await this.reconcile(eventId, pending);
      }
    } finally {
      this.running.delete(eventId);
    }
  }

  /** Algum cliente ativo tem o `live_chat`? (relido a cada minuto). */
  private async anyLiveChat(): Promise<boolean> {
    if (this.now() - this.enabledAt < 60_000) return this.enabled;
    const [row] = await this.db
      .select({ ok: sql<boolean>`true` })
      .from(tenant)
      .where(and(sql`'live_chat' = any(${tenant.modules})`, eq(tenant.status, 'active')))
      .limit(1);
    this.enabled = !!row;
    this.enabledAt = this.now();
    return this.enabled;
  }

  async reconcile(eventId: string, signals: ReturnType<typeof statusSignal>[] = []): Promise<void> {
    if (!(await this.anyLiveChat())) return;
    const [ev] = await this.db
      .select({ status: event.status, score: event.score, startsAt: event.startsAt })
      .from(event)
      .where(eq(event.id, eventId))
      .limit(1);
    if (!ev) return;
    const existing = await this.db
      .select(cols)
      .from(chatGameMessage)
      .where(eq(chatGameMessage.eventId, eventId));
    const live = LIVE.has(ev.status);
    // encerrado e nunca acompanhado ao vivo (detalhe que chegou depois): nada de despejar o jogo inteiro no chat
    if (!live && !existing.length) return;
    const create = live || existing.length > 0;
    const eventScore =
      ev.score && typeof ev.score.home === 'number'
        ? { home: ev.score.home, away: ev.score.away ?? 0 }
        : null;

    const [incidents, participants] = await Promise.all([
      this.db
        .select({
          sequence: eventIncident.sequence,
          minute: eventIncident.minute,
          extra: eventIncident.extra,
          type: eventIncident.type,
          detail: eventIncident.detail,
          participantId: eventIncident.participantId,
          personId: eventIncident.personId,
          comments: sql<string | null>`${eventIncident.data}->>'comments'`,
        })
        .from(eventIncident)
        .where(eq(eventIncident.eventId, eventId))
        .orderBy(asc(eventIncident.sequence)),
      this.db
        .select({ participantId: eventParticipant.participantId, side: eventParticipant.side })
        .from(eventParticipant)
        .where(and(eq(eventParticipant.eventId, eventId), inArray(eventParticipant.side, ['home', 'away']))),
    ]);
    const sides = new Map(participants.map((p) => [p.participantId, p.side as 'home' | 'away']));
    const storedGoals = existing
      .filter((r) => r.kind === 'goal')
      .map((r) => ({
        key: r.sourceKey,
        participantId: r.data.team?.id ?? null,
        minute: r.data.minute,
        extra: r.data.extra,
        cancelled: r.data.cancelled === true,
      }));
    const desired = desiredGameMessages(
      incidents.map((i) => ({
        ...i,
        shootout: (i.comments ?? '').trim().toLowerCase() === 'penalty shootout',
      })),
      sides,
      storedGoals,
    );

    const writes: { key: string; kind: ChatGameKind; data: ChatGameData }[] = [];
    for (const d of desired) {
      const prev = existing.find((r) => r.sourceKey === d.key);
      writes.push({
        key: d.key,
        kind: d.kind,
        data: {
          minute: d.minute,
          extra: d.extra,
          detail: d.detail ?? prev?.data.detail ?? null,
          team: await this.team(d.participantId),
          player: d.personId ? await this.player(d.personId) : (prev?.data.player ?? null),
          score: d.score,
          ...(d.cancelled ? { cancelled: true } : {}),
          ...(d.secondYellow ? { secondYellow: true } : {}),
        },
      });
    }
    const base: ChatGameData = {
      minute: null,
      extra: null,
      detail: null,
      team: null,
      player: null,
      score: null,
    };
    let breaks = existing.filter((r) => r.kind === 'half_time').length;
    for (const s of signals) {
      if (!s) continue;
      if (s.kind === 'half_time') {
        const n = ++breaks;
        writes.push({ key: `status:break:${n}`, kind: 'half_time', data: { ...base, score: eventScore } });
      } else
        writes.push({
          key: s.key,
          kind: s.kind,
          data: { ...base, score: s.kind === 'full_time' ? eventScore : null },
        });
    }
    // fim de jogo acompanha correções do placar depois do apito
    const ft = existing.find((r) => r.kind === 'full_time');
    if (ft && !writes.some((w) => w.key === ft.sourceKey))
      writes.push({ key: ft.sourceKey, kind: 'full_time', data: { ...ft.data, score: eventScore } });

    for (const w of writes) {
      const exists = existing.some((r) => r.sourceKey === w.key);
      if (!exists && !create) continue;
      const [row] = await this.db
        .insert(chatGameMessage)
        .values({ eventId, sourceKey: w.key, kind: w.kind, data: w.data })
        .onConflictDoUpdate({
          target: [chatGameMessage.eventId, chatGameMessage.sourceKey],
          set: { data: sql`excluded.data`, updatedAt: sql`now()` },
          setWhere: sql`${chatGameMessage.data} is distinct from excluded.data`,
        })
        .returning(cols);
      // nada mudou (ou outra instância já gravou igual): não publica de novo
      if (!row) continue;
      await this.hub.enqueue(gameRoomKey(eventId), gameView(row)).catch((err: unknown) => {
        this.options.logger?.warn({ err, event: eventId }, 'chat: lote do jogo indisponível');
      });
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.names.get(key);
    if (hit && this.now() - hit.at < NAME_TTL_MS) return hit.value as T;
    const value = await load();
    if (this.names.size > 5_000) this.names.clear();
    this.names.set(key, { at: this.now(), value });
    return value;
  }

  private team(id: string | null): Promise<ChatGameData['team']> {
    if (!id) return Promise.resolve(null);
    return this.cached(`t:${id}`, async () => {
      const rows = await this.db.execute<{
        id: string;
        name: string;
        key: string | null;
        url: string | null;
      }>(sql`
        select p.id, coalesce(p.short_name, p.name) as name, a.storage_key as key, a.source_url as url
          from core.participant p
          left join core.asset a on a.id = coalesce(p.custom_logo_asset_id, p.logo_asset_id)
         where p.id = ${id}
         limit 1`);
      const r = rows[0];
      return r
        ? { id: r.id, name: r.name, crest_url: assetUrl(this.options.assetsBaseUrl, r.key, r.url) }
        : null;
    });
  }

  private player(id: string): Promise<string | null> {
    return this.cached(`p:${id}`, async () => {
      const [r] = await this.db.select({ name: person.name }).from(person).where(eq(person.id, id)).limit(1);
      return r?.name ?? null;
    });
  }
}
