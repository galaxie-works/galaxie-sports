/**
 * Carteiras da Cosmos para a equipe Galaxie (#1002): a visão de todos os tenants (saldo, consumo, custo real,
 * receita, estado, última compra) e as ações com motivo obrigatório e registro. Ajuste e estorno vão para o extrato
 * (`adjustment`/`refund`, com quem e o motivo no lançamento); multiplicador, bloqueio e pacotes vão para
 * `cosmos.staff_action`, com o antes e o depois. Nada disto chega ao cliente.
 *
 * Fica separado do orçamento da IA interna (agentes de cenário, resumo, onde assistir), que segue no TokenBudget com
 * o limite diário próprio: aqui só se lê e se escreve o schema `cosmos`.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import {
  creditPackage,
  ledger,
  purchaseIntent,
  rechargeAttempt,
  staffAction,
  tenant,
  wallet,
} from '@galaxie/db/schema';
import { CosmosError } from './errors.js';
import { upsertPackage, type PackageInput } from './purchases.js';
import { cancelPendingRecharges } from './recharge.js';
import { isUuid } from './uuid.js';
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
  /** Receita das compras pagas e das recargas automáticas concluídas no período, em centavos por moeda. */
  revenueCents: { brl: number; usd: number };
  /** Última compra avulsa paga ou recarga automática concluída. */
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
  // recargas automáticas pagas também são receita e compra; a conclusão é a última escrita da tentativa (o webhook
  // marca `succeeded` e ninguém mexe mais nela)
  const recharges = db
    .select({
      tenantId: rechargeAttempt.tenantId,
      brl: sql<string>`coalesce(sum(${rechargeAttempt.amountCents}) filter (where ${rechargeAttempt.currency} = 'brl' and ${rechargeAttempt.updatedAt} >= ${since}::timestamptz), 0)`.as(
        'r_brl',
      ),
      usd: sql<string>`coalesce(sum(${rechargeAttempt.amountCents}) filter (where ${rechargeAttempt.currency} = 'usd' and ${rechargeAttempt.updatedAt} >= ${since}::timestamptz), 0)`.as(
        'r_usd',
      ),
      last: sql<string | null>`max(${rechargeAttempt.updatedAt})`.as('r_last'),
    })
    .from(rechargeAttempt)
    .where(eq(rechargeAttempt.status, 'succeeded'))
    .groupBy(rechargeAttempt.tenantId)
    .as('recharges');
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
      rechargeBrl: recharges.brl,
      rechargeUsd: recharges.usd,
      rechargeLast: recharges.last,
    })
    .from(wallet)
    .innerJoin(tenant, eq(tenant.id, wallet.tenantId))
    .leftJoin(usage, eq(usage.tenantId, wallet.tenantId))
    .leftJoin(sales, eq(sales.tenantId, wallet.tenantId))
    .leftJoin(recharges, eq(recharges.tenantId, wallet.tenantId))
    .orderBy(tenant.name);
  const latest = (...dates: (string | null)[]) => {
    const times = dates.filter((d): d is string => Boolean(d)).map((d) => new Date(d).getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  };
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
    revenueCents: {
      brl: Number(r.brl ?? 0) + Number(r.rechargeBrl ?? 0),
      usd: Number(r.usd ?? 0) + Number(r.rechargeUsd ?? 0),
    },
    lastPurchaseAt: latest(r.last, r.rechargeLast),
  }));
}

/**
 * Ajuste manual (positivo ou negativo) ou estorno de créditos, com o motivo e quem no extrato. `requestKey` (UUID)
 * é gerada no navegador ao abrir a janela do ajuste e vira a chave de idempotência (`staff:<chave>`): o mesmo envio
 * repetido devolve o lançamento original (`replayed`) em vez de lançar de novo.
 */
export async function staffCredit(
  db: Database,
  input: {
    tenantId: string;
    kind: 'adjustment' | 'refund';
    credits: number;
    reason: string;
    userId: string;
    requestKey: string;
  },
) {
  const reason = reasonOf(input.reason);
  if (!isUuid(input.requestKey))
    throw new CosmosError('missing_idempotency_key', 'ajuste da equipe sem chave de idempotência válida');
  return addEntry(db, {
    tenantId: input.tenantId,
    kind: input.kind,
    credits: input.credits,
    userId: input.userId,
    note: reason,
    metadata: { staff: true },
    idempotencyKey: `staff:${input.requestKey.toLowerCase()}`,
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
    const now = new Date();
    await tx
      .update(wallet)
      .set({ ...next, updatedAt: now })
      .where(eq(wallet.tenantId, input.tenantId));
    // carteira bloqueada pela equipe não é cobrada: a recarga pendente que ainda não chamou o Stripe sai junto (a
    // que já chamou espera o webhook sem cobrar de novo; o job não tira da fila carteira bloqueada)
    if (input.blocked) await cancelPendingRecharges(tx, input.tenantId, 'wallet_blocked', now);
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
  // preço e auditoria juntos: se o registro falhar, o pacote não muda
  return db.transaction(async (tx) => {
    const before = pkg.id
      ? ((await tx.select().from(creditPackage).where(eq(creditPackage.id, pkg.id)).for('update'))[0] ?? null)
      : null;
    const id = await upsertPackage(tx, pkg);
    await logAction(tx, {
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
  });
}
