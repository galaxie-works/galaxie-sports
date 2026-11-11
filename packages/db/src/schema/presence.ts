/**
 * Presença ao vivo verificada (#906, B9). Regras em `@galaxie/engage` (`presence.ts`).
 *
 * - `fan.presence_window`: cada trecho contínuo em que o Perfil acompanhou um jogo com a aba visível, gravado pelo
 *   relógio do servidor (o do aparelho nunca vale). Serve para "estava lá no minuto do gol" (conquistas, pontos
 *   de presença). Dado pessoal: fica no schema `fan` e sai com a exclusão do Perfil.
 * - `engage.presence_limit`: o limite de jogos ao mesmo tempo que o cliente escolheu (só abaixo do da Galaxie).
 *
 * A contagem de presentes por sala, para o chat e o painel, fica no Valkey.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared.js';
import { tenant } from './api.js';
import { engage } from './engage.js';
import { fan, fanProfile } from './fan.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const fanPresenceWindow = fan.table(
  'presence_window',
  {
    id: uuid('id')
      .notNull()
      .default(sql`public.uuid_generate_v7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').notNull(),
    /** Jogo (`core.event.id`). Sem FK: a presença não segura o jogo, e o jogo some antes do relógio da presença. */
    eventId: uuid('event_id').notNull(),
    startedAt: ts('started_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    /** Último toque do torcedor nesta janela (abrir a janela conta como toque). */
    lastInteractionAt: ts('last_interaction_at').notNull(),
    heartbeats: integer('heartbeats').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'presence_window_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'presence_window_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    index('presence_window_lookup_idx').on(t.tenantId, t.profileId, t.eventId, t.lastSeenAt),
    index('presence_window_open_idx').on(t.tenantId, t.profileId, t.lastSeenAt),
    index('presence_window_purge_idx').on(t.lastSeenAt),
    check('presence_window_order', sql`${t.lastSeenAt} >= ${t.startedAt}`),
    // a última interação pode ser de uma janela anterior do mesmo jogo (passa de uma janela para a outra)
    check('presence_window_interaction', sql`${t.lastInteractionAt} <= ${t.lastSeenAt}`),
    check('presence_window_heartbeats', sql`${t.heartbeats} >= 1`),
  ],
);

export const presenceLimit = engage.table(
  'presence_limit',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Jogos ao mesmo tempo por Perfil; vale só se for menor que o da Galaxie (`FAN_PRESENCE_MAX_GAMES`). */
    maxGames: smallint('max_games').notNull(),
    /** `panel:<id do usuário>` ou `galaxie:<id>`. */
    updatedBy: text('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('presence_limit_range', sql`${t.maxGames} between 1 and 10`)],
);
