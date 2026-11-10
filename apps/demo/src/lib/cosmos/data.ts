/**
 * Dados da área da Cosmos AI no painel do cliente (só no servidor). Tudo filtrado pelo tenant da sessão, e
 * nada do que é só da Galaxie sai daqui: sem tokens, custo real, modelo nem multiplicador (#995).
 */
import {
  getAutoRecharge,
  getWallet,
  listLedger,
  listPackages,
  listPurchases,
  readTrialSettings,
  toClientEntry,
  toClientWallet,
  usageBreakdown,
  usageByDay,
  type AutoRechargeView,
  type ClientLedgerEntry,
  type CreditPackageView,
  type UsageSlice,
} from '@galaxie/cosmos';
import { LEDGER_KINDS, type LedgerKind } from '@galaxie/db/schema';

import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';

import { packageMarket } from './config';
import { DAY, fillDays, periodFrom, type StatementParams } from './data-utils';

export { DEFAULT_PERIOD_DAYS, type StatementParams } from './data-utils';

export interface ClientPerson {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export async function people(ids: readonly (string | null)[]): Promise<Map<string, ClientPerson>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const { rows } = await pool.query<ClientPerson>(
    'select id, name, email, image from "user" where id = any($1::text[])',
    [wanted],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export interface CosmosOverviewData {
  wallet: ReturnType<typeof toClientWallet> | null;
  trial: { credits: number; days: number };
  packages: CreditPackageView[];
  autoRecharge: AutoRechargeView | null;
  /** Créditos usados por dia nos últimos 7 dias (dia UTC, AAAA-MM-DD), com os dias sem uso. */
  week: { day: string; credits: number }[];
}

export async function loadCosmosOverview(
  tenant: { id: string; markets: readonly string[] },
  now: Date = new Date(),
): Promise<CosmosOverviewData> {
  const db = builderDb();
  const week = periodFrom({}, now);
  week.from = new Date(week.to.getTime() - 7 * DAY);
  const [wallet, trial, packages, autoRecharge, days] = await Promise.all([
    getWallet(db, tenant.id),
    readTrialSettings(db),
    listPackages(db, packageMarket(tenant.markets)),
    getAutoRecharge(db, tenant.id),
    usageByDay(db, tenant.id, week),
  ]);
  return {
    wallet: wallet ? toClientWallet(wallet) : null,
    trial,
    packages,
    autoRecharge,
    week: fillDays(days, week.from, week.to),
  };
}

export interface CosmosStatementData {
  period: { from: string; to: string };
  daily: { day: string; credits: number }[];
  entries: (ClientLedgerEntry & { person: ClientPerson | null })[];
  nextCursor: string | null;
  byUser: (UsageSlice & { person: ClientPerson | null })[];
  byFunction: UsageSlice[];
  /** Opções dos filtros: as funções e salas que apareceram no período. */
  functions: string[];
  scopes: string[];
  purchases: Awaited<ReturnType<typeof listPurchases>>;
}

const isKind = (v: string): v is LedgerKind => (LEDGER_KINDS as readonly string[]).includes(v);

export async function loadCosmosStatement(
  tenantId: string,
  params: StatementParams,
  now: Date = new Date(),
): Promise<CosmosStatementData> {
  const db = builderDb();
  const period = periodFrom(params, now);
  const [days, page, breakdown, purchases] = await Promise.all([
    usageByDay(db, tenantId, period),
    listLedger(db, tenantId, {
      from: period.from,
      to: period.to,
      kinds: (params.kind ?? []).filter(isKind),
      functionNames: params.fn ?? [],
      scopes: params.scope ?? [],
      ...(params.cursor ? { cursor: params.cursor } : {}),
      limit: 50,
    }),
    usageBreakdown(db, tenantId, period),
    listPurchases(db, tenantId),
  ]);
  const who = await people([...page.entries.map((e) => e.userId), ...breakdown.byUser.map((u) => u.key)]);
  return {
    period: {
      from: period.from.toISOString().slice(0, 10),
      to: new Date(period.to.getTime() - DAY).toISOString().slice(0, 10),
    },
    daily: fillDays(days, period.from, period.to),
    entries: page.entries.map((e) => ({
      ...toClientEntry(e),
      person: e.userId ? (who.get(e.userId) ?? null) : null,
    })),
    nextCursor: page.nextCursor,
    byUser: breakdown.byUser.map((u) => ({ ...u, person: u.key ? (who.get(u.key) ?? null) : null })),
    byFunction: breakdown.byFunction,
    functions: breakdown.byFunction.flatMap((f) => (f.key ? [f.key] : [])),
    scopes: breakdown.byScope.flatMap((s) => (s.key ? [s.key] : [])),
    purchases,
  };
}
