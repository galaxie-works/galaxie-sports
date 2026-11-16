import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { tenant, type TenantState } from './api.js';

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

// ─── organização, membros, domínios e ações da equipe (F2 #1136, docs 02 e 03 da plataforma) ─────────────────────

/** Moeda em que a organização é faturada; `CAD` depois (doc 03). */
export const ORGANIZATION_CURRENCIES = ['usd', 'brl'] as const;
export type OrganizationCurrency = (typeof ORGANIZATION_CURRENCIES)[number];

/** Entidade da Galaxie que fatura: LLC (uma conta Stripe só) ou Ltda, pela ficha do país (PL8). */
export const BILLING_ENTITIES = ['llc', 'ltda'] as const;
export type BillingEntity = (typeof BILLING_ENTITIES)[number];

/** Faixas de capacidade (`config/catalog/capacity.yaml`); C3 e C4 só por proposta (PL7, R3). */
export const CAPACITY_TIERS = ['C1', 'C2', 'C3', 'C4'] as const;
export type CapacityTier = (typeof CAPACITY_TIERS)[number];

/**
 * Revisão manual do cadastro (PL2): `none` = entrou direto (e-mail de empresa); `pending` = caiu numa regra antiabuso
 * (e-mail grátis, limite por IP) e espera a fila do admin; `approved` e `rejected` = decisão do admin.
 */
export const ORGANIZATION_REVIEW_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type OrganizationReviewStatus = (typeof ORGANIZATION_REVIEW_STATUSES)[number];

/** Endereço de fatura, livre (o Stripe é quem valida); chaves em inglês: `line1`, `city`, `state`, `postal_code`… */
export type BillingAddress = Record<string, string | undefined>;

/**
 * Quem assina e paga, acima da marca (doc 03): contrato, entidade e moeda, faixa de capacidade, cliente no Stripe,
 * termos aceitos. Uma organização tem uma ou mais marcas (`api.tenant.organization_id`); as marcas não compartilham
 * dado de torcedor nem de widget, só contrato, faixa e fatura. A faixa de capacidade é da organização e o pico é medido
 * por marca (PL23). O caso comum, uma organização com uma marca só, não vê diferença na tela.
 */
export const organization = billing.table(
  'organization',
  {
    id: pkUuidV7(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** País principal (ISO2): define moeda, entidade e o padrão de locale e fuso. */
    country: text('country').notNull(),
    currency: text('currency').$type<OrganizationCurrency>().notNull(),
    billingEntity: text('billing_entity').$type<BillingEntity>().notNull(),
    capacityTier: text('capacity_tier').$type<CapacityTier>().notNull().default('C1'),
    /** Padrão do console e das faturas; null = o do país. */
    locale: text('locale'),
    /** Fuso IANA (`America/Sao_Paulo`); null = o do país. */
    timezone: text('timezone'),
    // dados de fatura (o cadastro do PR (c) e a tela de Cobrança preenchem)
    legalName: text('legal_name'),
    /** CNPJ, EIN ou equivalente, como o cliente informou. */
    taxId: text('tax_id'),
    billingEmail: text('billing_email'),
    billingAddress: jsonb('billing_address').$type<BillingAddress>(),
    // aceite dos termos de autoatendimento (doc 02 §Cadastro): versão, quando, quem e de onde
    termsVersion: text('terms_version'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    /** Usuário do console (Better Auth) que aceitou. */
    termsAcceptedBy: text('terms_accepted_by'),
    termsAcceptedIp: text('terms_accepted_ip'),
    reviewStatus: text('review_status').$type<OrganizationReviewStatus>().notNull().default('none'),
    /** Cliente no Stripe (F4); null até existir. */
    stripeCustomerId: text('stripe_customer_id'),
    /** Cliente zero: a própria Galaxie (site e app), que consome tudo sem cobrança. */
    isGalaxie: boolean('is_galaxie').notNull().default(false),
    /** Quem criou: `signup:<id do usuário>`, `panel:<id do usuário>`, `cli:<comando>`, `migration:<número>`. */
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('organization_country_iso2', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('organization_currency', sql`${t.currency} in ('usd', 'brl')`),
    check('organization_billing_entity', sql`${t.billingEntity} in ('llc', 'ltda')`),
    check('organization_capacity_tier', sql`${t.capacityTier} in ('C1', 'C2', 'C3', 'C4')`),
    check(
      'organization_review_status',
      sql`${t.reviewStatus} in ('none', 'pending', 'approved', 'rejected')`,
    ),
    // o aceite vem inteiro ou não vem: versão e data andam juntas
    check('organization_terms', sql`(${t.termsVersion} is null) = (${t.termsAcceptedAt} is null)`),
  ],
);

/** Cargos que valem na organização inteira (doc 03): o Dono e o financeiro. Os demais são da marca (`tenant_member`). */
export const ORGANIZATION_MEMBER_ROLES = ['owner', 'billing'] as const;
export type OrganizationMemberRole = (typeof ORGANIZATION_MEMBER_ROLES)[number];

/**
 * Pessoa com cargo na organização inteira. O cadastro grava quem criou como `owner`; os demais entram por convite com
 * validade (`expires_at`) e `accepted_at` nulo até o aceite por OTP. A migration 0178 criou um `owner` aqui para cada
 * Dono de marca que já existia.
 */
export const organizationMember = billing.table(
  'organization_member',
  {
    id: pkUuidV7(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Usuário do console (texto do Better Auth). */
    userId: text('user_id').notNull(),
    role: text('role').$type<OrganizationMemberRole>().notNull(),
    /** Quem convidou: `signup:<id>`, `panel:<id do usuário>`, `galaxie:<id>`, `migration:<número>`. */
    invitedBy: text('invited_by').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    /** Validade do convite; null = sem prazo ou já aceito. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Primeiro acesso depois do convite; null = convite pendente. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organization_member_user_uq').on(t.organizationId, t.userId),
    index('organization_member_user_idx').on(t.userId),
    check('organization_member_role', sql`${t.role} in ('owner', 'billing')`),
  ],
);

/**
 * Domínio de uma marca com posse comprovada por registro TXT (doc 02 §Cadastro): só depois de `verified_at` o host
 * entra como origem da chave publicável e como host do App da Comunidade. Sem a prova, um tenant poderia liberar o
 * domínio de outro; por isso um host comprovado só pode ser de uma marca. O job `tenant.verify_domain` (PR (b))
 * confere o TXT e grava `verified_at`, `last_checked_at` e `last_error`.
 */
export const domain = billing.table(
  'domain',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Host em minúsculas, sem esquema nem porta (`www.exemplo.com`). */
    host: text('host').notNull(),
    /** Valor que o cliente publica no TXT `_galaxie.<host>`; gerado pelo banco (122 bits aleatórios), único. */
    txtToken: text('txt_token')
      .notNull()
      .default(sql`'galaxie-verify=' || replace(gen_random_uuid()::text, '-', '')`),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** Motivo da última conferência que falhou; null quando passou ou ainda não conferiu. */
    lastError: text('last_error'),
    /** Quem cadastrou: `signup:<id>`, `panel:<id do usuário>`, `galaxie:<id>`. */
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('domain_tenant_host_uq').on(t.tenantId, t.host),
    // um host comprovado pertence a uma marca só
    uniqueIndex('domain_verified_host_uq')
      .on(t.host)
      .where(sql`${t.verifiedAt} is not null`),
    uniqueIndex('domain_txt_token_uq').on(t.txtToken),
    check(
      'domain_host_format',
      sql`${t.host} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'`,
    ),
  ],
);

/**
 * Toda ação da equipe Galaxie sobre um tenant ou uma organização (PL17): quem, quando, sobre quem, o quê e por quê,
 * como `cosmos.staff_action` faz com as carteiras. Só cresce; o painel nunca altera nem apaga uma linha. `action` é
 * livre (`override.grant`, `review.approve`, `member.role_change`…); `payload` guarda o antes e o depois.
 */
export const platformStaffAction = billing.table(
  'staff_action',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    /** Usuário do console da equipe Galaxie (Better Auth). */
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    check('billing_staff_action_target', sql`${t.tenantId} is not null or ${t.organizationId} is not null`),
    check('billing_staff_action_reason', sql`length(trim(${t.reason})) >= 5`),
    index('billing_staff_action_tenant_idx').on(t.tenantId, t.id.desc()),
    index('billing_staff_action_organization_idx').on(t.organizationId, t.id.desc()),
  ],
);

// ─── máquina de estados do tenant (F3, doc 02 §Máquina de estados do tenant) ───────────────────────────────────────

/**
 * O que provocou a mudança de estado: o cadastro, o provisionamento, a revisão do cadastro (PL2), um pagamento (F4), o
 * relógio (job `tenant.lifecycle`), a equipe com motivo (PL17), um pedido do cliente ou a migration de dados.
 */
export const TENANT_STATE_EVENT_CAUSES = [
  'signup',
  'provision',
  'review',
  'payment',
  'clock',
  'admin',
  'request',
  'migration',
] as const;
export type TenantStateEventCause = (typeof TENANT_STATE_EVENT_CAUSES)[number];

/**
 * Histórico da máquina de estados: uma linha por transição (e uma, com `from_state` nulo, pela criação em `draft`). A
 * transição é sempre por evento registrado; `transitionTenantState` (`@galaxie/billing`) grava aqui e em
 * `api.tenant.state` na mesma transação. Só cresce.
 */
export const tenantStateEvent = billing.table(
  'tenant_state_event',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Estado anterior; null na criação do tenant. */
    fromState: text('from_state').$type<TenantState>(),
    toState: text('to_state').$type<TenantState>().notNull(),
    cause: text('cause').$type<TenantStateEventCause>().notNull(),
    /** Motivo em texto (obrigatório nas ações da equipe, pelo `staff_action`; livre nas demais). */
    reason: text('reason'),
    /** Quem: `signup:<id>`, `galaxie:<id do usuário>`, `job:tenant.lifecycle`, `api:admin`, `migration:<número>`. */
    actor: text('actor').notNull(),
    /** O que mais vale guardar (prazo do trial antes e depois, id do pagamento…). */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'tenant_state_event_from',
      sql`${t.fromState} is null or ${t.fromState} in ('draft', 'pending_review', 'rejected', 'trial', 'trial_expired', 'active', 'past_due', 'suspended', 'cancelled')`,
    ),
    check(
      'tenant_state_event_to',
      sql`${t.toState} in ('draft', 'pending_review', 'rejected', 'trial', 'trial_expired', 'active', 'past_due', 'suspended', 'cancelled')`,
    ),
    check(
      'tenant_state_event_cause',
      sql`${t.cause} in ('signup', 'provision', 'review', 'payment', 'clock', 'admin', 'request', 'migration')`,
    ),
    index('tenant_state_event_tenant_idx').on(t.tenantId, t.createdAt),
  ],
);
