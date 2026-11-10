/**
 * Cosmos AI (#989): a IA que o cliente liga e paga por uso, com créditos pré-pagos. Tudo por tenant: a
 * carteira (saldo livre e reservado), o extrato (cada movimento com o saldo antes e depois), as reservas
 * abertas antes de cada chamada e o catálogo global de funções com o mínimo de cada uma.
 *
 * Fica fora de `ops.llm_usage` e do `TokenBudget` de propósito: aquele teto soma os agentes internos, e o
 * uso pago por cliente não pode tirar IA deles (arquitetura 06, "O que reaproveita"). A regra de cobrança
 * mora em `@galaxie/cosmos`; aqui só as tabelas.
 *
 * Créditos são `numeric(14,3)`: uma dúvida de moderação pode custar fração de crédito.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { tenant } from './api.js';

export const cosmos = pgSchema('cosmos');

/** Créditos com três casas (fração de crédito). */
const credits = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

export const walletStatus = cosmos.enum('wallet_status', ['active', 'blocked']);

/**
 * Carteira do tenant. `available` é o saldo livre; `reserved` soma as reservas abertas (o que já saiu do
 * livre mas ainda não foi acertado). A reserva tira de `available` numa única instrução condicional, então
 * o saldo nunca fica negativo, nem com várias salas ao mesmo tempo.
 */
export const wallet = cosmos.table(
  'wallet',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    available: credits('available').notNull().default(0),
    reserved: credits('reserved').notNull().default(0),
    /** Tudo o que já entrou (compras, teste, ajustes positivos). */
    receivedTotal: credits('received_total').notNull().default(0),
    status: walletStatus('status').notNull().default('active'),
    /** Créditos de teste concedidos (uma vez por tenant, mesmo desligando e religando). */
    trialGranted: boolean('trial_granted').notNull().default(false),
    /** Multiplicador sobre o custo real. Só a equipe Galaxie vê. */
    multiplier: numeric('multiplier', { precision: 8, scale: 3, mode: 'number' }).notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('wallet_available_non_negative', sql`${t.available} >= 0`),
    check('wallet_reserved_non_negative', sql`${t.reserved} >= 0`),
    check('wallet_multiplier_positive', sql`${t.multiplier} > 0`),
  ],
);

export const LEDGER_KINDS = [
  'trial',
  'trial_expiry',
  'purchase',
  'usage',
  'refund',
  'adjustment',
  'quota_change',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const ledgerKind = cosmos.enum('ledger_kind', LEDGER_KINDS);

/**
 * Extrato: cada movimento com o saldo livre antes e depois (`balance_after - balance_before = credits`).
 * No uso, também os tokens, o custo real e o modelo, que só a Galaxie vê. Na moderação ao vivo, um
 * lançamento por lote, não por mensagem.
 */
export const ledger = cosmos.table(
  'ledger',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    kind: ledgerKind('kind').notNull(),
    /** Positivo entra, negativo sai. */
    credits: credits('credits').notNull(),
    balanceBefore: credits('balance_before').notNull(),
    balanceAfter: credits('balance_after').notNull(),
    /** Função da Cosmos (cosmos.function_def.name) no uso. */
    functionName: text('function_name'),
    /** Sala, Comunidade ou produto (`chat:<id>`, `community:<id>`…). */
    scope: text('scope'),
    /** Quem pediu (usuário do console), quando houver. */
    userId: text('user_id'),
    reservationId: uuid('reservation_id'),
    tokensIn: integer('tokens_in'),
    tokensCached: integer('tokens_cached'),
    tokensOut: integer('tokens_out'),
    /** Custo real no provedor, em US$. */
    costUsd: numeric('cost_usd', { precision: 14, scale: 6, mode: 'number' }),
    model: text('model'),
    note: text('note'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    check('ledger_balance_matches', sql`${t.balanceAfter} - ${t.balanceBefore} = ${t.credits}`),
    check('ledger_balance_non_negative', sql`${t.balanceAfter} >= 0`),
    index('ledger_tenant_id_idx').on(t.tenantId, t.id.desc()),
    index('ledger_tenant_function_idx').on(t.tenantId, t.functionName, t.id.desc()),
    index('ledger_tenant_scope_idx').on(t.tenantId, t.scope, t.id.desc()),
    index('ledger_usage_day_idx')
      .on(t.createdAt)
      .where(sql`${t.kind} = 'usage'`),
  ],
);

export const reservationStatus = cosmos.enum('reservation_status', [
  'open',
  'settled',
  'released',
  'expired',
]);

/** Reserva feita antes de chamar o modelo; `settle` acerta o valor real, `release` devolve tudo. */
export const reservation = cosmos.table(
  'reservation',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    functionName: text('function_name').notNull(),
    credits: credits('credits').notNull(),
    scope: text('scope'),
    userId: text('user_id'),
    status: reservationStatus('status').notNull().default('open'),
    /** Passou daqui aberta, o job de limpeza devolve o saldo (`expired`). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Créditos efetivamente cobrados no acerto. */
    chargedCredits: credits('charged_credits'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('reservation_credits_positive', sql`${t.credits} > 0`),
    index('reservation_open_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'open'`),
    index('reservation_tenant_idx').on(t.tenantId, t.id.desc()),
  ],
);

/**
 * Catálogo global de funções da Cosmos: o mínimo cobrado por chamada, a permissão exigida e a tela onde
 * ela aparece. Créditos cobrados = maior entre (custo × multiplicador ÷ valor do crédito) e o mínimo.
 */
export const functionDef = cosmos.table(
  'function_def',
  {
    name: text('name').primaryKey(),
    minCredits: credits('min_credits').notNull(),
    /** Permissão do console exigida para chamar (#996, cargos do #1019). */
    permission: text('permission').notNull(),
    /** Tela onde a função aparece (rota do console). */
    screen: text('screen'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('function_def_min_positive', sql`${t.minCredits} > 0`)],
);

// ─── compra de créditos pelo Stripe (#993) ──────────────────────────────────────────────────────────

export const PACKAGE_CURRENCIES = ['brl', 'usd'] as const;
export type PackageCurrency = (typeof PACKAGE_CURRENCIES)[number];

/**
 * Pacote de créditos à venda. Preço e créditos são dados, nunca código: a Galaxie cadastra e desativa
 * pelo banco (Ajustes, #1001). `market` é o país (ISO2) onde o pacote aparece.
 */
export const creditPackage = cosmos.table(
  'package',
  {
    id: pkUuidV7(),
    name: text('name').notNull(),
    credits: credits('credits').notNull(),
    /** Preço na menor unidade da moeda (centavos). */
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').$type<PackageCurrency>().notNull(),
    market: text('market').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('package_credits_positive', sql`${t.credits} > 0`),
    check('package_price_positive', sql`${t.priceCents} > 0`),
    check('package_currency', sql`${t.currency} in ('brl', 'usd')`),
    check('package_market_iso2', sql`${t.market} ~ '^[A-Z]{2}$'`),
    index('package_market_idx').on(t.market, t.active),
  ],
);

export const purchaseStatus = cosmos.enum('purchase_status', [
  'pending',
  'paid',
  'failed',
  'canceled',
  'expired',
]);

/**
 * Intenção de compra, criada antes do checkout com o que o cliente espera receber (copia créditos e
 * valor do pacote naquele momento). O crédito só entra pelo webhook com o pagamento confirmado.
 */
export const purchaseIntent = cosmos.table(
  'purchase_intent',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id').references(() => creditPackage.id, { onDelete: 'set null' }),
    credits: credits('credits').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').$type<PackageCurrency>().notNull(),
    status: purchaseStatus('status').notNull().default('pending'),
    /** Quem comprou (usuário do console). */
    userId: text('user_id'),
    checkoutSessionId: text('checkout_session_id').unique(),
    paymentIntentId: text('payment_intent_id'),
    invoiceId: text('invoice_id'),
    /** Lançamento da compra no extrato, depois de pago. */
    ledgerId: uuid('ledger_id'),
    failureReason: text('failure_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('purchase_intent_credits_positive', sql`${t.credits} > 0`),
    check('purchase_intent_amount_positive', sql`${t.amountCents} > 0`),
    index('purchase_intent_tenant_idx').on(t.tenantId, t.id.desc()),
  ],
);

/** Evento do Stripe já recebido: o id é único, então o webhook repetido não credita duas vezes. */
export const stripeEvent = cosmos.table('stripe_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  purchaseIntentId: uuid('purchase_intent_id'),
  /** O que o evento causou (`credited`, `failed`, `ignored`…). */
  outcome: text('outcome').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
