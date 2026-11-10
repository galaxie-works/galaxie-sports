/**
 * Compra de créditos (#993): pacotes, intenção de compra e o webhook do Stripe. O crédito só entra com o
 * pagamento confirmado, numa transação com o registro do evento: o mesmo evento repetido (o Stripe
 * reenvia) é ignorado pelo id, e a intenção que já foi paga não credita de novo por outro evento.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import {
  autoRecharge,
  creditPackage,
  purchaseIntent,
  rechargeAttempt,
  stripeEvent,
  type PackageCurrency,
} from '@galaxie/db/schema';
import { ceilCredits } from './credits.js';
import { isUuid } from './uuid.js';
import { CosmosError } from './errors.js';
import type { StripeCheckoutSession, StripeEvent } from './stripe.js';
import { applyRechargeEvent } from './recharge.js';
import { addEntryInTx, type Tx } from './wallet.js';

export interface CreditPackageView {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  currency: PackageCurrency;
  market: string;
}

const packageColumns = {
  id: creditPackage.id,
  name: creditPackage.name,
  credits: creditPackage.credits,
  priceCents: creditPackage.priceCents,
  currency: creditPackage.currency,
  market: creditPackage.market,
};

/** Pacotes ativos de um mercado (país ISO2), na ordem cadastrada e depois pelos créditos. */
export async function listPackages(
  db: Pick<Database, 'select'>,
  market: string,
): Promise<CreditPackageView[]> {
  return db
    .select(packageColumns)
    .from(creditPackage)
    .where(and(eq(creditPackage.market, market.toUpperCase()), eq(creditPackage.active, true)))
    .orderBy(asc(creditPackage.sortOrder), asc(creditPackage.credits));
}

export interface PackageInput {
  id?: string;
  name: string;
  credits: number;
  priceCents: number;
  currency: PackageCurrency;
  market: string;
  active?: boolean;
  sortOrder?: number;
}

/** Cadastra ou atualiza um pacote (preço e créditos são dados da Galaxie, não código). */
export async function upsertPackage(db: Database, input: PackageInput): Promise<string> {
  if (!(input.credits > 0) || !(Number.isInteger(input.priceCents) && input.priceCents > 0))
    throw new CosmosError('invalid_amount', 'créditos e preço do pacote precisam ser maiores que 0');
  const values = {
    name: input.name,
    credits: ceilCredits(input.credits),
    priceCents: input.priceCents,
    currency: input.currency,
    market: input.market.toUpperCase(),
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
  };
  const [row] = input.id
    ? await db
        .insert(creditPackage)
        .values({ id: input.id, ...values })
        .onConflictDoUpdate({ target: creditPackage.id, set: { ...values, updatedAt: new Date() } })
        .returning({ id: creditPackage.id })
    : await db.insert(creditPackage).values(values).returning({ id: creditPackage.id });
  return row!.id;
}

/**
 * Cria a intenção de compra de um pacote ativo do mercado do cliente, copiando créditos e valor daquele
 * momento (mudar o pacote depois não muda o que foi comprado).
 */
export async function createPurchaseIntent(
  db: Database,
  input: { tenantId: string; packageId: string; market: string; userId?: string | null },
): Promise<{ id: string; package: CreditPackageView }> {
  const [pkg] = await db
    .select(packageColumns)
    .from(creditPackage)
    .where(
      and(
        eq(creditPackage.id, input.packageId),
        eq(creditPackage.active, true),
        eq(creditPackage.market, input.market.toUpperCase()),
      ),
    );
  if (!pkg) throw new CosmosError('unknown_package', 'pacote inexistente, inativo ou de outro mercado');
  const [row] = await db
    .insert(purchaseIntent)
    .values({
      tenantId: input.tenantId,
      packageId: pkg.id,
      credits: pkg.credits,
      amountCents: pkg.priceCents,
      currency: pkg.currency,
      userId: input.userId ?? null,
    })
    .returning({ id: purchaseIntent.id });
  return { id: row!.id, package: pkg };
}

/** Liga a sessão do Checkout à intenção (para achar a intenção pelo webhook). */
export async function attachCheckoutSession(
  db: Database,
  input: { tenantId: string; purchaseIntentId: string; checkoutSessionId: string },
): Promise<void> {
  await db
    .update(purchaseIntent)
    .set({ checkoutSessionId: input.checkoutSessionId, updatedAt: new Date() })
    .where(and(eq(purchaseIntent.id, input.purchaseIntentId), eq(purchaseIntent.tenantId, input.tenantId)));
}

/** Situação de uma intenção (a tela de "processando" pergunta até sair de `pending`). */
export async function getPurchaseIntent(db: Pick<Database, 'select'>, tenantId: string, id: string) {
  const [row] = await db
    .select({
      id: purchaseIntent.id,
      status: purchaseIntent.status,
      credits: purchaseIntent.credits,
      amountCents: purchaseIntent.amountCents,
      currency: purchaseIntent.currency,
      paidAt: purchaseIntent.paidAt,
      failureReason: purchaseIntent.failureReason,
      createdAt: purchaseIntent.createdAt,
    })
    .from(purchaseIntent)
    .where(and(eq(purchaseIntent.id, id), eq(purchaseIntent.tenantId, tenantId)));
  return row ?? null;
}

export type StripeEventOutcome =
  /** Já recebido antes (o Stripe reenviou): nada mudou. */
  | 'duplicate'
  | 'credited'
  /** Pix gerado, esperando o pagamento (o crédito vem no `async_payment_succeeded`). */
  | 'awaiting_payment'
  | 'failed'
  | 'expired'
  /** A intenção já estava fechada (paga por outro evento, por exemplo). */
  | 'already_closed'
  /** Sessão sem intenção da Cosmos (outro produto na mesma conta do Stripe). */
  | 'unknown_intent'
  /** Valor ou moeda diferentes do esperado: não credita. */
  | 'amount_mismatch'
  /** Tipo de evento que a Cosmos não usa. */
  | 'ignored';

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);

async function findIntent(tx: Tx, session: StripeCheckoutSession) {
  const id = session.metadata?.purchase_intent_id ?? session.client_reference_id ?? null;
  // valor que o Postgres não lê como uuid derrubaria a transação (500, o Stripe repetiria): fica unknown_intent
  if (!id || !isUuid(id)) return null;
  const [row] = await tx
    .select({
      id: purchaseIntent.id,
      tenantId: purchaseIntent.tenantId,
      status: purchaseIntent.status,
      credits: purchaseIntent.credits,
      amountCents: purchaseIntent.amountCents,
      currency: purchaseIntent.currency,
      checkoutSessionId: purchaseIntent.checkoutSessionId,
      userId: purchaseIntent.userId,
    })
    .from(purchaseIntent)
    .where(eq(purchaseIntent.id, id))
    .for('update');
  // a sessão tem de ser a que abrimos para esta intenção
  if (!row || (row.checkoutSessionId && row.checkoutSessionId !== session.id)) return null;
  return row;
}

/**
 * Aplica um evento do webhook (assinatura já conferida). Tudo numa transação: o registro do evento, a
 * mudança da intenção e o crédito. Se algo falhar, nada fica gravado e o Stripe tenta de novo.
 */
export async function applyStripeEvent(
  db: Database,
  event: StripeEvent,
  options: { now?: Date } = {},
): Promise<{ outcome: StripeEventOutcome; purchaseIntentId: string | null }> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(stripeEvent)
      .values({ id: event.id, type: event.type, outcome: 'processing', receivedAt: now })
      .onConflictDoNothing()
      .returning({ id: stripeEvent.id });
    if (!fresh) return { outcome: 'duplicate' as const, purchaseIntentId: null };

    const finish = async (outcome: StripeEventOutcome, purchaseIntentId: string | null) => {
      await tx.update(stripeEvent).set({ outcome, purchaseIntentId }).where(eq(stripeEvent.id, event.id));
      return { outcome, purchaseIntentId };
    };

    if (!HANDLED.has(event.type)) return finish('ignored', null);
    if (event.type.startsWith('payment_intent.')) {
      const r = await applyRechargeEvent(tx, event, now);
      return finish(r.outcome, r.rechargeAttemptId);
    }
    const session = event.data.object;
    const intent = await findIntent(tx, session);
    if (!intent) return finish('unknown_intent', null);
    if (intent.status !== 'pending') return finish('already_closed', intent.id);

    const close = (status: 'failed' | 'expired' | 'review', reason: string) =>
      tx
        .update(purchaseIntent)
        .set({ status, failureReason: reason, updatedAt: now })
        .where(eq(purchaseIntent.id, intent.id));

    if (event.type === 'checkout.session.expired') {
      await close('expired', 'checkout_expired');
      return finish('expired', intent.id);
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      await close('failed', 'payment_failed');
      return finish('failed', intent.id);
    }
    const paid =
      event.type === 'checkout.session.async_payment_succeeded' || session.payment_status === 'paid';
    if (!paid) {
      await tx
        .update(purchaseIntent)
        .set({ paymentIntentId: session.payment_intent ?? null, updatedAt: now })
        .where(eq(purchaseIntent.id, intent.id));
      return finish('awaiting_payment', intent.id);
    }
    // com conversão de moeda, o que vale é o valor de origem (o nosso preço); sem ela, o da sessão
    const conv = session.currency_conversion;
    const amount = conv?.amount_total ?? session.amount_total;
    const currency = (conv?.source_currency ?? session.currency)?.toLowerCase();
    if (amount !== intent.amountCents || currency !== intent.currency) {
      // o cliente pagou e o valor não bate: fica para a equipe revisar (tela das carteiras), nunca some calado
      console.error('[cosmos] compra paga com valor ou moeda diferentes da intenção', {
        purchaseIntentId: intent.id,
        expected: { amount: intent.amountCents, currency: intent.currency },
        received: { amount, currency: currency ?? null },
        stripeEventId: event.id,
      });
      await close('review', 'amount_mismatch');
      return finish('amount_mismatch', intent.id);
    }

    const { ledgerId } = await addEntryInTx(
      tx,
      {
        tenantId: intent.tenantId,
        kind: 'purchase',
        credits: intent.credits,
        userId: intent.userId,
        metadata: { purchase_intent_id: intent.id, stripe_event_id: event.id },
        // uma compra por intenção, venha o crédito de qual evento vier
        idempotencyKey: `purchase:${intent.id}`,
      },
      { now },
    );
    await tx
      .update(purchaseIntent)
      .set({
        status: 'paid',
        paidAt: now,
        ledgerId,
        checkoutSessionId: session.id,
        paymentIntentId: session.payment_intent ?? null,
        invoiceId: session.invoice ?? null,
        updatedAt: now,
      })
      .where(eq(purchaseIntent.id, intent.id));
    // compra com a recarga automática ligada: o cartão ficou salvo neste cliente do Stripe
    if (session.customer && session.metadata?.save_card === 'true')
      await tx
        .update(autoRecharge)
        .set({ stripeCustomerId: session.customer, updatedAt: now })
        .where(eq(autoRecharge.tenantId, intent.tenantId));
    return finish('credited', intent.id);
  });
}

/** Situação da recarga automática na lista de compras (mesma escala da compra avulsa). */
const RECHARGE_AS_PURCHASE = {
  pending: 'pending',
  processing: 'pending',
  succeeded: 'paid',
  failed: 'failed',
  cancelled: 'canceled',
} as const;

/**
 * Compras do tenant (mais nova primeiro), para a lista de compras e recibos da tela: as avulsas e as cobranças
 * da recarga automática (`auto: true`, sem recibo por e-mail: a cobrança é fora da sessão).
 */
export async function listPurchases(db: Pick<Database, 'select'>, tenantId: string, limit = 20) {
  const n = Math.min(Math.max(1, limit), 100);
  const [single, auto] = await Promise.all([
    db
      .select({
        id: purchaseIntent.id,
        status: purchaseIntent.status,
        credits: purchaseIntent.credits,
        amountCents: purchaseIntent.amountCents,
        currency: purchaseIntent.currency,
        createdAt: purchaseIntent.createdAt,
        paidAt: purchaseIntent.paidAt,
        hasReceipt: sql<boolean>`${purchaseIntent.invoiceId} is not null`,
      })
      .from(purchaseIntent)
      .where(eq(purchaseIntent.tenantId, tenantId))
      .orderBy(desc(purchaseIntent.id))
      .limit(n),
    db
      .select({
        id: rechargeAttempt.id,
        status: rechargeAttempt.status,
        credits: rechargeAttempt.credits,
        amountCents: rechargeAttempt.amountCents,
        currency: rechargeAttempt.currency,
        createdAt: rechargeAttempt.createdAt,
        updatedAt: rechargeAttempt.updatedAt,
      })
      .from(rechargeAttempt)
      .where(eq(rechargeAttempt.tenantId, tenantId))
      .orderBy(desc(rechargeAttempt.id))
      .limit(n),
  ]);
  return [
    ...single.map((p) => ({ ...p, auto: false })),
    ...auto.map((a) => ({
      id: a.id,
      status: RECHARGE_AS_PURCHASE[a.status],
      credits: a.credits,
      amountCents: a.amountCents,
      currency: a.currency,
      createdAt: a.createdAt,
      paidAt: a.status === 'succeeded' ? a.updatedAt : null,
      hasReceipt: false,
      auto: true,
    })),
  ]
    .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
    .slice(0, n);
}
