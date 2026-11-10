/**
 * Carteiras da Cosmos para a equipe Galaxie (#1002): a visão de todos os tenants (saldo, consumo, custo real,
 * receita, estado, última compra) e as ações com motivo obrigatório e registro. Ajuste e estorno vão para o extrato
 * (`adjustment`/`refund`, com quem e o motivo no lançamento); multiplicador, bloqueio e pacotes vão para
 * `cosmos.staff_action`, com o antes e o depois. Nada disto chega ao cliente.
 *
 * Fica separado do orçamento da IA interna (agentes de cenário, resumo, onde assistir), que segue no TokenBudget com
 * o limite diário próprio: aqui só se lê e se escreve o schema `cosmos`.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { creditPackage, ledger, purchaseIntent, staffAction, tenant, wallet } from '@galaxie/db/schema';
import { CosmosError } from './errors.js';
import { upsertPackage, type PackageInput } from './purchases.js';
import { addEntry } from './wallet.js';

/** Motivo de toda ação da equipe: obrigatório, com pelo menos 5 caracteres (o banco confere também). */
export const STAFF_REASON_MIN = 5;

function reasonOf(reason: string): string {
  const r = reason.trim();
  if (r.length < STAFF_REASON_MIN) throw new CosmosError('reason_required', 'a ação precisa de um motivo');
  return r;
}

export interface WalletOverviewRow {
  tenantId: string;
  name: string;
  slug: string;
  markets: string[];
  status: 'active' | 'blocked';
  blockReason: 'depleted' | 'staff' | null;
  enabled: boolean;
  available: number;
  reserved: number;
  multiplier: number;
  /** Créditos usados no período. */
  usedCredits: number;
  /** Custo real do provedor no período, em US$. */
  costUsd: number;
  /** Receita das compras pagas no período, em centavos por moeda. */
  revenueCents: { brl: number; usd: number };
  lastPurchaseAt: Date | null;
}

/** Todas as carteiras com o consumo, o custo e a receita desde `from` (padrão: os últimos 30 dias). */
export async function walletsOverview(
  db: Pick<Database, 'select'>,
  from: Date = new Date(Date.now() - 30 * 86_400_000),
): Promise<WalletOverviewRow[]> {
  const since = from.toISOString();
  const usage = db
    .select({
      tenantId: ledger.tenantId,
      used: sql<string>`-sum(${ledger.credits})`.as('used'),
      cost: sql<string>`coalesce(sum(${ledger.costUsd}), 0)`.as('cost'),
    })
    .from(ledger)
    .where(and(eq(ledger.kind, 'usage'), gte(ledger.createdAt, from)))
    .groupBy(ledger.tenantId)
    .as('usage');
  const sales = db
    .select({
      tenantId: purchaseIntent.tenantId,
      brl: sql<string>`coalesce(sum(${purchaseIntent.amountCents}) filter (where ${purchaseIntent.currency} = 'brl' and ${purchaseIntent.paidAt} >= ${since}::timestamptz), 0)`.as(
        'brl',
      ),
      usd: sql<string>`coalesce(sum(${purchaseIntent.amountCents}) filter (where ${purchaseIntent.currency} = 'usd' and ${purchaseIntent.paidAt} >= ${since}::timestamptz), 0)`.as(
        'usd',
      ),
      last: sql<string | null>`max(${purchaseIntent.paidAt})`.as('last'),
    })
    .from(purchaseIntent)
    .where(eq(purchaseIntent.status, 'paid'))
    .groupBy(purchaseIntent.tenantId)
    .as('sales');
  const rows = await db
    .select({
      tenantId: wallet.tenantId,
      name: tenant.name,
      slug: tenant.slug,
      markets: tenant.markets,
      status: wallet.status,
      blockReason: wallet.blockReason,
      enabled: wallet.enabled,
      available: wallet.available,
      reserved: wallet.reserved,
      multiplier: wallet.multiplier,
      used: usage.used,
      cost: usage.cost,
      brl: sales.brl,
      usd: sales.usd,
      last: sales.last,
    })
    .from(wallet)
    .innerJoin(tenant, eq(tenant.id, wallet.tenantId))
    .leftJoin(usage, eq(usage.tenantId, wallet.tenantId))
    .leftJoin(sales, eq(sales.tenantId, wallet.tenantId))
    .orderBy(tenant.name);
  return rows.map((r) => ({
    tenantId: r.tenantId,
    name: r.name,
    slug: r.slug,
    markets: r.markets,
    status: r.status,
    blockReason: r.blockReason,
    enabled: r.enabled,
    available: r.available,
    reserved: r.reserved,
    multiplier: r.multiplier,
    usedCredits: Number(r.used ?? 0),
    costUsd: Number(r.cost ?? 0),
    revenueCents: { brl: Number(r.brl ?? 0), usd: Number(r.usd ?? 0) },
    lastPurchaseAt: r.last ? new Date(r.last) : null,
  }));
}

/** Ajuste manual (positivo ou negativo) ou estorno de créditos, com o motivo e quem no extrato. */
export async function staffCredit(
  db: Database,
  input: { tenantId: string; kind: 'adjustment' | 'refund'; credits: number; reason: string; userId: string },
) {
  const reason = reasonOf(input.reason);
  return addEntry(db, {
    tenantId: input.tenantId,
    kind: input.kind,
    credits: input.credits,
    userId: input.userId,
    note: reason,
    metadata: { staff: true },
    // a ação é única (um clique, uma linha); repetir o envio do mesmo formulário usa outra chave de propósito
    idempotencyKey: `staff:${randomUUID()}`,
  });
}

async function logAction(
  tx: Pick<Database, 'insert'>,
  row: {
    tenantId: string | null;
    action: 'multiplier' | 'block' | 'unblock' | 'package';
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason: string;
    userId: string;
  },
) {
  await tx.insert(staffAction).values(row);
}

/** Muda o multiplicador do contrato (vale para as próximas reservas; a reserva aberta mantém o preço dela). */
export async function staffSetMultiplier(
  db: Database,
  input: { tenantId: string; multiplier: number; reason: string; userId: string },
): Promise<void> {
  const reason = reasonOf(input.reason);
  if (!(input.multiplier > 0) || !Number.isFinite(input.multiplier))
    throw new CosmosError('invalid_amount', 'o multiplicador precisa ser maior que 0');
  await db.transaction(async (tx) => {
    const [w] = await tx
      .select({ multiplier: wallet.multiplier })
      .from(wallet)
      .where(eq(wallet.tenantId, input.tenantId))
      .for('update');
    if (!w) throw new CosmosError('no_wallet', 'o tenant não tem carteira');
    await tx
      .update(wallet)
      .set({ multiplier: input.multiplier, updatedAt: new Date() })
      .where(eq(wallet.tenantId, input.tenantId));
    await logAction(tx, {
      tenantId: input.tenantId,
      action: 'multiplier',
      before: { multiplier: w.multiplier },
      after: { multiplier: input.multiplier },
      reason,
      userId: input.userId,
    });
  });
}

/**
 * Bloqueia (decisão da Galaxie, `staff`) ou desbloqueia. Desbloquear também tira o bloqueio por saldo zerado só se
 * houver saldo; sem saldo, a carteira volta a `depleted` e a próxima compra libera.
 */
export async function staffSetBlocked(
  db: Database,
  input: { tenantId: string; blocked: boolean; reason: string; userId: string },
): Promise<void> {
  const reason = reasonOf(input.reason);
  await db.transaction(async (tx) => {
    const [w] = await tx
      .select({ status: wallet.status, blockReason: wallet.blockReason, available: wallet.available })
      .from(wallet)
      .where(eq(wallet.tenantId, input.tenantId))
      .for('update');
    if (!w) throw new CosmosError('no_wallet', 'o tenant não tem carteira');
    const next = input.blocked
      ? { status: 'blocked' as const, blockReason: 'staff' as const }
      : w.available > 0
        ? { status: 'active' as const, blockReason: null }
        : { status: 'blocked' as const, blockReason: 'depleted' as const };
    await tx
      .update(wallet)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(wallet.tenantId, input.tenantId));
    await logAction(tx, {
      tenantId: input.tenantId,
      action: input.blocked ? 'block' : 'unblock',
      before: { status: w.status, blockReason: w.blockReason },
      after: next,
      reason,
      userId: input.userId,
    });
  });
}

/** Ações da equipe num tenant (mais nova primeiro), para o detalhe da carteira. */
export async function listStaffActions(db: Pick<Database, 'select'>, tenantId: string, limit = 50) {
  return db
    .select()
    .from(staffAction)
    .where(eq(staffAction.tenantId, tenantId))
    .orderBy(desc(staffAction.id))
    .limit(limit);
}

/** Todos os pacotes, ativos ou não, de todos os mercados (gestão da Galaxie). */
export async function listAllPackages(db: Pick<Database, 'select'>) {
  return db
    .select({
      id: creditPackage.id,
      name: creditPackage.name,
      credits: creditPackage.credits,
      priceCents: creditPackage.priceCents,
      currency: creditPackage.currency,
      market: creditPackage.market,
      active: creditPackage.active,
      sortOrder: creditPackage.sortOrder,
    })
    .from(creditPackage)
    .orderBy(creditPackage.market, creditPackage.sortOrder, creditPackage.credits);
}

/** Cria ou muda um pacote (preço, créditos, ativo), com motivo e registro. */
export async function staffSavePackage(
  db: Database,
  input: PackageInput & { reason: string; userId: string },
): Promise<string> {
  const reason = reasonOf(input.reason);
  const { reason: _r, userId, ...pkg } = input;
  const before = pkg.id
    ? ((await db.select().from(creditPackage).where(eq(creditPackage.id, pkg.id)))[0] ?? null)
    : null;
  const id = await upsertPackage(db, pkg);
  await logAction(db, {
    tenantId: null,
    action: 'package',
    before: before
      ? {
          name: before.name,
          credits: before.credits,
          priceCents: before.priceCents,
          currency: before.currency,
          market: before.market,
          active: before.active,
        }
      : null,
    after: { id, ...pkg },
    reason,
    userId,
  });
  return id;
}
