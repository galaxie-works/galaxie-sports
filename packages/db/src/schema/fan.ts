/**
 * Identidade do torcedor (#937, arquitetura 01 "Modelo de dados"). O cliente é o controlador e o Galaxie o
 * operador: guardamos só o id que o cliente nos dá (pseudônimo), o Apelido, o avatar, a faixa etária, o país e
 * o idioma. Nunca e-mail, documento, telefone, senha ou data de nascimento.
 *
 * - **Conta** (`account`): a conta do cliente, com o aviso de Titular adulto (`yes`, `no`, `unknown`). O Prêmio
 *   vai para o Titular; sem a informação, fica "pendente com o cliente".
 * - **Perfil** (`profile`): quem palpita, pontua e escreve. Uma Conta pode ter vários Perfis, cada um com a
 *   própria faixa. Um Perfil por cliente, o mesmo em todas as Comunidades.
 * - **Registro de exclusão** (`erasure_log`): ids internos apagados, para repetir a exclusão depois de um
 *   restore de backup. Não guarda o id do cliente nem o Apelido.
 *
 * `tenant_id` abre a chave primária e todos os índices, e o Perfil aponta para a Conta por chave composta
 * `(tenant_id, account_id)`: o banco recusa vínculo entre clientes diferentes, mesmo com bug no código.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
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

export const fan = pgSchema('fan');

/** Faixa etária informada pela plataforma do cliente (D1 da revisão dos épicos). */
export const FAN_AGE_BANDS = ['under13', '13_17', '18plus'] as const;
export type FanAgeBand = (typeof FAN_AGE_BANDS)[number];

/** O Titular da Conta é adulto? `unknown` = o cliente não disse (Prêmio fica pendente com o cliente). */
export const FAN_HOLDER_ADULT = ['yes', 'no', 'unknown'] as const;
export type FanHolderAdult = (typeof FAN_HOLDER_ADULT)[number];

/** Campos do Perfil que o torcedor escolhe mostrar ou esconder dos outros torcedores. */
export const FAN_VISIBLE_FIELDS = ['avatar', 'favorite_team', 'level', 'badges'] as const;
export type FanVisibleField = (typeof FAN_VISIBLE_FIELDS)[number];
export type FanVisibility = Partial<Record<FanVisibleField, 'public' | 'private'>>;

const fanId = () =>
  uuid('id')
    .notNull()
    .default(sql`public.uuid_generate_v7()`);

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' });

export const fanAccount = fan.table(
  'account',
  {
    tenantId: tenantRef(),
    id: fanId(),
    /** Id da Conta no sistema do cliente (pseudônimo; nunca e-mail ou documento). */
    externalAccountId: text('external_account_id').notNull(),
    holderAdult: text('holder_adult').$type<FanHolderAdult>().notNull().default('unknown'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'account_pkey', columns: [t.tenantId, t.id] }),
    uniqueIndex('account_external_uq').on(t.tenantId, t.externalAccountId),
    check('account_holder_adult', sql`${t.holderAdult} in ('yes', 'no', 'unknown')`),
    check('account_external_len', sql`length(${t.externalAccountId}) between 1 and 128`),
  ],
);

export const fanProfile = fan.table(
  'profile',
  {
    tenantId: tenantRef(),
    id: fanId(),
    accountId: uuid('account_id').notNull(),
    /** Id do Perfil no sistema do cliente; null depois da exclusão. */
    externalProfileId: text('external_profile_id'),
    /** Apelido; null depois da exclusão. */
    nickname: text('nickname'),
    avatarUrl: text('avatar_url'),
    ageBand: text('age_band').$type<FanAgeBand>().notNull(),
    /** ISO 3166-1 alfa-2, maiúsculo. */
    country: text('country').notNull(),
    locale: text('locale').notNull(),
    /** Time do coração (`core.participant.id`), sem chave estrangeira: o espelho reorganiza o que é dele. */
    favoriteTeamId: uuid('favorite_team_id'),
    visibility: jsonb('visibility').$type<FanVisibility>().notNull().default({}),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'profile_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'profile_account_fk',
      columns: [t.tenantId, t.accountId],
      foreignColumns: [fanAccount.tenantId, fanAccount.id],
    }).onDelete('cascade'),
    uniqueIndex('profile_external_uq')
      .on(t.tenantId, t.accountId, t.externalProfileId)
      .where(sql`${t.externalProfileId} is not null`),
    index('profile_account_idx').on(t.tenantId, t.accountId),
    check('profile_age_band', sql`${t.ageBand} in ('under13', '13_17', '18plus')`),
    check('profile_country', sql`${t.country} ~ '^[A-Z]{2}$'`),
    // excluído não guarda nada que identifique; ativo sempre tem o id do cliente
    check(
      'profile_erased',
      sql`(${t.deletedAt} is null and ${t.externalProfileId} is not null) or (${t.deletedAt} is not null and ${t.externalProfileId} is null and ${t.nickname} is null and ${t.avatarUrl} is null)`,
    ),
  ],
);

export const fanErasureLog = fan.table(
  'erasure_log',
  {
    tenantId: tenantRef(),
    id: fanId(),
    profileId: uuid('profile_id').notNull(),
    accountId: uuid('account_id').notNull(),
    /** Quem pediu: `key:<prefixo da chave secreta>` ou `galaxie:<id>`. */
    requestedBy: text('requested_by').notNull(),
    erasedAt: timestamp('erased_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'erasure_log_pkey', columns: [t.tenantId, t.id] }),
    index('erasure_log_profile_idx').on(t.tenantId, t.profileId),
  ],
);
