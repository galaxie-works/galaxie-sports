/**
 * Ciclo de vida do saldo (#994): alertas de 80% e 90% e de saldo zerado, uma vez por limiar por ciclo; o
 * bloqueio por saldo zerado; e o gatilho da recarga automática. Roda dentro da transação que mexeu no
 * saldo (acerto de uso, vencimento do teste), com a carteira já travada.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { autoRecharge, balanceAlert, creditPackage, rechargeAttempt } from '@galaxie/db/schema';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const ALERT_LEVELS = [80, 90, 100] as const;
export type AlertLevel = 0 | (typeof ALERT_LEVELS)[number];

/** Limiar do saldo: 100 = zerado; 90/80 = uso do ciclo contra o saldo do começo do ciclo. */
export function alertLevelFor(available: number, cycleBase: number): AlertLevel {
  if (available <= 0) return 100;
  if (cycleBase <= 0) return 0;
  const used = 1 - available / cycleBase;
  if (used >= 0.9 - 1e-9) return 90;
  if (used >= 0.8 - 1e-9) return 80;
  return 0;
}

export interface BalanceState {
  tenantId: string;
  status: 'active' | 'blocked';
  cycleBase: number;
  cycleStartedAt: Date | null;
  alertLevel: number;
}

/** Colunas da carteira a gravar junto com o novo saldo. */
export interface BalanceUpdate {
  alertLevel?: number;
  status?: 'blocked';
  blockReason?: 'depleted';
}

/**
 * Avalia o saldo novo: registra o alerta do limiar cruzado (só subindo no ciclo, e o banco garante uma vez
 * por limiar por ciclo), bloqueia quando zera e abre a recarga automática quando passa abaixo do limiar.
 */
export async function evaluateBalance(
  tx: Tx,
  w: BalanceState,
  available: number,
  now: Date,
): Promise<BalanceUpdate> {
  const update: BalanceUpdate = {};
  const level = alertLevelFor(available, w.cycleBase);
  if (level > w.alertLevel) {
    update.alertLevel = level;
    await tx
      .insert(balanceAlert)
      .values({
        tenantId: w.tenantId,
        level,
        cycleStartedAt: w.cycleStartedAt ?? new Date(0),
        available,
        cycleBase: w.cycleBase,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  if (available <= 0 && w.status === 'active') {
    update.status = 'blocked';
    update.blockReason = 'depleted';
  }

  // recarga automática: só com aceite, cliente do Stripe e pacote; uma tentativa aberta por vez (índice parcial)
  const [ar] = await tx
    .select({
      threshold: autoRecharge.thresholdCredits,
      packageId: autoRecharge.packageId,
      credits: creditPackage.credits,
      priceCents: creditPackage.priceCents,
      currency: creditPackage.currency,
      packageActive: creditPackage.active,
    })
    .from(autoRecharge)
    .innerJoin(creditPackage, eq(creditPackage.id, autoRecharge.packageId))
    .where(
      and(
        eq(autoRecharge.tenantId, w.tenantId),
        eq(autoRecharge.enabled, true),
        isNotNull(autoRecharge.acceptedAt),
        isNotNull(autoRecharge.stripeCustomerId),
      ),
    );
  if (ar && ar.packageActive && available < ar.threshold) {
    await tx
      .insert(rechargeAttempt)
      .values({
        tenantId: w.tenantId,
        packageId: ar.packageId,
        credits: ar.credits,
        amountCents: ar.priceCents,
        currency: ar.currency,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  return update;
}
