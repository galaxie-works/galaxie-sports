/**
 * Dados do painel do Chat ao vivo do cliente (#973), só no servidor: as salas do tenant, as mensagens de uma sala (as
 * públicas, as retidas e as que a moderação tirou do ar) e o padrão do cliente para as salas. O tenant vem sempre da
 * sessão; do torcedor só o apelido e o id opaco do Perfil (nunca o id do cliente, e-mail ou documento).
 */
import { pool } from '@/lib/auth/db';

export interface ChatRoomRow {
  roomId: string;
  fixtureId: string;
  state: 'open' | 'frozen' | 'read_only_peak';
  slowModeSeconds: number | null;
  strictness: 'standard' | 'strict' | null;
  startsAt: string;
  eventStatus: string;
  home: string | null;
  away: string | null;
  messages24h: number;
  held: number;
}

/** Salas do tenant com jogo nas últimas 36 h ou nas próximas 24 h, do jogo mais próximo de agora para o mais longe. */
export async function loadChatRooms(tenantId: string): Promise<ChatRoomRow[]> {
  const { rows } = await pool.query<{
    room_id: string;
    fixture_id: string;
    state: ChatRoomRow['state'];
    slow_mode_seconds: number | null;
    strictness: ChatRoomRow['strictness'];
    starts_at: Date;
    status: string;
    home: string | null;
    away: string | null;
    messages_24h: string;
    held: string;
  }>(
    `select r.id as room_id, r.event_id as fixture_id, r.state, r.slow_mode_seconds, r.strictness,
            e.starts_at, e.status::text as status,
            (select coalesce(p.short_name, p.name) from core.event_participant ep
               join core.participant p on p.id = ep.participant_id
              where ep.event_id = e.id and ep.side = 'home' limit 1) as home,
            (select coalesce(p.short_name, p.name) from core.event_participant ep
               join core.participant p on p.id = ep.participant_id
              where ep.event_id = e.id and ep.side = 'away' limit 1) as away,
            (select count(*) from chat.message m
              where m.tenant_id = r.tenant_id and m.room_id = r.id
                and m.created_at > now() - interval '24 hours') as messages_24h,
            (select count(*) from chat.message m
              where m.tenant_id = r.tenant_id and m.room_id = r.id and m.visibility = 'shadow') as held
       from chat.room r
       join core.event e on e.id = r.event_id
      where r.tenant_id = $1
        and e.starts_at between now() - interval '36 hours' and now() + interval '24 hours'
      order by abs(extract(epoch from (e.starts_at - now()))) asc
      limit 100`,
    [tenantId],
  );
  return rows.map((r) => ({
    roomId: r.room_id,
    fixtureId: r.fixture_id,
    state: r.state,
    slowModeSeconds: r.slow_mode_seconds,
    strictness: r.strictness,
    startsAt: r.starts_at.toISOString(),
    eventStatus: r.status,
    home: r.home,
    away: r.away,
    messages24h: Number(r.messages_24h),
    held: Number(r.held),
  }));
}

/** A sala de um jogo do tenant (null se ninguém escreveu nem ajustou a sala ainda). */
export async function loadChatRoom(tenantId: string, fixtureId: string): Promise<ChatRoomRow | null> {
  const rooms = await pool.query<{ room_id: string }>(
    `select id as room_id from chat.room where tenant_id = $1 and event_id = $2 limit 1`,
    [tenantId, fixtureId],
  );
  if (!rooms.rows[0]) return null;
  const all = await loadChatRooms(tenantId);
  const hit = all.find((r) => r.roomId === rooms.rows[0]!.room_id);
  if (hit) return hit;
  // fora da janela da lista (jogo antigo aberto pelo link): lê só a sala
  const { rows } = await pool.query<{
    state: ChatRoomRow['state'];
    slow_mode_seconds: number | null;
    strictness: ChatRoomRow['strictness'];
    starts_at: Date;
    status: string;
  }>(
    `select r.state, r.slow_mode_seconds, r.strictness, e.starts_at, e.status::text as status
       from chat.room r join core.event e on e.id = r.event_id
      where r.tenant_id = $1 and r.id = $2`,
    [tenantId, rooms.rows[0].room_id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    roomId: rooms.rows[0].room_id,
    fixtureId,
    state: r.state,
    slowModeSeconds: r.slow_mode_seconds,
    strictness: r.strictness,
    startsAt: r.starts_at.toISOString(),
    eventStatus: r.status,
    home: null,
    away: null,
    messages24h: 0,
    held: 0,
  };
}

export interface PanelMessage {
  id: string;
  body: string;
  profileId: string;
  nickname: string | null;
  visibility: 'public' | 'shadow' | 'hidden';
  flags: string[];
  createdAt: string;
}

/** Últimas mensagens da sala (todas as visibilidades), da mais antiga para a mais nova. Perfil excluído não aparece. */
export async function loadRoomMessages(
  tenantId: string,
  roomId: string,
  limit = 100,
): Promise<PanelMessage[]> {
  const { rows } = await pool.query<{
    id: string;
    body: string;
    profile_id: string;
    nickname: string | null;
    visibility: PanelMessage['visibility'];
    flags: string[];
    created_at: Date;
  }>(
    `select m.id, m.body, m.profile_id, p.nickname, m.visibility, m.flags, m.created_at
       from chat.message m
       join fan.profile p on p.tenant_id = m.tenant_id and p.id = m.profile_id
      where m.tenant_id = $1 and m.room_id = $2 and p.deleted_at is null
      order by m.id desc
      limit $3`,
    [tenantId, roomId, limit],
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    body: r.body,
    profileId: r.profile_id,
    nickname: r.nickname,
    visibility: r.visibility,
    flags: r.flags,
    createdAt: r.created_at.toISOString(),
  }));
}

export interface ChatTenantSettings {
  openBeforeMinutes: number | null;
  closeAfterMinutes: number | null;
  slowModeSeconds: number | null;
  strictness: 'standard' | 'strict' | null;
  eventKinds: string[] | null;
}

export async function loadChatSettings(tenantId: string): Promise<ChatTenantSettings> {
  const { rows } = await pool.query<{
    open_before_minutes: number | null;
    close_after_minutes: number | null;
    slow_mode_seconds: number | null;
    strictness: ChatTenantSettings['strictness'];
    event_kinds: string[] | null;
  }>(
    `select open_before_minutes, close_after_minutes, slow_mode_seconds, strictness, event_kinds
       from chat.tenant_config where tenant_id = $1`,
    [tenantId],
  );
  const r = rows[0];
  return {
    openBeforeMinutes: r?.open_before_minutes ?? null,
    closeAfterMinutes: r?.close_after_minutes ?? null,
    slowModeSeconds: r?.slow_mode_seconds ?? null,
    strictness: r?.strictness ?? null,
    eventKinds: r?.event_kinds ?? null,
  };
}

/** O Perfil escreveu na sala do tenant? (o servidor só pune quem está na sala da ação). */
export async function profileInRoom(tenantId: string, roomId: string, profileId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from chat.message where tenant_id = $1 and room_id = $2 and profile_id = $3 limit 1`,
    [tenantId, roomId, profileId],
  );
  return rows.length > 0;
}
