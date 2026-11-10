/**
 * Ligar a Cosmos e o vencimento do teste (#994). Ao ligar pela primeira vez, o tenant ganha os créditos de
 * teste uma única vez (padrão 250, válidos por 90 dias, ambos em runtime_setting); desligar e religar não dá
 * outro teste. Créditos comprados não vencem. O que sobrar do teste no vencimento sai do saldo com um
 * lançamento `trial_expiry` no extrato.
 */
import { and, eq, gt, lte } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { readRuntimeOverrides } from '@galaxie/db/runtime-settings';
import { wallet } from '@galaxie/db/schema';
import { resolveSetting, settingDef, validateSettingKey } from '@galaxie/runtime-config';
import { roundCredits } from './credits.js';
import { CosmosError } from './errors.js';
import { cancelPendingRecharges } from './recharge.js';
import { addEntryInTx, ensureWallet, getWallet, type WalletView } from './wallet.js';

export interface TrialSettings {
  credits: number;
  days: number;
}

/** Flags do teste pelo registro do painel (banco > env > padrão). */
export async function readTrialSettings(
  db: Pick<Database, 'select'>,
  env: Record<string, string | undefined> = process.env,
): Promise<TrialSettings> {
  const overrides = await readRuntimeOverrides(db);
  const value = (key: string) => {
    const resolved = resolveSetting(settingDef(key)!, {
      overrides,
      env: (k) => {
        const raw = env[k]?.trim();
        return raw && validateSettingKey(k, raw).ok ? raw : undefined;
      },
    });
    return Number(resolved.value ?? resolved.defaultValue);
  };
  return { credits: value('COSMOS_TRIAL_CREDITS'), days: value('COSMOS_TRIAL_DAYS') };
}

/**
 * Liga a Cosmos do tenant: cria a carteira e concede o teste se ainda não foi concedido. Idempotente: chamar
 * de novo (ou religar) só devolve a carteira.
 */
export async function enableCosmos(
  db: Database,
  tenantId: string,
  options: { trial?: TrialSettings; now?: Date; userId?: string | null } = {},
): Promise<{ wallet: WalletView; trialGranted: boolean }> {
  const now = options.now ?? new Date();
  let existing = (await getWallet(db, tenantId)) ?? (await ensureWallet(db, tenantId));
  if (!existing.enabled) {
    await db.update(wallet).set({ enabled: true, updatedAt: now }).where(eq(wallet.tenantId, tenantId));
    existing = { ...existing, enabled: true };
  }
  if (existing.trialGranted) return { wallet: existing, trialGranted: false };
  const trial = options.trial ?? (await readTrialSettings(db));
  try {
    await db.transaction((tx) =>
      addEntryInTx(
        tx,
        {
          tenantId,
          kind: 'trial',
          credits: trial.credits,
          userId: options.userId ?? null,
          trialExpiresAt: new Date(now.getTime() + trial.days * 86_400_000),
          metadata: { trial_days: trial.days },
        },
        { now },
      ),
    );
  } catch (e) {
    // outro pedido concedeu no meio: fica o dele
    if (!(e instanceof CosmosError && e.code === 'trial_already_granted')) throw e;
    return { wallet: (await getWallet(db, tenantId))!, trialGranted: false };
  }
  return { wallet: (await getWallet(db, tenantId))!, trialGranted: true };
}

/**
 * Tira do saldo o que sobrou dos testes vencidos (job `cosmos-upkeep`). Sai no máximo o saldo livre; a parte do
 * teste que estava reservada fica marcada e sai numa rodada seguinte, se a reserva voltar para o saldo. Devolve
 * quantas carteiras tiveram teste vencido nesta rodada.
 */
export async function expireTrials(db: Database, now: Date = new Date(), limit = 200): Promise<number> {
  const due = await db
    .select({ tenantId: wallet.tenantId })
    .from(wallet)
    .where(and(gt(wallet.trialRemaining, 0), lte(wallet.trialExpiresAt, now)))
    .limit(limit);
  let expired = 0;
  for (const { tenantId } of due) {
    const done = await db.transaction(async (tx) => {
      const [w] = await tx
        .select({
          available: wallet.available,
          reserved: wallet.reserved,
          trialRemaining: wallet.trialRemaining,
          expiresAt: wallet.trialExpiresAt,
        })
        .from(wallet)
        .where(
          and(eq(wallet.tenantId, tenantId), gt(wallet.trialRemaining, 0), lte(wallet.trialExpiresAt, now)),
        )
        .for('update');
      if (!w) return false;
      const out = roundCredits(Math.min(w.trialRemaining, w.available));
      if (out > 0)
        await addEntryInTx(
          tx,
          {
            tenantId,
            kind: 'trial_expiry',
            credits: -out,
            metadata: { trial_expired_at: w.expiresAt?.toISOString() ?? null },
          },
          { now },
        );
      // sem reserva aberta, o que não saiu agora não volta mais: o teste zera. Com reserva, a parte do teste que
      // estava nela fica em trialRemaining e sai na próxima rodada, se voltar para o saldo (release)
      if (w.reserved <= 0)
        await tx
          .update(wallet)
          .set({ trialRemaining: 0, updatedAt: now })
          .where(eq(wallet.tenantId, tenantId));
      return out > 0 || w.reserved <= 0;
    });
    if (done) expired += 1;
  }
  return expired;
}

/**
 * Desliga a Cosmos do tenant: nenhuma função reserva mais e a recarga pendente é encerrada (não cobra com a
 * Cosmos desligada); o saldo, o teste, o extrato e a configuração da recarga ficam.
 */
export async function disableCosmos(db: Database, tenantId: string): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(wallet).set({ enabled: false, updatedAt: now }).where(eq(wallet.tenantId, tenantId));
    await cancelPendingRecharges(tx, tenantId, 'cosmos_disabled', now);
  });
}
