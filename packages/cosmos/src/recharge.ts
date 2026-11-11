/**
 * Recarga automática (#994): opcional, com aceite explícito da cobrança recorrente. Quando o saldo livre passa
 * abaixo do limiar, o acerto abre uma tentativa (`evaluateBalance`); o job `cosmos-upkeep` cobra o cartão salvo
 * fora da sessão; o crédito entra pelo webhook `payment_intent.succeeded`. Recusa definitiva do cartão desliga a
 * recarga e registra o motivo, para o dono decidir; falha passageira do Stripe volta a tentativa para a fila.
 */
import { and, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { autoRecharge, creditPackage, rechargeAttempt, wallet } from '@galaxie/db/schema';
import { canRecharge } from './balance.js';
import { ceilCredits } from './credits.js';
import { isUuid } from './uuid.js';
import { CosmosError } from './errors.js';
import type { StripeEventOutcome } from './purchases.js';
import {
  chargeOffSession,
  defaultCardOf,
  getPaymentIntent,
  isDefinitiveDecline,
  isOurStripeProblem,
  type StripeRequestError,
  type StripeEvent,
} from './stripe.js';
import { addEntryInTx, type Tx } from './wallet.js';

export interface AutoRechargeInput {
  tenantId: string;
  enabled: boolean;
  /** Obrigatório para ligar; ao desligar, pode faltar (o pacote pode ter sido desativado). */
  packageId?: string | null;
  /** Obrigatório para ligar; menor que os créditos do pacote (senão a recarga dispararia em laço). */
  thresholdCredits?: number | null;
  /** Aceite explícito da cobrança recorrente; sem ele, ligar é recusado. */
  accepted: boolean;
  userId: string;
  /** Mercado do tenant: o pacote tem de ser dele, como na compra avulsa. */
  market?: string | null;
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
 * A tentativa ainda não falou com o Stripe: nenhuma chamada de cobrança com falha passageira (`attempts`) e nenhum
 * PaymentIntent gravado. Só essa pode ser cancelada sem risco. A que já chamou o Stripe pode ter criado o
 * pagamento; cancelá-la liberaria o "uma aberta por vez" para uma segunda cobrança. Ela segue com a mesma chave de
 * idempotência (ou o webhook a resolve).
 */
const untouched = and(eq(rechargeAttempt.attempts, 0), isNull(rechargeAttempt.paymentIntentId));

const isUntouched = (a: { attempts: number; paymentIntentId: string | null }) =>
  a.attempts === 0 && !a.paymentIntentId;

async function cancelUntouched(
  db: Tx | Database,
  scope: SQL | undefined,
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(rechargeAttempt)
    .set({ status: 'cancelled', failureReason: reason, updatedAt: now })
    .where(and(scope, eq(rechargeAttempt.status, 'pending'), untouched))
    .returning({ id: rechargeAttempt.id });
  return rows.length;
}

/**
 * Encerra as tentativas pendentes do tenant que ainda não falaram com o Stripe. A que já está no Stripe
 * (`processing`) segue, e o resultado chega pelo webhook; a que voltou para a fila depois de chamar o Stripe
 * (falha passageira) também segue, com a mesma chave de idempotência, para não abrir uma segunda cobrança.
 */
export async function cancelPendingRecharges(
  db: Tx | Database,
  tenantId: string,
  reason: string,
  now: Date = new Date(),
): Promise<number> {
  return cancelUntouched(db, eq(rechargeAttempt.tenantId, tenantId), reason, now);
}

/** O mesmo, para as tentativas de um pacote (preço, moeda ou créditos mudaram: exigem novo aceite). */
export async function cancelPendingRechargesOfPackage(
  db: Tx | Database,
  packageId: string,
  reason: string,
  now: Date = new Date(),
): Promise<number> {
  return cancelUntouched(db, eq(rechargeAttempt.packageId, packageId), reason, now);
}

/**
 * Liga, muda ou desliga a recarga automática. Ligar exige o aceite (`accepted: true`), que fica gravado com quem
 * e quando, um pacote ativo do mercado do tenant e um limiar abaixo dos créditos do pacote. Desligar não exige
 * nada. Qualquer mudança encerra a tentativa pendente que ainda não falou com o Stripe: a próxima abre com a
 * configuração nova.
 */
export async function configureAutoRecharge(
  db: Database,
  input: AutoRechargeInput,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  if (!input.enabled) {
    await db.transaction(async (tx) => {
      await tx
        .update(autoRecharge)
        .set({ enabled: false, updatedAt: now })
        .where(eq(autoRecharge.tenantId, input.tenantId));
      await cancelPendingRecharges(tx, input.tenantId, 'disabled', now);
    });
    return;
  }
  if (!input.accepted)
    throw new CosmosError(
      'consent_required',
      'a recarga automática precisa do aceite da cobrança recorrente',
    );
  const threshold = input.thresholdCredits ?? 0;
  if (!(threshold > 0) || !Number.isFinite(threshold))
    throw new CosmosError('invalid_amount', 'o limiar da recarga precisa ser maior que 0');
  if (!input.packageId || !isUuid(input.packageId))
    throw new CosmosError('unknown_package', 'pacote inexistente ou inativo');
  const [pkg] = await db
    .select({ id: creditPackage.id, credits: creditPackage.credits, market: creditPackage.market })
    .from(creditPackage)
    .where(and(eq(creditPackage.id, input.packageId), eq(creditPackage.active, true)));
  if (!pkg || (input.market && pkg.market !== input.market))
    throw new CosmosError('unknown_package', 'pacote inexistente, inativo ou de outro mercado');
  if (ceilCredits(threshold) >= pkg.credits)
    throw new CosmosError(
      'invalid_amount',
      'o limiar da recarga precisa ficar abaixo dos créditos do pacote',
    );
  const values = {
    enabled: true,
    packageId: input.packageId,
    thresholdCredits: ceilCredits(threshold),
    acceptedAt: now,
    acceptedBy: input.userId,
    lastFailureAt: null,
    lastFailureReason: null,
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(autoRecharge)
      .values({ tenantId: input.tenantId, ...values })
      .onConflictDoUpdate({ target: autoRecharge.tenantId, set: values });
    await cancelPendingRecharges(tx, input.tenantId, 'reconfigured', now);
  });
}

/** Recusa definitiva: a tentativa falha, a recarga se desliga e o motivo fica para o dono ver. */
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

/** Volta para a fila sem contar tentativa (falha da nossa configuração, não do Stripe nem do cliente). */
async function backToQueue(db: Database, attemptId: string, now: Date): Promise<'requeued' | 'skipped'> {
  const [row] = await db
    .update(rechargeAttempt)
    .set({ status: 'pending', updatedAt: now })
    .where(and(eq(rechargeAttempt.id, attemptId), eq(rechargeAttempt.status, 'processing')))
    .returning({ id: rechargeAttempt.id });
  return row ? 'requeued' : 'skipped';
}

/** Teto de falhas passageiras (5xx, 409, 429, rede) da mesma tentativa. */
export const MAX_RECHARGE_ATTEMPTS = 5;

/**
 * Falha passageira: volta para a fila, só se ainda estiver em `processing`. No teto de tentativas, falha e desliga
 * a recarga com o motivo (a tela mostra), para não ficar "ligada" sem nunca cobrar.
 */
async function requeue(
  db: Database,
  attemptId: string,
  tenantId: string,
  now: Date,
): Promise<'requeued' | 'failed' | 'skipped'> {
  // uma escrita só, condicionada a processing: o webhook ou outro processo que mexeu no meio não é sobrescrito
  const capped = sql`${rechargeAttempt.attempts} + 1 >= ${MAX_RECHARGE_ATTEMPTS}`;
  const [row] = await db
    .update(rechargeAttempt)
    .set({
      attempts: sql`${rechargeAttempt.attempts} + 1`,
      status: sql`case when ${capped} then 'failed'::cosmos.recharge_status else 'pending'::cosmos.recharge_status end`,
      failureReason: sql`case when ${capped} then 'stripe_unavailable' else ${rechargeAttempt.failureReason} end`,
      updatedAt: now,
    })
    .where(and(eq(rechargeAttempt.id, attemptId), eq(rechargeAttempt.status, 'processing')))
    .returning({ status: rechargeAttempt.status });
  if (!row) return 'skipped';
  if (row.status === 'failed') {
    await db
      .update(autoRecharge)
      .set({ enabled: false, lastFailureAt: now, lastFailureReason: 'stripe_unavailable', updatedAt: now })
      .where(eq(autoRecharge.tenantId, tenantId));
    return 'failed';
  }
  return 'requeued';
}

/**
 * Ainda pode cobrar (condição para tirar a tentativa da fila): a recarga do tenant segue ligada e aceita, e a
 * carteira segue com a Cosmos ligada e sem bloqueio da equipe (o mesmo que `canRecharge`).
 */
const stillChargeable = sql`exists (
  select 1 from ${autoRecharge}
  where ${autoRecharge.tenantId} = ${rechargeAttempt.tenantId}
    and ${autoRecharge.enabled} = true
    and ${autoRecharge.acceptedAt} is not null
) and exists (
  select 1 from ${wallet}
  where ${wallet.tenantId} = ${rechargeAttempt.tenantId}
    and ${wallet.enabled} = true
    and not (${wallet.status} = 'blocked' and coalesce(${wallet.blockReason}, '') = 'staff')
)`;

/**
 * Por quanto tempo uma tentativa que já falou com o Stripe, mas não pode mais cobrar (aceite retirado, Cosmos
 * desligada, bloqueio da equipe), fica pendente esperando o webhook antes de ser encerrada. É a janela em que o
 * Stripe guarda a chave de idempotência; se o pagamento tiver sido criado, o webhook credita mesmo depois.
 */
export const RECHARGE_REPLAY_WINDOW_MS = 24 * 60 * 60_000;

const declineReason = (e: unknown) =>
  (e as StripeRequestError & { code?: string | undefined }).code ??
  `stripe_${(e as StripeRequestError).status}`;

/**
 * Tentativa que não pode mais cobrar: a que ainda não falou com o Stripe é encerrada na hora; a que já falou fica
 * pendente (sem cobrar) até o webhook resolver ou passar a janela da chave de idempotência.
 */
async function closeUnchargeable(
  db: Database,
  a: { id: string; tenantId: string; attempts: number; paymentIntentId: string | null; updatedAt: Date },
  reason: string,
  now: Date,
): Promise<number> {
  if (isUntouched(a)) return cancelPendingRecharges(db, a.tenantId, reason, now);
  if (a.updatedAt.getTime() > now.getTime() - RECHARGE_REPLAY_WINDOW_MS) return 0;
  const rows = await db
    .update(rechargeAttempt)
    .set({ status: 'cancelled', failureReason: reason, updatedAt: now })
    .where(and(eq(rechargeAttempt.id, a.id), eq(rechargeAttempt.status, 'pending')))
    .returning({ id: rechargeAttempt.id });
  return rows.length;
}

/**
 * Cobra as tentativas pendentes (job `cosmos-upkeep`). Cada uma passa a `processing` antes de chamar o Stripe
 * (outro processo não pega a mesma), e só com a recarga ainda ligada e aceita e a carteira ligada e sem bloqueio
 * da equipe; sem isso, a tentativa é encerrada (ou, se já falou com o Stripe, espera o webhook sem cobrar).
 * A chave de idempotência do Stripe é a tentativa, e cliente e cartão ficam gravados nela: a repetição manda os
 * mesmos parâmetros e não cobra duas vezes.
 */
export async function processRecharges(
  db: Database,
  secretKey: string,
  options: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ charged: number; failed: number; cancelled: number; requeued: number }> {
  const now = options.now ?? new Date();
  const replayCutoff = new Date(now.getTime() - RECHARGE_REPLAY_WINDOW_MS);
  const pending = await db
    .select({
      id: rechargeAttempt.id,
      tenantId: rechargeAttempt.tenantId,
      amountCents: rechargeAttempt.amountCents,
      currency: rechargeAttempt.currency,
      credits: rechargeAttempt.credits,
      attempts: rechargeAttempt.attempts,
      paymentIntentId: rechargeAttempt.paymentIntentId,
      updatedAt: rechargeAttempt.updatedAt,
      attemptCustomerId: rechargeAttempt.stripeCustomerId,
      paymentMethodId: rechargeAttempt.paymentMethodId,
      customerId: autoRecharge.stripeCustomerId,
      enabled: autoRecharge.enabled,
      acceptedAt: autoRecharge.acceptedAt,
      walletEnabled: wallet.enabled,
      walletStatus: wallet.status,
      walletBlockReason: wallet.blockReason,
    })
    .from(rechargeAttempt)
    .leftJoin(autoRecharge, eq(autoRecharge.tenantId, rechargeAttempt.tenantId))
    .leftJoin(wallet, eq(wallet.tenantId, rechargeAttempt.tenantId))
    .where(
      and(
        eq(rechargeAttempt.status, 'pending'),
        // a que já falou com o Stripe e não pode cobrar espera o webhook: fora da leitura até a janela passar
        or(stillChargeable, untouched, lt(rechargeAttempt.updatedAt, replayCutoff)),
      ),
    )
    .limit(options.limit ?? 20);
  const result = { charged: 0, failed: 0, cancelled: 0, requeued: 0 };
  for (const a of pending) {
    const consented = Boolean(a.enabled && a.acceptedAt);
    const walletOk =
      a.walletEnabled !== null &&
      a.walletStatus !== null &&
      canRecharge({ enabled: a.walletEnabled, status: a.walletStatus, blockReason: a.walletBlockReason });
    if (!consented || !walletOk) {
      const reason = !consented ? 'consent_revoked' : a.walletEnabled ? 'wallet_blocked' : 'cosmos_disabled';
      result.cancelled += await closeUnchargeable(db, a, reason, now);
      continue;
    }
    const [taken] = await db
      .update(rechargeAttempt)
      .set({ status: 'processing', updatedAt: now })
      .where(and(eq(rechargeAttempt.id, a.id), eq(rechargeAttempt.status, 'pending'), stillChargeable))
      .returning({ id: rechargeAttempt.id });
    if (!taken) {
      // desligada ou bloqueada entre a leitura e a vez desta tentativa (ou outro processo já pegou)
      result.cancelled += await closeUnchargeable(db, a, 'consent_revoked', now);
      continue;
    }
    const customerId = a.attemptCustomerId ?? a.customerId;
    if (!customerId) {
      await failRecharge(db, a.id, a.tenantId, 'no_card', now);
      result.failed += 1;
      continue;
    }
    try {
      let paymentMethodId = a.paymentMethodId;
      if (!paymentMethodId) {
        paymentMethodId = await defaultCardOf(secretKey, customerId, options.fetchImpl);
        if (!paymentMethodId) {
          await failRecharge(db, a.id, a.tenantId, 'no_card', now);
          result.failed += 1;
          continue;
        }
        await db
          .update(rechargeAttempt)
          .set({ stripeCustomerId: customerId, paymentMethodId, updatedAt: now })
          .where(eq(rechargeAttempt.id, a.id));
      }
      const pi = await chargeOffSession(
        secretKey,
        {
          rechargeAttemptId: a.id,
          tenantId: a.tenantId,
          customerId,
          paymentMethodId,
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
      result.charged += 1;
    } catch (e) {
      if (isDefinitiveDecline(e)) {
        await failRecharge(db, a.id, a.tenantId, declineReason(e), now);
        result.failed += 1;
      } else {
        // chave ou endpoint errados são nossos: erro no log, e a tentativa segue na fila sem desligar a recarga
        if (isOurStripeProblem(e))
          console.error('[cosmos] Stripe recusou a nossa chamada da recarga (chave ou endpoint)', {
            rechargeAttemptId: a.id,
            status: (e as StripeRequestError).status,
          });
        // 5xx, 409, 429, rede ou problema nosso: o pagamento pode ter sido criado; repete com a mesma chave e os
        // mesmos parâmetros. Problema nosso não conta tentativa: chave errada não pode levar ao teto e desligar a
        // recarga de todos os tenants
        const r = isOurStripeProblem(e)
          ? await backToQueue(db, a.id, now)
          : await requeue(db, a.id, a.tenantId, now);
        if (r === 'failed') result.failed += 1;
        else if (r === 'requeued') result.requeued += 1;
      }
    }
  }
  return result;
}

/** Tentativa parada em `processing` há mais que isto é conciliada no Stripe. */
export const STUCK_RECHARGE_MS = 15 * 60_000;

/**
 * Concilia as tentativas presas em `processing` (o processo morreu no meio da cobrança), para o índice "uma
 * aberta por vez" não travar a recarga do tenant. Sem PaymentIntent gravado, volta para a fila: a repetição usa a
 * mesma chave de idempotência e devolve o pagamento já criado, se houver. Com PaymentIntent, lê o estado no
 * Stripe: recusado ou cancelado falha; pago ou em andamento espera o webhook.
 */
export async function reconcileStuckRecharges(
  db: Database,
  secretKey: string,
  options: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ requeued: number; failed: number }> {
  const now = options.now ?? new Date();
  const stuck = await db
    .select({
      id: rechargeAttempt.id,
      tenantId: rechargeAttempt.tenantId,
      paymentIntentId: rechargeAttempt.paymentIntentId,
    })
    .from(rechargeAttempt)
    .where(
      and(
        eq(rechargeAttempt.status, 'processing'),
        lt(rechargeAttempt.updatedAt, new Date(now.getTime() - STUCK_RECHARGE_MS)),
      ),
    )
    .limit(options.limit ?? 20);
  const result = { requeued: 0, failed: 0 };
  for (const a of stuck) {
    if (!a.paymentIntentId) {
      const r = await requeue(db, a.id, a.tenantId, now);
      if (r === 'failed') result.failed += 1;
      else if (r === 'requeued') result.requeued += 1;
      continue;
    }
    try {
      const pi = await getPaymentIntent(secretKey, a.paymentIntentId, options.fetchImpl);
      if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
        await failRecharge(db, a.id, a.tenantId, `payment_${pi.status}`, now);
        result.failed += 1;
      } else {
        // pago ou em andamento: o webhook resolve; só marca que foi conferida agora
        await db
          .update(rechargeAttempt)
          .set({ updatedAt: now })
          .where(and(eq(rechargeAttempt.id, a.id), eq(rechargeAttempt.status, 'processing')));
      }
    } catch {
      // Stripe fora: confere de novo na próxima rodada
    }
  }
  return result;
}

/**
 * Evento `payment_intent.*` da recarga automática, dentro da transação do webhook. Pagamento confirmado com o
 * valor e a moeda da tentativa credita mesmo que ela tenha sido marcada `failed` ou `cancelled` antes (o cliente
 * pagou); a chave `recharge:<id>` impede creditar duas vezes.
 */
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
  if (a.status === 'succeeded' || a.status === 'review')
    return { outcome: 'already_closed', rechargeAttemptId: a.id };

  if (event.type === 'payment_intent.payment_failed') {
    if (!['pending', 'processing'].includes(a.status))
      return { outcome: 'already_closed', rechargeAttemptId: a.id };
    const reason = pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? 'payment_failed';
    await failRecharge(tx, a.id, a.tenantId, reason, now);
    return { outcome: 'failed', rechargeAttemptId: a.id };
  }
  const received = pi.amount_received ?? pi.amount ?? null;
  if (received !== a.amountCents || pi.currency?.toLowerCase() !== a.currency) {
    console.error('[cosmos] recarga paga com valor ou moeda diferentes da tentativa', {
      rechargeAttemptId: a.id,
      expected: { amount: a.amountCents, currency: a.currency },
      received: { amount: received, currency: pi.currency ?? null },
    });
    // o cliente pagou: fica para a equipe revisar (não some como falha); a recarga se desliga até lá
    await failRecharge(tx, a.id, a.tenantId, 'amount_mismatch', now);
    await tx
      .update(rechargeAttempt)
      .set({ status: 'review', paymentIntentId: pi.id, updatedAt: now })
      .where(eq(rechargeAttempt.id, a.id));
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
    .set({ status: 'succeeded', ledgerId, paymentIntentId: pi.id, failureReason: null, updatedAt: now })
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
