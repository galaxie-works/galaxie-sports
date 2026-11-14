/**
 * Shopping (épico #909, catálogo do #914), no schema `engage`: o vínculo curado pela Galaxie entre uma entidade da
 * página (time, seleção, campeonato, atleta, piloto) e os produtos oficiais dela em cada loja de afiliado.
 *
 * - `shop_store`: as lojas da Galaxie, uma por país (a mesma rede em dois países são duas lojas). Ligar a loja e as
 *   credenciais ficam com os conectores (#916);
 * - `shop_entity`: a ficha de uma entidade no Shopping (marca fornecedora e temporada do uniforme);
 * - `shop_entity_store`: por loja, o jeito de achar os produtos da entidade (vendedor oficial, página do time…);
 * - `shop_product`: os produtos âncora (6 a 12 por entidade), com loja, id do produto na loja, tipo, temporada,
 *   ordem e se está ativo. Sugestão da IA entra como `suggested` e só aparece depois de aprovada por uma pessoa.
 *
 * Nada de imagem nem preço aqui (regra do épico): os dois vêm do conector da loja, com cache de no máximo 24 h.
 * A entidade não tem chave estrangeira para o `core`, como o time do coração (`fan.ts`): o espelho reorganiza o que é
 * dele e a curadoria não pode sumir junto.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  integer,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { engage } from './engage.js';

/** De onde vem a entidade: `core.participant` (time, seleção, atleta, piloto), `core.competition` ou `core.person`. */
export const SHOP_ENTITY_KINDS = ['competition', 'participant', 'person'] as const;
export type ShopEntityKind = (typeof SHOP_ENTITY_KINDS)[number];

/** Rede de afiliado da loja; decide o conector (#916). */
export const SHOP_NETWORKS = ['amazon', 'awin', 'direct', 'impact', 'mercado_livre'] as const;
export type ShopNetwork = (typeof SHOP_NETWORKS)[number];

/** Como achar os produtos da entidade na loja. */
export const SHOP_LOOKUP_KINDS = [
  'category',
  'official_seller',
  'product_list',
  'team_page',
  'team_slug',
] as const;
export type ShopLookupKind = (typeof SHOP_LOOKUP_KINDS)[number];

export const SHOP_PRODUCT_TYPES = [
  'away_kit',
  'ball',
  'cap',
  'champion',
  'commemorative',
  'home_kit',
  'jacket',
  'mug',
  'other',
  'scarf',
  'third_kit',
  'training',
] as const;
export type ShopProductType = (typeof SHOP_PRODUCT_TYPES)[number];

/** `suggested`: veio da IA e espera uma pessoa; `rejected` fica para a IA não sugerir de novo. */
export const SHOP_PRODUCT_STATUSES = ['approved', 'rejected', 'suggested'] as const;
export type ShopProductStatus = (typeof SHOP_PRODUCT_STATUSES)[number];

const inList = (col: string, list: readonly string[]) =>
  sql.raw(`${col} in (${list.map((v) => `'${v}'`).join(', ')})`);

export const shopStore = engage.table(
  'shop_store',
  {
    /** Identificador curto e estável (`loja_br`), usado no link de clique e no relatório. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** ISO 3166-1 alfa-2. */
    country: text('country').notNull(),
    network: text('network').notNull(),
    homeUrl: text('home_url'),
    /** Liga e desliga sem deploy (#916). Loja nova nasce desligada. */
    active: boolean('active').notNull().default(false),
    /** Ordem sugerida pela Galaxie dentro do país; o cliente reordena a dele. */
    position: integer('position').notNull().default(0),
    /**
     * Conectores (#916): a matriz loja × caminho, os caminhos que o widget do cliente pode usar nesta loja
     * (`subnetwork`: repasse pela Galaxie, com clickref do cliente; `client_code`: código do próprio cliente).
     */
    clientPaths: text('client_paths')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Configuração não secreta na rede (id do anunciante na Awin, modelo do link de rastreio do programa). */
    config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
    /**
     * Credenciais da conta da Galaxie na loja, em JSON cifrado pelo cofre do painel (`SETTINGS_KEK`, AAD
     * `SHOP_STORE_<ID>`): só gravação pela tela; a leitura é dos serviços.
     */
    credentialsSealed: text('credentials_sealed'),
    /** Últimos caracteres do código de afiliado, para a tela reconhecer qual está gravado. */
    credentialsHint: text('credentials_hint'),
    credentialsUpdatedAt: timestamp('credentials_updated_at', { withTimezone: true }),
    credentialsUpdatedBy: text('credentials_updated_by'),
    updatedBy: text('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('shop_store_country_idx').on(t.country, t.position),
    check('shop_store_id_format', sql`${t.id} ~ '^[a-z0-9_]{2,40}$'`),
    check('shop_store_name_len', sql`length(${t.name}) between 2 and 60`),
    check('shop_store_country_format', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('shop_store_network', inList('network', SHOP_NETWORKS)),
    check('shop_store_home_https', sql`${t.homeUrl} is null or ${t.homeUrl} ~ '^https://'`),
    check('shop_store_client_paths', sql`${t.clientPaths} <@ array['client_code', 'subnetwork']::text[]`),
    check(
      'shop_store_credentials_sealed',
      sql`${t.credentialsSealed} is null or ${t.credentialsSealed} like 'enc:%'`,
    ),
  ],
);

export const shopEntity = engage.table(
  'shop_entity',
  {
    id: pkUuidV7(),
    entityKind: text('entity_kind').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** Marca fornecedora do uniforme e temporada dele (ex.: `2026` ou `2025/26`). */
    kitBrand: text('kit_brand'),
    kitSeason: text('kit_season'),
    /** Temporada em que a curadoria foi revista pela última vez. */
    reviewedSeason: text('reviewed_season'),
    version: integer('version').notNull().default(1),
    updatedBy: text('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shop_entity_ref_uq').on(t.entityKind, t.entityId),
    check('shop_entity_kind', inList('entity_kind', SHOP_ENTITY_KINDS)),
    check('shop_entity_kit_brand_len', sql`${t.kitBrand} is null or length(${t.kitBrand}) between 2 and 40`),
    check(
      'shop_entity_seasons',
      sql`(${t.kitSeason} is null or ${t.kitSeason} ~ '^[0-9]{4}(/[0-9]{2})?$') and (${t.reviewedSeason} is null or ${t.reviewedSeason} ~ '^[0-9]{4}(/[0-9]{2})?$')`,
    ),
  ],
);

export const shopEntityStore = engage.table(
  'shop_entity_store',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => shopEntity.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => shopStore.id),
    lookupKind: text('lookup_kind').notNull(),
    /** Id do vendedor, categoria, lista de ids de produto ou slug do time na loja. */
    lookupValue: text('lookup_value').notNull(),
    /** Página oficial da entidade na loja, quando houver. */
    pageUrl: text('page_url'),
    updatedBy: text('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'shop_entity_store_pkey', columns: [t.entityId, t.storeId] }),
    index('shop_entity_store_store_idx').on(t.storeId),
    check('shop_entity_store_lookup_kind', inList('lookup_kind', SHOP_LOOKUP_KINDS)),
    check('shop_entity_store_lookup_len', sql`length(${t.lookupValue}) between 1 and 500`),
    check('shop_entity_store_page_https', sql`${t.pageUrl} is null or ${t.pageUrl} ~ '^https://'`),
  ],
);

export const shopProduct = engage.table(
  'shop_product',
  {
    id: pkUuidV7(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => shopEntity.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => shopStore.id),
    /** Id do produto na loja (ASIN, MLB…); o conector busca preço, imagem e estoque com ele. */
    storeProductId: text('store_product_id').notNull(),
    productType: text('product_type').notNull(),
    /** Nome curado, usado enquanto o conector não devolve o título oficial (modo link curado). */
    title: text('title').notNull(),
    season: text('season'),
    /** Link oficial do produto na loja, sem código de afiliado: a tag entra no conector, conforme o destino. */
    url: text('url').notNull(),
    active: boolean('active').notNull().default(true),
    position: integer('position').notNull().default(0),
    status: text('status').notNull().default('approved'),
    /** Quem sugeriu (`ai:<agente>` ou `galaxie:<id>`) e quem revisou. */
    suggestedBy: text('suggested_by'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    updatedBy: text('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shop_product_store_item_uq').on(t.entityId, t.storeId, t.storeProductId),
    index('shop_product_entity_idx').on(t.entityId, t.storeId, t.position),
    index('shop_product_store_idx').on(t.storeId),
    check('shop_product_type', inList('product_type', SHOP_PRODUCT_TYPES)),
    check('shop_product_status', inList('status', SHOP_PRODUCT_STATUSES)),
    check('shop_product_store_item_len', sql`length(${t.storeProductId}) between 1 and 120`),
    check('shop_product_title_len', sql`length(${t.title}) between 2 and 160`),
    check('shop_product_season', sql`${t.season} is null or ${t.season} ~ '^[0-9]{4}(/[0-9]{2})?$'`),
    check('shop_product_url_https', sql`${t.url} ~ '^https://'`),
    check('shop_product_position', sql`${t.position} >= 0`),
  ],
);

/** De onde veio o clique (#918): o site ou o app Galaxie, ou o widget de um cliente. */
export const SHOP_CLICK_ORIGINS = ['client', 'galaxie_app', 'galaxie_site'] as const;
export type ShopClickOrigin = (typeof SHOP_CLICK_ORIGINS)[number];

/**
 * Cliques no "Comprar" (#918), um por linha, para medir conversão, conferir o relatório das lojas e mostrar ao
 * cliente quanto o widget rendeu (#930). Sem dado pessoal: nada de IP, e-mail ou id do torcedor. Nunca vira ponto,
 * selo ou prêmio: nenhum outro módulo lê esta tabela para gamificação.
 */
export const shopClick = engage.table(
  'shop_click',
  {
    id: pkUuidV7(),
    clickedAt: timestamp('clicked_at', { withTimezone: true }).notNull().defaultNow(),
    /** Jogo da página (`core.event.id`), quando o clique veio de uma partida. */
    eventId: uuid('event_id'),
    entityKind: text('entity_kind').notNull(),
    entityId: uuid('entity_id').notNull(),
    productId: uuid('product_id').notNull(),
    storeId: text('store_id').notNull(),
    origin: text('origin').notNull(),
    /** Cliente e widget, quando a origem é `client`. */
    tenantId: uuid('tenant_id'),
    widgetId: text('widget_id'),
    /** País (ISO alfa-2) e idioma da página, quando vêm. */
    country: text('country'),
    locale: text('locale'),
  },
  (t) => [
    index('shop_click_event_idx').on(t.eventId, t.clickedAt),
    index('shop_click_entity_idx').on(t.entityKind, t.entityId, t.clickedAt),
    index('shop_click_store_idx').on(t.storeId, t.clickedAt),
    index('shop_click_tenant_idx').on(t.tenantId, t.clickedAt),
    check('shop_click_origin', inList('origin', SHOP_CLICK_ORIGINS)),
    check('shop_click_entity_kind', inList('entity_kind', SHOP_ENTITY_KINDS)),
    check('shop_click_client_tenant', sql`(${t.origin} = 'client') = (${t.tenantId} is not null)`),
    check('shop_click_country', sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
    check('shop_click_locale', sql`${t.locale} is null or length(${t.locale}) between 2 and 10`),
    check('shop_click_widget_len', sql`${t.widgetId} is null or length(${t.widgetId}) between 1 and 80`),
  ],
);
