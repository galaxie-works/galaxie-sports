/**
 * Dados das Carteiras da Cosmos para a equipe Galaxie (#1002), só no servidor e só para admin (as páginas chamam
 * `requireAdmin` antes). Aqui entra o que o cliente nunca vê: custo real, tokens, modelo, multiplicador e margem.
 */
import {
  getWallet,
  listAllPackages,
  listLedger,
  listPackages,
  listPurchases,
  listStaffActions,
  walletsOverview,
  type LedgerEntry,
  type WalletOverviewRow,
  type WalletView,
} from '@galaxie/cosmos';
import { readRuntimeOverrides } from '@galaxie/db/runtime-settings';
import { resolveSetting, settingDef } from '@galaxie/runtime-config';

import { builderDb } from '@/lib/builder/store';
import { isUuid } from '@/lib/client/tenants';

import { packageMarket } from './config';
import { people, type ClientPerson } from './data';
import { marginUsd } from './staff-data-utils';

export { marginUsd } from './staff-data-utils';

/** Cotação R$ por US$ para a margem (COSMOS_USD_BRL); null = sem cotação (margem em reais sem valor). */
export async function readUsdBrl(): Promise<number | null> {
  const overrides = await readRuntimeOverrides(builderDb());
  const value = resolveSetting(settingDef('COSMOS_USD_BRL')!, {
    overrides,
    env: (k) => process.env[k],
  }).value;
  const n = value === null ? NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface StaffWalletRow extends WalletOverviewRow {
  marginUsd: number | null;
}

export async function loadStaffWallets(): Promise<{
  rows: StaffWalletRow[];
  packages: Awaited<ReturnType<typeof listAllPackages>>;
  usdBrl: number | null;
}> {
  const db = builderDb();
  const [rows, packages, usdBrl] = await Promise.all([
    walletsOverview(db),
    listAllPackages(db),
    readUsdBrl(),
  ]);
  return { rows: rows.map((r) => ({ ...r, marginUsd: marginUsd(r, usdBrl) })), packages, usdBrl };
}

export interface StaffWalletDetail {
  tenant: WalletOverviewRow;
  wallet: WalletView;
  entries: (LedgerEntry & { person: ClientPerson | null })[];
  nextCursor: string | null;
  actions: (Awaited<ReturnType<typeof listStaffActions>>[number] & { person: ClientPerson | null })[];
  packages: Awaited<ReturnType<typeof listPackages>>;
  /** Pagas com valor ou moeda diferentes do esperado: sem crédito até a equipe resolver no Stripe. */
  review: Awaited<ReturnType<typeof listPurchases>>;
}

export async function loadStaffWallet(tenantId: string, cursor?: string): Promise<StaffWalletDetail | null> {
  const db = builderDb();
  const [wallet, all] = await Promise.all([getWallet(db, tenantId), walletsOverview(db)]);
  const tenant = all.find((r) => r.tenantId === tenantId);
  if (!wallet || !tenant) return null;
  const [page, actions, packages, purchases] = await Promise.all([
    listLedger(db, tenantId, { limit: 100, ...(cursor && isUuid(cursor) ? { cursor } : {}) }),
    listStaffActions(db, tenantId),
    listPackages(db, packageMarket(tenant.markets)),
    listPurchases(db, tenantId, 100),
  ]);
  const who = await people([...page.entries.map((e) => e.userId), ...actions.map((a) => a.userId)]);
  return {
    tenant,
    wallet,
    entries: page.entries.map((e) => ({ ...e, person: e.userId ? (who.get(e.userId) ?? null) : null })),
    nextCursor: page.nextCursor,
    actions: actions.map((a) => ({ ...a, person: who.get(a.userId) ?? null })),
    packages,
    review: purchases.filter((p) => p.status === 'review'),
  };
}
