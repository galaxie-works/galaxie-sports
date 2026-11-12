/**
 * Chat ao vivo (Sala do Jogo, épico #915, #959), schema `chat`. Uma sala por jogo e por cliente: torcidas de clientes
 * diferentes nunca se misturam. O autor da mensagem é o Perfil da base (`fan.profile`, #937); nada de usuário próprio.
 *
 * - `room`: a sala, criada sob demanda no primeiro acesso ao jogo. O estado guardado é o que a equipe ou o sistema
 *   decidiu (`open`, `frozen`, `read_only_peak`); a janela de abertura e o fim (encerrada) saem do horário do jogo e
 *   da configuração, calculados na leitura (`@galaxie/engage`, `roomState`).
 * - `message`: o texto que passou pela base de regras (#969). `visibility` = `public` (entra no lote para todos),
 *   `shadow` (só o autor vê: abuso ou Silêncio oculto) ou `hidden` (tirada pela moderação). `purge_at` vem do relógio
 *   de conteúdo da ficha do país (#954).
 * - `tenant_config`: o padrão do cliente para as salas (janela, modo lento, rigor, tipos de lance), dentro do teto da
 *   Galaxie.
 * - `game_message`: o jogo dentro do chat (#965), uma linha por lance e por jogo, igual para todos os clientes.
 *
 * `tenant_id` abre a chave primária e todos os índices, e a mensagem aponta para a sala e para o Perfil por chave
 * composta: o banco recusa mensagem de um cliente numa sala de outro, mesmo com bug no código. O jogo
 * (`core.event`) fica sem chave estrangeira: o espelho reorganiza o que é dele.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared.js';
import { tenant } from './api.js';
import { fanProfile } from './fan.js';

export const chat = pgSchema('chat');

/** Estado gravado da sala. `closed` (encerrada) e `scheduled` (ainda fechada) não ficam aqui: saem do horário. */
export const CHAT_ROOM_STORED_STATES = ['open', 'frozen', 'read_only_peak'] as const;
export type ChatRoomStoredState = (typeof CHAT_ROOM_STORED_STATES)[number];

/** Rigor da sala: `strict` esconde também o palavrão leve (padrão em jogo de risco, clássico). */
export const CHAT_STRICTNESS = ['standard', 'strict'] as const;
export type ChatStrictness = (typeof CHAT_STRICTNESS)[number];

export const CHAT_MESSAGE_VISIBILITY = ['public', 'shadow', 'hidden'] as const;
export type ChatMessageVisibility = (typeof CHAT_MESSAGE_VISIBILITY)[number];

const inList = (col: string, list: readonly string[]) =>
  sql.raw(`${col} in (${list.map((v) => `'${v}'`).join(', ')})`);

const chatId = () =>
  uuid('id')
    .notNull()
    .default(sql`public.uuid_generate_v7()`);

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' });

export const chatRoom = chat.table(
  'room',
  {
    tenantId: tenantRef(),
    id: chatId(),
    /** `core.event.id`, sem chave estrangeira. */
    eventId: uuid('event_id').notNull(),
    state: text('state').$type<ChatRoomStoredState>().notNull().default('open'),
    /** Segundos entre mensagens do mesmo torcedor; null = padrão do cliente. 0 desliga. */
    slowModeSeconds: integer('slow_mode_seconds'),
    /** null = padrão do cliente. */
    strictness: text('strictness').$type<ChatStrictness>(),
    /** Quem mudou o estado por último: `tenant:<prefixo>`, `galaxie:<id>`, `system`. */
    stateBy: text('state_by'),
    stateAt: timestamp('state_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'room_pkey', columns: [t.tenantId, t.id] }),
    uniqueIndex('room_event_uq').on(t.tenantId, t.eventId),
    check('room_state', inList('state', CHAT_ROOM_STORED_STATES)),
    check('room_strictness', sql`${t.strictness} is null or ${inList('strictness', CHAT_STRICTNESS)}`),
    check('room_slow_mode', sql`${t.slowModeSeconds} is null or ${t.slowModeSeconds} between 0 and 600`),
  ],
);

export const chatMessage = chat.table(
  'message',
  {
    tenantId: tenantRef(),
    roomId: uuid('room_id').notNull(),
    id: chatId(),
    profileId: uuid('profile_id').notNull(),
    body: text('body').notNull(),
    visibility: text('visibility').$type<ChatMessageVisibility>().notNull().default('public'),
    /** Motivos do filtro (`ScreenReason`) e se foi para a Cosmos/fila humana; sem o texto de novo. */
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Relógio de conteúdo da ficha do país (#954): depois disso a mensagem é apagada. */
    purgeAt: timestamp('purge_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'message_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'message_room_fk',
      columns: [t.tenantId, t.roomId],
      foreignColumns: [chatRoom.tenantId, chatRoom.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'message_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    // últimas mensagens da sala (histórico ao entrar) e a última do torcedor (modo lento)
    index('message_room_idx').on(t.tenantId, t.roomId, t.id),
    index('message_author_idx').on(t.tenantId, t.roomId, t.profileId, t.createdAt),
    index('message_purge_idx').on(t.purgeAt),
    check('message_visibility', inList('visibility', CHAT_MESSAGE_VISIBILITY)),
    check('message_body_len', sql`length(${t.body}) between 1 and 2000`),
  ],
);

export const chatTenantConfig = chat.table(
  'tenant_config',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Minutos antes do início em que a sala abre; null = padrão da Galaxie. */
    openBeforeMinutes: integer('open_before_minutes'),
    /** Minutos depois do fim em que a sala fecha; null = padrão da Galaxie. */
    closeAfterMinutes: integer('close_after_minutes'),
    slowModeSeconds: integer('slow_mode_seconds'),
    strictness: text('strictness').$type<ChatStrictness>(),
    /** Tipos de mensagem do jogo nas salas (#965); null = todos. */
    eventKinds: text('event_kinds').array().$type<ChatGameKind[]>(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'tenant_config_open',
      sql`${t.openBeforeMinutes} is null or ${t.openBeforeMinutes} between 0 and 1440`,
    ),
    check(
      'tenant_config_close',
      sql`${t.closeAfterMinutes} is null or ${t.closeAfterMinutes} between 0 and 1440`,
    ),
    check('tenant_config_slow', sql`${t.slowModeSeconds} is null or ${t.slowModeSeconds} between 0 and 600`),
    check(
      'tenant_config_strictness',
      sql`${t.strictness} is null or ${inList('strictness', CHAT_STRICTNESS)}`,
    ),
  ],
);

/**
 * Tipos de mensagem do jogo dentro do chat (#965). O cliente escolhe quais entram nas salas dele
 * (`tenant_config.event_kinds`; null = todos).
 */
export const CHAT_GAME_KINDS = ['kickoff', 'goal', 'red_card', 'var', 'half_time', 'full_time'] as const;
export type ChatGameKind = (typeof CHAT_GAME_KINDS)[number];

/** O que a mensagem do jogo mostra; o texto nos três idiomas sai disto (`@galaxie/engage`, `chat-game.ts`). */
export interface ChatGameData {
  minute: number | null;
  extra: number | null;
  /** Detalhe do fornecedor (Normal Goal, Own Goal, Penalty, Red Card, Goal cancelled...). */
  detail: string | null;
  team: { id: string; name: string; crest_url: string | null } | null;
  player: string | null;
  score: { home: number; away: number } | null;
  /** Gol anulado pelo VAR: a mensagem do gol fica, marcada como anulada (não some sem rastro). */
  cancelled?: boolean;
  /** Vermelho por segundo amarelo. */
  secondYellow?: boolean;
}

/**
 * Mensagem do jogo (gol, cartão vermelho, VAR, início, intervalo, fim), uma por lance e por jogo, igual para todos os
 * clientes (não tem dado de torcedor). `source_key` é o lance de origem (`incident:<id>`, `status:<estado>`): duas
 * instâncias que recebem a mesma mudança gravam uma vez só. Não pode ser denunciada nem apagada por moderador; o
 * cliente só escolhe os tipos.
 */
export const chatGameMessage = chat.table(
  'game_message',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    /** `core.event.id`, sem chave estrangeira. */
    eventId: uuid('event_id').notNull(),
    sourceKey: text('source_key').notNull(),
    kind: text('kind').$type<ChatGameKind>().notNull(),
    data: jsonb('data').$type<ChatGameData>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('game_message_source_uq').on(t.eventId, t.sourceKey),
    index('game_message_event_idx').on(t.eventId, t.id),
    check('game_message_kind', inList('kind', CHAT_GAME_KINDS)),
  ],
);
