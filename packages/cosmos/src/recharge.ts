/**
 * Recarga automática (#994): opcional, com aceite explícito da cobrança recorrente. Quando o saldo livre passa
 * abaixo do limiar, o acerto abre uma tentativa (`evaluateBalance`); o job `cosmos-upkeep` cobra o cartão salvo
 * fora da sessão; o crédito entra pelo webhook `payment_intent.succeeded`. Falha de cobrança desliga a recarga
 * e registra o motivo, para o dono decidir.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { autoRecharge, creditPackage, rechargeAttempt } from '@galaxie/db/schema';
import { ceilCredits } from './credits.js';
import { isUuid } from './uuid.js';
import { CosmosError } from './errors.js';
import type { StripeEventOutcome } from './purchases.js';
import { chargeOffSession, StripeRequestError, type StripeEvent } from './stripe.js';
import { addEntryInTx, type Tx } from './wallet.js';

export interface AutoRechargeInput {
  tenantId: string;
  enabled: boolean;
  packageId: string;
  thresholdCredits: number;
  /** Aceite explícito da cobrança recorrente; sem ele, ligar é recusado. */
  accepted: boolean;
  userId: string;
}

export interface AutoRechargeView {
  enabled: boolean;
  packageId: string | null;
  thresholdCredits: number;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  /** Já tem cartão salvo (cliente do Stripe). */
  hasCard: boolean;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
}

export async function getAutoRecharge(
  db: Pick<Database, 'select'>,
  tenantId: string,
): Promise<AutoRechargeView | null> {
  const [row] = await db.select().from(autoRecharge).where(eq(autoRecharge.tenantId, tenantId));
  if (!row) return null;
  return {
    enabled: row.enabled,
    packageId: row.packageId,
    thresholdCredits: row.thresholdCredits,
    acceptedAt: row.acceptedAt,
    acceptedBy: row.acceptedBy,
    hasCard: Boolean(row.stripeCustomerId),
    lastFailureAt: row.lastFailureAt,
    lastFailureReason: row.lastFailureReason,
  };
}

/**
 * Liga, muda ou desliga a recarga automática. Ligar exige o aceite (`accepted: true`), que fica gravado com quem
 * e quando; desligar não precisa. O pacote tem de estar ativo.
 */
export async function configureAutoRecharge(
  db: Database,
  input: AutoRechargeInput,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  if (input.enabled && !input.accepted)
    throw new CosmosError(
      'consent_required',
      'a recarga automática precisa do aceite da cobrança recorrente',
    );
  if (!(input.thresholdCredits > 0) || !Number.isFinite(input.thresholdCredits))
    throw new CosmosError('invalid_amount', 'o limiar da recarga precisa ser maior que 0');
  const [pkg] = await db
    .select({ id: creditPackage.id })
    .from(creditPackage)
    .where(and(eq(creditPackage.id, input.packageId), eq(creditPackage.active, true)));
  if (!pkg) throw new CosmosError('unknown_package', 'pacote inexistente ou inativo');
  const values = {
    enabled: input.enabled,
    packageId: input.packageId,
    thresholdCredits: ceilCredits(input.thresholdCredits),
    ...(input.enabled
      ? { acceptedAt: now, acceptedBy: input.userId, lastFailureAt: null, lastFailureReason: null }
      : {}),
    updatedAt: now,
  };
  await db
    .insert(autoRecharge)
    .values({ tenantId: input.tenantId, ...values })
    .onConflictDoUpdate({ target: autoRecharge.tenantId, set: values });
}

/** Falha de cobrança: a tentativa falha, a recarga se desliga e o motivo fica para o dono ver. */
async function failRecharge(
  tx: Tx | Database,
  attemptId: string,
  tenantId: string,
  reason: string,
  now: Date,
) {
  await tx
    .update(rechargeAttempt)
    .set({ status: 'failed', failureReason: reason, updatedAt: now })
    .where(eq(rechargeAttempt.id, attemptId));
  await tx
    .update(autoRecharge)
    .set({ enabled: false, lastFailureAt: now, lastFailureReason: reason, updatedAt: now })
    .where(eq(autoRecharge.tenantId, tenantId));
}

/**
 * Cobra as tentativas pendentes (job `cosmos-upkeep`). Cada uma passa a `processing` antes de chamar o Stripe
 * (outro processo não pega a mesma); a chave de idempotência do Stripe impede cobrança dupla numa repetição.
 */
export async function processRecharges(
  db: Database,
  secretKey: string,
  options: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ charged: number; failed: number }> {
  const now = options.now ?? new Date();
  const pending = await db
    .select({
      id: rechargeAttempt.id,
      tenantId: rechargeAttempt.tenantId,
      amountCents: rechargeAttempt.amountCents,
      currency: rechargeAttempt.currency,
      credits: rechargeAttempt.credits,
      customerId: autoRecharge.stripeCustomerId,
    })
    .from(rechargeAttempt)
    .innerJoin(autoRecharge, eq(autoRecharge.tenantId, rechargeAttempt.tenantId))
    .where(eq(rechargeAttempt.status, 'pending'))
    .limit(options.limit ?? 50);
  let charged = 0;
  let failed = 0;
  for (const a of pending) {
    const [taken] = await db
      .update(rechargeAttempt)
      .set({ status: 'processing', updatedAt: now })
      .where(and(eq(rechargeAttempt.id, a.id), eq(rechargeAttempt.status, 'pending')))
      .returning({ id: rechargeAttempt.id });
    if (!taken) continue;
    if (!a.customerId) {
      await failRecharge(db, a.id, a.tenantId, 'no_card', now);
      failed += 1;
      continue;
    }
    try {
      const pi = await chargeOffSession(
        secretKey,
        {
          rechargeAttemptId: a.id,
          tenantId: a.tenantId,
          customerId: a.customerId,
          amountCents: a.amountCents,
          currency: a.currency,
          description: `Cosmos AI · recarga automática (${a.credits} créditos)`,
        },
        options.fetchImpl,
      );
      await db
        .update(rechargeAttempt)
        .set({ paymentIntentId: pi.paymentIntentId, updatedAt: now })
        .where(eq(rechargeAttempt.id, a.id));
      charged += 1;
    } catch (e) {
      const reason =
        e instanceof StripeRequestError
          ? ((e as StripeRequestError & { code?: string | undefined }).code ?? `stripe_${e.status}`)
          : 'stripe_unreachable';
      // rede fora: volta para a fila (a idempotência do Stripe cobre a repetição); recusa do cartão: falha
      if (!(e instanceof StripeRequestError)) {
        await db
          .update(rechargeAttempt)
          .set({ status: 'pending', updatedAt: now })
          .where(eq(rechargeAttempt.id, a.id));
        continue;
      }
      await failRecharge(db, a.id, a.tenantId, reason, now);
      failed += 1;
    }
  }
  return { charged, failed };
}

/** Evento `payment_intent.*` da recarga automática, dentro da transação do webhook. */
export async function applyRechargeEvent(
  tx: Tx,
  event: StripeEvent,
  now: Date,
): Promise<{ outcome: StripeEventOutcome; rechargeAttemptId: string | null }> {
  const pi = event.data.object;
  const id = pi.metadata?.recharge_attempt_id;
  if (!id || !isUuid(id)) return { outcome: 'unknown_intent', rechargeAttemptId: null };
  const [a] = await tx
    .select({
      id: rechargeAttempt.id,
      tenantId: rechargeAttempt.tenantId,
      status: rechargeAttempt.status,
      credits: rechargeAttempt.credits,
      amountCents: rechargeAttempt.amountCents,
      currency: rechargeAttempt.currency,
      paymentIntentId: rechargeAttempt.paymentIntentId,
    })
    .from(rechargeAttempt)
    .where(eq(rechargeAttempt.id, id))
    .for('update');
  if (!a || (a.paymentIntentId && a.paymentIntentId !== pi.id))
    return { outcome: 'unknown_intent', rechargeAttemptId: null };
  if (!['pending', 'processing'].includes(a.status))
    return { outcome: 'already_closed', rechargeAttemptId: a.id };

  if (event.type === 'payment_intent.payment_failed') {
    const reason = pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? 'payment_failed';
    await failRecharge(tx, a.id, a.tenantId, reason, now);
    return { outcome: 'failed', rechargeAttemptId: a.id };
  }
  const received = pi.amount_received ?? pi.amount ?? null;
  if (received !== a.amountCents || pi.currency?.toLowerCase() !== a.currency) {
    await failRecharge(tx, a.id, a.tenantId, 'amount_mismatch', now);
    return { outcome: 'amount_mismatch', rechargeAttemptId: a.id };
  }
  const { ledgerId } = await addEntryInTx(
    tx,
    {
      tenantId: a.tenantId,
      kind: 'purchase',
      credits: a.credits,
      metadata: { recharge_attempt_id: a.id, stripe_event_id: event.id, auto_recharge: true },
      idempotencyKey: `recharge:${a.id}`,
    },
    { now },
  );
  await tx
    .update(rechargeAttempt)
    .set({ status: 'succeeded', ledgerId, paymentIntentId: pi.id, updatedAt: now })
    .where(eq(rechargeAttempt.id, a.id));
  return { outcome: 'credited', rechargeAttemptId: a.id };
}

/** Tentativas abertas de um tenant (a tela mostra "recarga em andamento"). */
export async function openRecharges(db: Pick<Database, 'select'>, tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: rechargeAttempt.id })
    .from(rechargeAttempt)
    .where(
      and(eq(rechargeAttempt.tenantId, tenantId), inArray(rechargeAttempt.status, ['pending', 'processing'])),
    );
  return rows.length;
}
