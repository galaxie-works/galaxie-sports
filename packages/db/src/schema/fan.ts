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
  bigint,
  boolean,
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

/**
 * Faixa fina (#1105), para os limites de 14 e 16 anos da ficha por país. A coluna `age_band` guarda a faixa larga
 * (as rotas de hoje leem só ela); `age_band_detail` guarda a fina, null em Perfil gravado antes do #1105.
 */
export const FAN_AGE_BANDS_DETAIL = ['under13', '13', '14_15', '16_17', '18plus'] as const;
export type FanAgeBandDetail = (typeof FAN_AGE_BANDS_DETAIL)[number];

/** Faixa larga da faixa fina. */
export const coarseAgeBand = (band: FanAgeBandDetail): FanAgeBand =>
  band === 'under13' || band === '18plus' ? band : '13_17';

/** Como o cliente comprovou a idade (#1105, #1109): declarada, estimada ou verificada. */
export const FAN_AGE_ASSURANCE = ['self', 'estimated', 'verified'] as const;
export type FanAgeAssurance = (typeof FAN_AGE_ASSURANCE)[number];

/** Autorização do responsável legal (#1105, #1108). */
export const FAN_GUARDIAN_STATUS = ['none', 'pending', 'granted', 'revoked'] as const;
export type FanGuardianStatus = (typeof FAN_GUARDIAN_STATUS)[number];

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
    /** Faixa fina (#1105); null = Perfil gravado antes, só com a faixa larga. */
    ageBandDetail: text('age_band_detail').$type<FanAgeBandDetail>(),
    /** Comprovação da idade declarada pelo cliente; sem o bloco no pedido, `self`. */
    ageAssurance: text('age_assurance').$type<FanAgeAssurance>().notNull().default('self'),
    ageAssuranceAt: timestamp('age_assurance_at', { withTimezone: true }),
    /** Quem estimou ou verificou (nome do fornecedor, nunca o resultado nem o documento). */
    ageAssuranceProvider: text('age_assurance_provider'),
    guardianStatus: text('guardian_status').$type<FanGuardianStatus>().notNull().default('none'),
    /** Id da autorização guardada no Galaxie (#1108); sem ele, a prova é do cliente (contrato B11). */
    guardianConsentId: text('guardian_consent_id'),
    /** A conta do menor está vinculada à do responsável no sistema do cliente. */
    guardianLinked: boolean('guardian_linked').notNull().default(false),
    /**
     * Faixa desceu de `18plus` para menor: as ações de adulto ficam congeladas e o caso vai para a fila de
     * moderação. Só a correção da faixa (#1110) libera.
     */
    ageFrozenAt: timestamp('age_frozen_at', { withTimezone: true }),
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
    check(
      'profile_age_band_detail',
      sql`${t.ageBandDetail} is null or ${t.ageBandDetail} in ('under13', '13', '14_15', '16_17', '18plus')`,
    ),
    check('profile_age_assurance', sql`${t.ageAssurance} in ('self', 'estimated', 'verified')`),
    check(
      'profile_age_assurance_provider',
      sql`${t.ageAssuranceProvider} is null or length(${t.ageAssuranceProvider}) between 1 and 64`,
    ),
    check('profile_guardian_status', sql`${t.guardianStatus} in ('none', 'pending', 'granted', 'revoked')`),
    check(
      'profile_guardian_consent',
      sql`${t.guardianConsentId} is null or length(${t.guardianConsentId}) between 1 and 128`,
    ),
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

/**
 * Carteira de pontos (#938, B6). Uma por Perfil e **programa** (cliente + país). Duas grandezas separadas:
 *
 * - **Pontos**: só sobem (Palpites, Conquistas, presença, enquete, trivia) e definem Nível e Ranking. Só caem por
 *   estorno do evento que os deu (gol anulado, palpite recalculado).
 * - **Saldo**: o que se pode gastar na Vitrine opcional. Sobe junto com os Pontos; trocar gasta só o Saldo, nunca
 *   os Pontos nem o Ranking.
 *
 * Compra e clique na loja nunca creditam: a origem `shopping` é recusada pelo banco. Pontos não se compram, não se
 * transferem entre torcedores e não viram dinheiro. O valor do ponto, a validade e o resgate são da Gamificação
 * (#928); aqui ficam só a carteira, o extrato e o serviço `credit`/`debit`/`revert` (`@galaxie/db/fan-wallet`).
 */
export const FAN_POINTS_REASONS = [
  'prediction',
  'achievement',
  'presence',
  'poll',
  'trivia',
  'adjustment',
  'redeem',
  'revert',
] as const;
export type FanPointsReason = (typeof FAN_POINTS_REASONS)[number];

/** Módulos que creditam pontos. `shopping` fica de fora de propósito (compra nunca dá ponto). */
export const FAN_POINTS_SOURCES = [
  'live_chat',
  'communities',
  'gamification',
  'cosmos_ai',
  'galaxie',
] as const;
export type FanPointsSource = (typeof FAN_POINTS_SOURCES)[number];

const inList = (col: unknown, list: readonly string[]) =>
  sql.raw(`${String(col)} in (${list.map((v) => `'${v}'`).join(', ')})`);

export const fanWallet = fan.table(
  'wallet',
  {
    tenantId: tenantRef(),
    profileId: uuid('profile_id').notNull(),
    /** País do programa (ISO 3166-1 alfa-2): Pontos e Ranking são por cliente e país. */
    programCountry: text('program_country').notNull(),
    points: bigint('points', { mode: 'number' }).notNull().default(0),
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'wallet_pkey', columns: [t.tenantId, t.profileId, t.programCountry] }),
    foreignKey({
      name: 'wallet_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    check('wallet_country', sql`${t.programCountry} ~ '^[A-Z]{2}$'`),
    check('wallet_points_nonneg', sql`${t.points} >= 0`),
    check('wallet_balance_nonneg', sql`${t.balance} >= 0`),
  ],
);

export const fanPointsLedger = fan.table(
  'points_ledger',
  {
    tenantId: tenantRef(),
    id: fanId(),
    profileId: uuid('profile_id').notNull(),
    programCountry: text('program_country').notNull(),
    reason: text('reason').$type<FanPointsReason>().notNull(),
    /** Módulo que lançou. */
    source: text('source').$type<FanPointsSource>().notNull(),
    /** Id do evento de origem no módulo (palpite, conquista, janela de presença). Chave de idempotência. */
    sourceEvent: text('source_event').notNull(),
    /** Lançamento que este estorna (só em `revert`). */
    revertsId: uuid('reverts_id'),
    pointsDelta: bigint('points_delta', { mode: 'number' }).notNull(),
    balanceDelta: bigint('balance_delta', { mode: 'number' }).notNull(),
    pointsAfter: bigint('points_after', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    /** Texto curto para o extrato, sem dado pessoal. */
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'points_ledger_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'points_ledger_wallet_fk',
      columns: [t.tenantId, t.profileId, t.programCountry],
      foreignColumns: [fanWallet.tenantId, fanWallet.profileId, fanWallet.programCountry],
    }).onDelete('cascade'),
    // o mesmo evento do mesmo módulo nunca lança duas vezes no mesmo programa do Perfil (reprocessar não duplica)
    uniqueIndex('points_ledger_event_uq')
      .on(t.tenantId, t.profileId, t.programCountry, t.source, t.sourceEvent, t.reason)
      .where(sql`${t.revertsId} is null`),
    // cada lançamento é estornado uma vez só
    uniqueIndex('points_ledger_revert_uq')
      .on(t.tenantId, t.revertsId)
      .where(sql`${t.revertsId} is not null`),
    // extrato da carteira em ordem; único para o estorno poder apontar um lançamento da mesma carteira
    uniqueIndex('points_ledger_wallet_uq').on(t.tenantId, t.profileId, t.programCountry, t.id),
    // estorno aponta um lançamento da mesma carteira (mesmo cliente, Perfil e programa)
    foreignKey({
      name: 'points_ledger_reverts_fk',
      columns: [t.tenantId, t.profileId, t.programCountry, t.revertsId],
      foreignColumns: [t.tenantId, t.profileId, t.programCountry, t.id],
    }).onDelete('cascade'),
    check('points_ledger_reason', inList('reason', FAN_POINTS_REASONS)),
    check('points_ledger_source', inList('source', FAN_POINTS_SOURCES)),
    check('points_ledger_nonzero', sql`${t.pointsDelta} <> 0 or ${t.balanceDelta} <> 0`),
    // Pontos só caem por estorno; o resgate gasta só o Saldo
    check(
      'points_ledger_shape',
      sql`(${t.reason} = 'revert' and ${t.revertsId} is not null and ${t.pointsDelta} <= 0 and ${t.balanceDelta} <= 0)
        or (${t.reason} = 'redeem' and ${t.revertsId} is null and ${t.pointsDelta} = 0 and ${t.balanceDelta} < 0)
        or (${t.reason} not in ('revert', 'redeem') and ${t.revertsId} is null and ${t.pointsDelta} > 0 and ${t.balanceDelta} = ${t.pointsDelta})`,
    ),
    check('points_ledger_after_nonneg', sql`${t.pointsAfter} >= 0 and ${t.balanceAfter} >= 0`),
    check('points_ledger_event_len', sql`length(${t.sourceEvent}) between 1 and 200`),
    check('points_ledger_note_len', sql`${t.note} is null or length(${t.note}) <= 200`),
  ],
);

/**
 * Estorno que chegou antes do crédito (fila fora de ordem, VAR anulou antes de o módulo creditar): o crédito desse
 * evento que chegar depois é recusado. Sai junto na exclusão do Perfil.
 */
export const fanPointsRevokedEvent = fan.table(
  'points_revoked_event',
  {
    tenantId: tenantRef(),
    profileId: uuid('profile_id').notNull(),
    programCountry: text('program_country').notNull(),
    source: text('source').$type<FanPointsSource>().notNull(),
    sourceEvent: text('source_event').notNull(),
    reason: text('reason').$type<FanPointsReason>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'points_revoked_event_pkey',
      columns: [t.tenantId, t.profileId, t.programCountry, t.source, t.sourceEvent, t.reason],
    }),
    foreignKey({
      name: 'points_revoked_event_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    check('points_revoked_event_len', sql`length(${t.sourceEvent}) between 1 and 200`),
    check('points_revoked_event_source', inList('source', FAN_POINTS_SOURCES)),
    // só motivo de crédito: resgate e estorno não têm crédito a recusar
    check(
      'points_revoked_event_reason',
      inList(
        'reason',
        FAN_POINTS_REASONS.filter((r) => r !== 'redeem' && r !== 'revert'),
      ),
    ),
  ],
);

/**
 * Verificação de idade feita pela Galaxie (#1109, módulo `age_verification`, cobrado por verificação). O torcedor
 * passa pelo fluxo do provedor (Didit primeiro): estimativa pelo rosto e, na zona de dúvida, documento. A decisão
 * chega por webhook e vira a comprovação do Perfil (`age_assurance`).
 *
 * Só metadados: nunca imagem, documento, data de nascimento nem a idade estimada. O resultado é a faixa (`result_band`).
 * Decidida a sessão, pedimos ao provedor que apague os dados dela (`purged_at`).
 */
export const AGE_VERIFICATION_PROVIDERS = ['didit'] as const;
export type AgeVerificationProvider = (typeof AGE_VERIFICATION_PROVIDERS)[number];

/** Estado da sessão: `pending` até o provedor decidir; `review` = o provedor mandou para revisão manual dele. */
export const AGE_VERIFICATION_STATUSES = [
  'pending',
  'approved',
  'declined',
  'review',
  'abandoned',
  'expired',
] as const;
export type AgeVerificationStatus = (typeof AGE_VERIFICATION_STATUSES)[number];

/** Por onde a decisão saiu: só a estimativa do rosto ou com o documento. É o que define a cobrança. */
export const AGE_VERIFICATION_PATHS = ['estimate', 'document'] as const;
export type AgeVerificationPath = (typeof AGE_VERIFICATION_PATHS)[number];

export const fanAgeVerification = fan.table(
  'age_verification',
  {
    tenantId: tenantRef(),
    id: fanId(),
    profileId: uuid('profile_id').notNull(),
    provider: text('provider').$type<AgeVerificationProvider>().notNull(),
    /** Id da sessão no provedor. */
    providerSessionId: text('provider_session_id').notNull(),
    status: text('status').$type<AgeVerificationStatus>().notNull().default('pending'),
    path: text('path').$type<AgeVerificationPath>(),
    /** Faixa que a decisão comprova: `18plus` quando aprovada; a de menor quando o documento recusou; senão null. */
    resultBand: text('result_band').$type<FanAgeBandDetail>(),
    /** Último evento do provedor aplicado (idempotência do webhook). */
    lastEventId: text('last_event_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Medida para a cobrança (uma vez por sessão). */
    meteredAt: timestamp('metered_at', { withTimezone: true }),
    /** Dados apagados no provedor. */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'age_verification_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'age_verification_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    uniqueIndex('age_verification_provider_session_uq').on(t.provider, t.providerSessionId),
    index('age_verification_profile_idx').on(t.tenantId, t.profileId, t.createdAt),
    // fila do apagamento no provedor: decididas e ainda não apagadas
    index('age_verification_purge_idx')
      .on(t.decidedAt)
      .where(sql`${t.purgedAt} is null and ${t.decidedAt} is not null`),
    check('age_verification_provider', inList('provider', AGE_VERIFICATION_PROVIDERS)),
    check('age_verification_status', inList('status', AGE_VERIFICATION_STATUSES)),
    check('age_verification_path', sql`path is null or ${inList('path', AGE_VERIFICATION_PATHS)}`),
    check(
      'age_verification_result_band',
      sql`result_band is null or ${inList('result_band', FAN_AGE_BANDS_DETAIL)}`,
    ),
    check('age_verification_session_len', sql`length(${t.providerSessionId}) between 1 and 128`),
    check(
      'age_verification_event_len',
      sql`last_event_id is null or length(last_event_id) between 1 and 128`,
    ),
    // aprovada sempre diz a faixa; pendente nunca tem decisão
    check(
      'age_verification_decided',
      sql`(status = 'pending' and decided_at is null) or (status <> 'pending' and decided_at is not null)`,
    ),
    // aprovada = adulto comprovado (a idade mínima do workflow é 18)
    check('age_verification_approved_band', sql`status <> 'approved' or (result_band is not null and result_band = '18plus')`),
  ],
);
