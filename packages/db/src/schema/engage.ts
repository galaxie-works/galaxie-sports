/**
 * Base do engajamento (#1017), schema `engage`. Por enquanto, a ficha por país (#954):
 *
 * - `country_policy`: uma ficha por país (ISO 3166-1 alfa-2, ou `LATAM` para os demais da América Latina), global
 *   da Galaxie, com versão. O conteúdo e as regras ficam em `@galaxie/engage` (`CountryPolicy`); aqui o JSON;
 * - `country_policy_log`: cada versão gravada, com quem mudou e por quê (só cresce);
 * - `tenant_country`: os países onde o cliente opera, o país principal (fallback quando o torcedor vem de um país
 *   sem ficha) e o que o cliente endureceu naquele país.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
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
