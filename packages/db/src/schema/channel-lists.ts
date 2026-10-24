import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared.js';
import { api, tenant } from './api.js';

/**
 * exato · feed_generico (pan-regional, sem o feed do país) · nome_divergente (mesma marca, outro
 * sufixo) · sem_canal_na_lista. Praça e afiliada não são modeladas: a geolocalização é da operadora.
 */
export const CHANNEL_MATCH_KINDS = [
  'exato',
  'feed_generico',
  'nome_divergente',
  'sem_canal_na_lista',
] as const;
export type ChannelMatchKind = (typeof CHANNEL_MATCH_KINDS)[number];

export const CHANNEL_LIST_STATUSES = ['review', 'confirmed'] as const;
export type ChannelListStatus = (typeof CHANNEL_LIST_STATUSES)[number];

/** not_needed = sem sobras · pending = sobras esperando a IA · done · failed (tenta de novo no próximo job). */
export const CHANNEL_LIST_AI_STATUSES = ['not_needed', 'pending', 'done', 'failed'] as const;
export type ChannelListAiStatus = (typeof CHANNEL_LIST_AI_STATUSES)[number];

/** Canal da lista do cliente: só o nome (e o `group-title` do M3U). Nunca URL nem EPG. */
export interface StoredClientChannel {
  idx: number;
  name: string;
  group: string | null;
}

/** Casamento de um direito (emissora × país) com os canais da lista. */
export interface StoredChannelMatch {
  country: string;
  broadcasterId: string;
  name: string;
  access: 'linear' | 'streaming';
  match: ChannelMatchKind;
  channels: number[];
  origin: 'codigo' | 'ia' | 'cliente';
  note: string | null;
}

/** Correção do cliente num direito: os canais (chave normalizada do nome); [] = nenhum. */
export interface StoredChannelOverride {
  country: string;
  broadcasterId: string;
  channelKeys: string[];
}

/** O que a API serve: a lista e os casamentos no momento da confirmação. */
export interface ConfirmedChannelList {
  channels: StoredClientChannel[];
  matches: StoredChannelMatch[];
}

/**
 * Lista de canais do cliente (uma por tenant) casada com os direitos de transmissão (docs/07
 * §2.2.3). `proposed` é o casamento atual (código, IA validada e correções do cliente), revisado no
 * portal; `confirmed` é o que a API serve no onde assistir (`client_channels`) até a próxima confirmação.
 */
export const tenantChannelList = api.table('tenant_channel_list', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  source: text('source').$type<'m3u' | 'text'>().notNull(),
  /** País dos canais sem país no nome nem no grupo (opcional). */
  defaultCountry: text('default_country'),
  /** Países dos direitos considerados (mercados do tenant no processamento). */
  markets: text('markets').array().notNull(),
  channels: jsonb('channels').$type<StoredClientChannel[]>().notNull(),
  proposed: jsonb('proposed').$type<StoredChannelMatch[]>().notNull(),
  overrides: jsonb('overrides').$type<StoredChannelOverride[]>().notNull().default([]),
  confirmed: jsonb('confirmed').$type<ConfirmedChannelList>(),
  status: text('status').$type<ChannelListStatus>().notNull().default('review'),
  aiStatus: text('ai_status').$type<ChannelListAiStatus>().notNull().default('not_needed'),
  /** Resumo da última passada da IA (violações do validador, erro). */
  aiNote: text('ai_note'),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: text('uploaded_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  confirmedBy: text('confirmed_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
