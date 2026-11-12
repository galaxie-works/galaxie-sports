/**
 * Base do engajamento (#1017), schema `engage`: a ficha por país (#954), as listas da moderação (#969) e os
 * patrocinadores do cliente (#1021).
 *
 * Ficha por país:
 *
 * - `country_policy`: uma ficha por país (ISO 3166-1 alfa-2, ou `LATAM` para os demais da América Latina), global
 *   da Galaxie, com versão. O conteúdo e as regras ficam em `@galaxie/engage` (`CountryPolicy`); aqui o JSON;
 * - `country_policy_log`: cada versão gravada, com quem mudou e por quê (só cresce);
 * - `tenant_country`: os países onde o cliente opera, o país principal (fallback quando o torcedor vem de um país
 *   sem ficha) e o que o cliente endureceu naquele país.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { tenant } from './api.js';

export const engage = pgSchema('engage');

const policyKeyCheck = (col: unknown) => sql`${col} ~ '^([A-Z]{2}|LATAM)$'`;

export const countryPolicy = engage.table(
  'country_policy',
  {
    country: text('country').primaryKey(),
    /** `CountryPolicy` de `@galaxie/engage`. */
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull(),
    version: integer('version').notNull().default(1),
    /** `galaxie:<id do usuário>` ou `migration`. */
    updatedBy: text('updated_by').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [check('country_policy_key', policyKeyCheck(t.country))],
);

export const countryPolicyLog = engage.table(
  'country_policy_log',
  {
    id: pkUuidV7(),
    country: text('country').notNull(),
    version: integer('version').notNull(),
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull(),
    changedBy: text('changed_by').notNull(),
    reason: text('reason'),
    changedAt: createdAt(),
  },
  (t) => [uniqueIndex('country_policy_log_version_uq').on(t.country, t.version)],
);

export const tenantCountry = engage.table(
  'tenant_country',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    country: text('country').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** `PolicyHardening` de `@galaxie/engage`: só o que endurece a ficha. */
    hardening: jsonb('hardening').$type<Record<string, unknown>>(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'tenant_country_pkey', columns: [t.tenantId, t.country] }),
    uniqueIndex('tenant_country_primary_uq')
      .on(t.tenantId)
      .where(sql`${t.isPrimary}`),
    check('tenant_country_iso', sql`${t.country} ~ '^[A-Z]{2}$'`),
  ],
);

/** Listas da base de moderação (#969). Os nomes e as regras ficam em `@galaxie/engage` (`MODERATION_LISTS`). */
const MODERATION_LIST_NAMES = [
  'hate',
  'threat',
  'harassment',
  'sexual',
  'profanity',
  'betting',
  'allowed_domains',
  'bet_domains',
  'exceptions',
];
const inList = (col: string, list: readonly string[]) =>
  sql.raw(`${col} in (${list.map((v) => `'${v}'`).join(', ')})`);

/**
 * Uma lista da moderação. `tenant_id` nulo é a base da Galaxie (Ajustes → Conformidade → Moderação), que nunca
 * desliga; com `tenant_id`, o que o cliente acrescenta (só endurece). Exceções (falso positivo comum) só a Galaxie
 * tem. Os termos ficam na forma canônica de `normalizeTerm`/`normalizeDomain`.
 */
export const moderationList = engage.table(
  'moderation_list',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'cascade' }),
    list: text('list').notNull(),
    /** `all`, `pt`, `es` ou `en`. Listas de domínio e exceções usam `all`. */
    locale: text('locale').notNull(),
    terms: text('terms')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer('version').notNull().default(1),
    /** `galaxie:<id>`, `tenant:<id>` ou `migration`. */
    updatedBy: text('updated_by').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('moderation_list_base_uq')
      .on(t.list, t.locale)
      .where(sql`${t.tenantId} is null`),
    uniqueIndex('moderation_list_tenant_uq')
      .on(t.tenantId, t.list, t.locale)
      .where(sql`${t.tenantId} is not null`),
    check('moderation_list_name', inList('list', MODERATION_LIST_NAMES)),
    check('moderation_list_locale', sql`${t.locale} in ('all', 'pt', 'es', 'en')`),
    check(
      'moderation_list_domain_locale',
      sql`${t.list} not in ('allowed_domains', 'bet_domains', 'exceptions') or ${t.locale} = 'all'`,
    ),
    check('moderation_list_tenant_exceptions', sql`${t.tenantId} is null or ${t.list} <> 'exceptions'`),
    check('moderation_list_size', sql`cardinality(${t.terms}) <= 5000`),
  ],
);

/** Cada versão gravada de uma lista, com quem mudou e por quê (só cresce). */
export const moderationListLog = engage.table(
  'moderation_list_log',
  {
    id: pkUuidV7(),
    listId: uuid('list_id')
      .notNull()
      .references(() => moderationList.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id'),
    list: text('list').notNull(),
    locale: text('locale').notNull(),
    version: integer('version').notNull(),
    terms: text('terms').array().notNull(),
    changedBy: text('changed_by').notNull(),
    reason: text('reason'),
    changedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('moderation_list_log_version_uq').on(t.listId, t.version),
    index('moderation_list_log_changed_idx').on(t.changedAt),
  ],
);

/**
 * Patrocinadores do cliente (#1021, B10): um cadastro só, usado pela campanha de bolão, pela sala do chat e pelas
 * recompensas. As regras (categorias, recusa de casa de aposta, quem vê a peça) ficam em `@galaxie/engage`
 * (`validateSponsor`, `sponsorVisible`); o banco repete as categorias para recusar aposta gravada por fora da tela.
 */
const SPONSOR_CATEGORY_NAMES = [
  'alcohol',
  'apparel',
  'automotive',
  'beverage',
  'education',
  'energy',
  'finance',
  'food',
  'health',
  'media',
  'retail',
  'technology',
  'telecom',
  'travel',
  'other',
];
const SPONSOR_SURFACE_NAMES = ['chat_room', 'prediction_campaign', 'reward'];

export const sponsor = engage.table(
  'sponsor',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    linkUrl: text('link_url'),
    logoLightUrl: text('logo_light_url'),
    logoDarkUrl: text('logo_dark_url'),
    /** ISO 3166-1 alfa-2; vazio = todos os países do cliente. */
    countries: text('countries')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** Arquivado some das peças, mas o relatório de impressões continua. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    updatedBy: text('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sponsor_tenant_id_uq').on(t.tenantId, t.id),
    // o mesmo nome uma vez só por cliente (entre os ativos): sem recadastro do mesmo patrocinador
    uniqueIndex('sponsor_tenant_name_uq')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check('sponsor_category', inList('category', SPONSOR_CATEGORY_NAMES)),
    check('sponsor_name_len', sql`length(${t.name}) between 2 and 80`),
    check(
      'sponsor_urls_https',
      sql`(${t.linkUrl} is null or ${t.linkUrl} ~ '^https://') and (${t.logoLightUrl} is null or ${t.logoLightUrl} ~ '^https://') and (${t.logoDarkUrl} is null or ${t.logoDarkUrl} ~ '^https://')`,
    ),
    check('sponsor_countries', sql`cardinality(${t.countries}) <= 60`),
    check('sponsor_dates', sql`${t.endsAt} is null or ${t.startsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
);

/**
 * Impressões agregadas por patrocinador, lugar e dia (#1021): o número que o cliente mostra ao patrocinador. Só
 * contagem, sem torcedor nem sessão.
 */
export const sponsorImpressionDaily = engage.table(
  'sponsor_impression_daily',
  {
    tenantId: uuid('tenant_id').notNull(),
    sponsorId: uuid('sponsor_id').notNull(),
    surface: text('surface').notNull(),
    /** Id da sala, da campanha ou da recompensa no módulo. */
    surfaceId: text('surface_id').notNull(),
    day: date('day').notNull(),
    impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: 'sponsor_impression_daily_pkey',
      columns: [t.tenantId, t.sponsorId, t.surface, t.surfaceId, t.day],
    }),
    foreignKey({
      name: 'sponsor_impression_sponsor_fk',
      columns: [t.tenantId, t.sponsorId],
      foreignColumns: [sponsor.tenantId, sponsor.id],
    }).onDelete('cascade'),
    check('sponsor_impression_surface', inList('surface', SPONSOR_SURFACE_NAMES)),
    check('sponsor_impression_surface_id_len', sql`length(${t.surfaceId}) between 1 and 200`),
    check('sponsor_impression_nonneg', sql`${t.impressions} >= 0`),
  ],
);
