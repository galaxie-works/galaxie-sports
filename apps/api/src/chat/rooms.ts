/**
 * Banco do Chat ao vivo (#959): salas por jogo e por cliente, configuração do cliente e mensagens. Toda consulta filtra
 * por `tenant_id`; a chave composta do schema garante o resto (mensagem de um cliente não entra em sala de outro).
 */
import {
  chatMessage,
  chatRoom,
  chatTenantConfig,
  event,
  fanProfile,
  tenant,
  type ChatMessageVisibility,
  type ChatRoomStoredState,
  type ChatStrictness,
  type Database,
} from '@galaxie/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

export interface ChatEventRow {
  id: string;
  startsAt: Date;
  endsAtExpected: Date;
  status: string;
  updatedAt: Date;
}

export async function readChatEvent(db: Database, eventId: string): Promise<ChatEventRow | null> {
  const [row] = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      endsAtExpected: event.endsAtExpected,
      status: event.status,
      updatedAt: event.updatedAt,
    })
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1);
  return row ?? null;
}

export interface ChatRoomRow {
  id: string;
  eventId: string;
  state: ChatRoomStoredState;
  slowModeSeconds: number | null;
  strictness: ChatStrictness | null;
}

const roomCols = {
  id: chatRoom.id,
  eventId: chatRoom.eventId,
  state: chatRoom.state,
  slowModeSeconds: chatRoom.slowModeSeconds,
  strictness: chatRoom.strictness,
};

/** A sala do jogo para o cliente, criada no primeiro acesso (duas instâncias ao mesmo tempo: a segunda lê a da primeira). */
export async function ensureRoom(db: Database, tenantId: string, eventId: string): Promise<ChatRoomRow> {
  const [created] = await db
    .insert(chatRoom)
    .values({ tenantId, eventId })
    .onConflictDoNothing({ target: [chatRoom.tenantId, chatRoom.eventId] })
    .returning(roomCols);
  if (created) return created;
  const [row] = await db
    .select(roomCols)
    .from(chatRoom)
    .where(and(eq(chatRoom.tenantId, tenantId), eq(chatRoom.eventId, eventId)))
    .limit(1);
  if (!row) throw new Error('sala do chat sumiu entre o insert e o select');
  return row;
}

export async function patchRoom(
  db: Database,
  tenantId: string,
  roomId: string,
  patch: {
    state?: ChatRoomStoredState | undefined;
    slowModeSeconds?: number | null | undefined;
    strictness?: ChatStrictness | null | undefined;
  },
  by: string,
): Promise<void> {
  const set: Partial<typeof chatRoom.$inferInsert> = {};
  if (patch.state !== undefined) Object.assign(set, { state: patch.state, stateBy: by, stateAt: new Date() });
  if (patch.slowModeSeconds !== undefined) set.slowModeSeconds = patch.slowModeSeconds;
  if (patch.strictness !== undefined) set.strictness = patch.strictness;
  if (!Object.keys(set).length) return;
  await db
    .update(chatRoom)
    .set(set)
    .where(and(eq(chatRoom.tenantId, tenantId), eq(chatRoom.id, roomId)));
}

export interface ChatTenantConfigRow {
  openBeforeMinutes: number | null;
  closeAfterMinutes: number | null;
  slowModeSeconds: number | null;
  strictness: ChatStrictness | null;
}

const EMPTY_CONFIG: ChatTenantConfigRow = {
  openBeforeMinutes: null,
  closeAfterMinutes: null,
  slowModeSeconds: null,
  strictness: null,
};

export async function readTenantConfig(db: Database, tenantId: string): Promise<ChatTenantConfigRow> {
  const [row] = await db
    .select({
      openBeforeMinutes: chatTenantConfig.openBeforeMinutes,
      closeAfterMinutes: chatTenantConfig.closeAfterMinutes,
      slowModeSeconds: chatTenantConfig.slowModeSeconds,
      strictness: chatTenantConfig.strictness,
    })
    .from(chatTenantConfig)
    .where(eq(chatTenantConfig.tenantId, tenantId))
    .limit(1);
  return row ?? EMPTY_CONFIG;
}

/** Grava os campos enviados (`null` volta ao padrão da Galaxie; ausente não muda). */
export async function writeTenantConfig(
  db: Database,
  tenantId: string,
  patch: { [K in keyof ChatTenantConfigRow]?: ChatTenantConfigRow[K] | undefined },
  by: string,
): Promise<void> {
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await db
    .insert(chatTenantConfig)
    .values({ tenantId, ...set, updatedBy: by })
    .onConflictDoUpdate({ target: chatTenantConfig.tenantId, set: { ...set, updatedBy: by } });
}

/** O cliente tem o módulo `live_chat` ligado e está ativo? (o token do torcedor não traz os módulos). */
export async function tenantHasLiveChat(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ ok: sql<boolean>`'live_chat' = any(${tenant.modules}) and ${tenant.status} = 'active'` })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1);
  return row?.ok === true;
}

export interface ChatMessageRow {
  id: string;
  body: string;
  profileId: string;
  nickname: string | null;
  avatarUrl: string | null;
  avatarVisibility: string | undefined;
  createdAt: Date;
}

/**
 * Últimas mensagens públicas da sala (e as retidas do próprio autor, quando há um), da mais antiga para a mais nova.
 * Perfil excluído some junto com as mensagens dele.
 */
export async function recentMessages(
  db: Database,
  tenantId: string,
  roomId: string,
  limit: number,
  viewerProfileId?: string,
): Promise<ChatMessageRow[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({
      id: chatMessage.id,
      body: chatMessage.body,
      profileId: chatMessage.profileId,
      nickname: fanProfile.nickname,
      avatarUrl: fanProfile.avatarUrl,
      avatarVisibility: sql<string | undefined>`${fanProfile.visibility}->>'avatar'`,
      createdAt: chatMessage.createdAt,
    })
    .from(chatMessage)
    .innerJoin(
      fanProfile,
      and(eq(fanProfile.tenantId, chatMessage.tenantId), eq(fanProfile.id, chatMessage.profileId)),
    )
    .where(
      and(
        eq(chatMessage.tenantId, tenantId),
        eq(chatMessage.roomId, roomId),
        isNull(fanProfile.deletedAt),
        viewerProfileId
          ? or(
              eq(chatMessage.visibility, 'public'),
              and(eq(chatMessage.visibility, 'shadow'), eq(chatMessage.profileId, viewerProfileId)),
            )
          : eq(chatMessage.visibility, 'public'),
      ),
    )
    .orderBy(desc(chatMessage.id))
    .limit(limit);
  return rows.reverse();
}

/** Quando o torcedor mandou a última mensagem na sala (modo lento). */
export async function lastSentAt(
  db: Database,
  tenantId: string,
  roomId: string,
  profileId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ at: chatMessage.createdAt })
    .from(chatMessage)
    .where(
      and(
        eq(chatMessage.tenantId, tenantId),
        eq(chatMessage.roomId, roomId),
        eq(chatMessage.profileId, profileId),
        inArray(chatMessage.visibility, ['public', 'shadow']),
      ),
    )
    .orderBy(desc(chatMessage.createdAt))
    .limit(1);
  return row?.at ?? null;
}

export async function insertMessage(
  db: Database,
  input: {
    tenantId: string;
    roomId: string;
    profileId: string;
    body: string;
    visibility: ChatMessageVisibility;
    flags: string[];
    purgeAt: Date;
  },
): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db
    .insert(chatMessage)
    .values(input)
    .returning({ id: chatMessage.id, createdAt: chatMessage.createdAt });
  return row!;
}
