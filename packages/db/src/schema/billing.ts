import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { tenant } from './api.js';

/**
 * Plataforma comercial (#1136, F1 #1137): versões do catálogo, preços de lista e exceções por tenant. A estrutura do
 * catálogo (módulos, features, planos, faixas) mora em `config/catalog/` e é carregada por `@galaxie/billing`; aqui
 * fica só o que não pode morar na repo pública (preço) e o que é dado de tenant.
 */
export const billing = pgSchema('billing');

/**
 * Versões do catálogo vistas pelo sistema (hash do conteúdo de `config/catalog/`). A API grava a versão que carregou
 * ao subir; o tenant guarda a versão que assinou (`api.tenant.catalog_version`) e mantém o preço até a renovação.
 */
export const catalogVersion = billing.table('catalog_version', {
  version: text('version').primaryKey(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/** O que tem preço: plano, módulo, faixa de um módulo, add-on ou faixa de capacidade da organização. */
export const PRICE_ITEM_KINDS = ['plan', 'module', 'tier', 'addon', 'capacity'] as const;
export type PriceItemKind = (typeof PRICE_ITEM_KINDS)[number];

/** Como cobra: por mês, por ano, uma vez, ou medido (por unidade, no fechamento do mês). */
export const PRICE_INTERVALS = ['month', 'year', 'one_time', 'metered'] as const;
export type PriceInterval = (typeof PRICE_INTERVALS)[number];

/**
 * Preço de lista de um item do catálogo num mercado. Preço é dado, nunca código (a repo é pública): a equipe Galaxie
 * cadastra e desativa em Ajustes › Planos e preços. Mudança de preço vira linha nova (a antiga sai com `active =
 * false`), para o histórico e para quem assinou antes manter o preço até a renovação.
 */
export const price = billing.table(
  'price',
  {
    id: pkUuidV7(),
    itemKind: text('item_kind').$type<PriceItemKind>().notNull(),
    /** Chave do item no catálogo: plano (`fan_experience`), módulo (`live_chat`), faixa (`live_chat.peak_connections`
     * com `tier_value`), add-on (`where_to_watch.extra_markets`) ou capacidade (`C2`). */
    itemKey: text('item_key').notNull(),
    /** Valor da faixa que este preço cobre (só `item_kind = 'tier'`). */
    tierValue: integer('tier_value'),
    /** País (ISO2) onde o preço vale; `ZZ` = qualquer mercado sem preço próprio. */
    market: text('market').notNull(),
    currency: text('currency').$type<'usd' | 'brl'>().notNull(),
    /** Valor na menor unidade da moeda (centavos), por intervalo ou, quando medido, por unidade. */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    interval: text('interval').$type<PriceInterval>().notNull(),
    /** Preço publicado como "a partir de" (PL14): o valor final depende da capacidade e do atendimento. */
    startingAt: boolean('starting_at').notNull().default(true),
    /** Id do preço no Stripe (F4); null até a assinatura existir. */
    stripePriceId: text('stripe_price_id'),
    active: boolean('active').notNull().default(true),
    /** Versão do catálogo em que o preço foi cadastrado. */
    catalogVersion: text('catalog_version').references(() => catalogVersion.version, {
      onDelete: 'restrict',
    }),
    /** Quem cadastrou: `panel:<id do usuário>`, `cli:<comando>`. */
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('price_item_kind', sql`${t.itemKind} in ('plan', 'module', 'tier', 'addon', 'capacity')`),
    check('price_interval', sql`${t.interval} in ('month', 'year', 'one_time', 'metered')`),
    check('price_currency', sql`${t.currency} in ('usd', 'brl')`),
    check('price_market_iso2', sql`${t.market} ~ '^[A-Z]{2}$'`),
    check('price_amount_nonnegative', sql`${t.amountMinor} >= 0`),
    check('price_tier_value', sql`(${t.itemKind} = 'tier') = (${t.tierValue} is not null)`),
    // um preço ativo por item, valor de faixa, mercado, moeda e intervalo
    uniqueIndex('price_active_uq')
      .on(t.itemKind, t.itemKey, sql`coalesce(${t.tierValue}, -1)`, t.market, t.currency, t.interval)
      .where(sql`${t.active}`),
    index('price_item_idx').on(t.itemKind, t.itemKey),
  ],
);

/**
 * Tipos de exceção: liga um módulo fora do plano, tira um módulo, fixa uma faixa, soma unidades de um add-on ou liga
 * uma feature. Toda exceção tem motivo, autor e validade (para não virar "o normal").
 */
export const OVERRIDE_KINDS = ['module_grant', 'module_revoke', 'tier', 'addon', 'feature_grant'] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/** O que um tenant tem a mais ou a menos que o catálogo, por acordo. */
export const tenantOverride = billing.table(
  'tenant_override',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<OverrideKind>().notNull(),
    /** Módulo, faixa (`modulo.faixa`), add-on ou feature, conforme `kind`. */
    key: text('key').notNull(),
    /** Valor da faixa (`tier`) ou unidades do add-on (`addon`); null nos outros tipos. */
    value: integer('value'),
    reason: text('reason').notNull(),
    /** Quem deu: `panel:<id do usuário>`, `cli:<comando>`. */
    grantedBy: text('granted_by').notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    /** Revogada antes do prazo (a linha fica, para a auditoria). */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'tenant_override_kind',
      sql`${t.kind} in ('module_grant', 'module_revoke', 'tier', 'addon', 'feature_grant')`,
    ),
    check(
      'tenant_override_value',
      sql`(${t.kind} in ('tier', 'addon')) = (${t.value} is not null) and (${t.value} is null or ${t.value} >= 0)`,
    ),
    check('tenant_override_reason', sql`length(trim(${t.reason})) > 0`),
    check('tenant_override_revoked', sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`),
    index('tenant_override_tenant_idx').on(t.tenantId, t.validUntil),
  ],
);
