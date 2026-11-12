/**
 * Cota da carteira por sala e produto (#1116). O dono reparte o saldo em %: chat ao vivo (`chat`, ou uma sala,
 * `chat:<id>`), cada comunidade (`community:<id>`), bolão (`pool`). A base é o saldo do ciclo (`wallet.cycle_base`,
 * o saldo livre logo depois da última entrada de créditos), a mesma dos alertas de 80% e 90%.
 *
 * - O que uma sala já usou no ciclo: o uso do extrato com aquele escopo desde o início do ciclo, mais as reservas
 *   abertas dela. A reserva confere com a carteira travada (`FOR UPDATE`), então reservas simultâneas nunca passam da
 *   cota.
 * - Escopo sem cota usa só o saldo da carteira. Vale a cota mais específica (`chat:<sala>` antes de `chat`).
 * - A soma pode passar de 100%: a tela avisa, e cada reserva continua limitada pelo saldo real.
 * - Mudar as cotas grava um lançamento `quota_change` (0 crédito) no extrato, com as cotas novas.
 * - O escopo da reserva é o contrato: `chat:<sala>`, `community:<id>` ou `pool[:<id>]` (a moderação reserva assim).
 *   Escopo fora desse formato (ex.: `assistant`) não tem cota e usa só o saldo.
 * - O ciclo recomeça a cada entrada de créditos (compra, recarga, estorno ou ajuste): o uso de cada sala volta a zero e
 *   a base passa a ser o saldo livre daquele momento, como nos alertas de 80% e 90%.
 */
import { and, eq, gte, like, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
// subcaminhos, não o índice: o índice traz o migrator (pasta drizzle/), que o bundler do Next não resolve
import type { Database } from '@galaxie/db/client';
import { ledger, reservation, wallet, walletQuota } from '@galaxie/db/schema';
import { decideCreditRequest, type CreditRequest } from './credit-requests.js';
import { roundCredits } from './credits.js';
import { CosmosError } from './errors.js';

/** Produtos que podem ter cota. */
export const QUOTA_PRODUCTS = ['chat', 'community', 'pool'] as const;
export type QuotaProduct = (typeof QUOTA_PRODUCTS)[number];

/** Até quantas cotas por tenant. */
export const QUOTAS_MAX = 50;

// o id segue o contrato da moderação (`Ref` em @galaxie/contracts): até 128 caracteres, com . _ : @ | -
const SCOPE = /^(chat|community|pool)(?::([\w.:@|-]{1,128}))?$/;

export interface Quota {
  scope: string;
  /** % do saldo do ciclo, com até duas casas. */
  percent: number;
}

export const isQuotaScope = (v: unknown): v is string => typeof v === 'string' && SCOPE.test(v);

/** Valida as cotas vindas da tela; null se algo não serve (escopo fora do formato, % fora de 0–100, repetição). */
export function parseQuotas(input: unknown): Quota[] | null {
  if (!Array.isArray(input) || input.length > QUOTAS_MAX) return null;
  const seen = new Set<string>();
  const out: Quota[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null;
    const { scope, percent } = item as Record<string, unknown>;
    if (!isQuotaScope(scope) || seen.has(scope)) return null;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
    // arredonda antes de validar: 0,004% viraria 0 e quebraria o CHECK da tabela
    const rounded = Math.round(percent * 100) / 100;
    if (rounded <= 0 || rounded > 100) return null;
    seen.add(scope);
    out.push({ scope, percent: rounded });
  }
  return out;
}

/** A cota que vale para um escopo de reserva: a mais específica; null = sem cota. */
export function quotaFor(scope: string | null | undefined, quotas: readonly Quota[]): Quota | null {
  if (!scope) return null;
  const exact = quotas.find((q) => q.scope === scope);
  if (exact) return exact;
  const product = scope.split(':')[0]!;
  return quotas.find((q) => q.scope === product) ?? null;
}

/** Créditos da cota no ciclo. */
export const quotaCredits = (percent: number, cycleBase: number) => roundCredits((cycleBase * percent) / 100);

type Reader = Pick<Database, 'select'>;

/** Escopos que contam para uma cota: o próprio e, na cota do produto, as salas sem cota própria. */
function scopeFilter(col: AnyPgColumn, quota: Quota, quotas: readonly Quota[]): SQL {
  if (quota.scope.includes(':')) return eq(col, quota.scope);
  // cota do produto: o produto e as salas dele que não têm cota própria
  const own = quotas.filter((q) => q.scope.startsWith(`${quota.scope}:`)).map((q) => q.scope);
  // os escopos gravados passam pelo formato (sem % nem _ especiais além do `_` do id, que aqui só alarga para salas
  // do mesmo produto)
  const rooms = like(col, `${quota.scope}:%`);
  const base = or(eq(col, quota.scope), rooms)!;
  return own.length
    ? and(
        base,
        sql`${col} not in (${sql.join(
          own.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      )!
    : base;
}

/** O que a cota já usou no ciclo: uso do extrato desde o início do ciclo mais as reservas abertas. */
export async function quotaUsed(
  db: Reader,
  tenantId: string,
  quota: Quota,
  quotas: readonly Quota[],
  cycleStartedAt: Date | null,
): Promise<number> {
  const [spent] = await db
    .select({ n: sql<string>`coalesce(sum(-${ledger.credits}), 0)` })
    .from(ledger)
    .where(
      and(
        eq(ledger.tenantId, tenantId),
        eq(ledger.kind, 'usage'),
        scopeFilter(ledger.scope, quota, quotas),
        ...(cycleStartedAt ? [gte(ledger.createdAt, cycleStartedAt)] : []),
      ),
    );
  const [held] = await db
    .select({ n: sql<string>`coalesce(sum(${reservation.credits}), 0)` })
    .from(reservation)
    .where(
      and(
        eq(reservation.tenantId, tenantId),
        eq(reservation.status, 'open'),
        scopeFilter(reservation.scope, quota, quotas),
      ),
    );
  return roundCredits(Number(spent?.n ?? 0) + Number(held?.n ?? 0));
}

export async function listQuotas(db: Reader, tenantId: string): Promise<Quota[]> {
  const rows = await db
    .select({ scope: walletQuota.scope, percent: walletQuota.percent })
    .from(walletQuota)
    .where(eq(walletQuota.tenantId, tenantId));
  return rows.sort((a, b) => a.scope.localeCompare(b.scope));
}

/**
 * Confere a cota dentro da transação da reserva, com a carteira já travada. Recusa (`quota_exceeded`) quando a sala
 * passaria da cota com este pedido.
 */
export async function assertQuota(
  tx: Reader,
  input: { tenantId: string; scope: string | null | undefined; credits: number },
  cycle: { base: number; startedAt: Date | null },
  candidates?: Quota[],
): Promise<void> {
  const quotas = candidates ?? (await quotaCandidates(tx, input.tenantId, input.scope));
  const quota = quotaFor(input.scope, quotas);
  if (!quota) return;
  const used = await quotaUsed(tx, input.tenantId, quota, quotas, cycle.startedAt);
  if (roundCredits(used + input.credits) > quotaCredits(quota.percent, cycle.base))
    throw new CosmosError('quota_exceeded', `a cota de ${quota.scope} não cobre este pedido`);
}

/**
 * As cotas do produto do escopo (a do produto e as das salas dele); vazio quando o escopo não tem cota possível. A
 * reserva lê isto depois de travar a carteira, a mesma trava de quem muda as cotas: uma mudança já gravada sempre
 * vale para a reserva seguinte.
 */
export async function quotaCandidates(
  db: Reader,
  tenantId: string,
  scope: string | null | undefined,
): Promise<Quota[]> {
  if (!isQuotaScope(scope)) return [];
  const product = scope.split(':')[0]!;
  return db
    .select({ scope: walletQuota.scope, percent: walletQuota.percent })
    .from(walletQuota)
    .where(
      and(
        eq(walletQuota.tenantId, tenantId),
        or(eq(walletQuota.scope, product), like(walletQuota.scope, `${product}:%`)),
      ),
    );
}

export interface QuotaStatus extends Quota {
  /** Créditos da cota no ciclo. */
  credits: number;
  used: number;
  remaining: number;
}

export interface QuotaOverview {
  quotas: QuotaStatus[];
  /** Soma das % (pode passar de 100). */
  totalPercent: number;
  /** % sem destino (nunca negativa). */
  unassignedPercent: number;
  cycleBase: number;
}

/** Cotas do tenant com o uso no ciclo, para a tela. */
export async function readQuotaOverview(db: Reader, tenantId: string): Promise<QuotaOverview> {
  const [w] = await db
    .select({ cycleBase: wallet.cycleBase, cycleStartedAt: wallet.cycleStartedAt })
    .from(wallet)
    .where(eq(wallet.tenantId, tenantId));
  const quotas = await listQuotas(db, tenantId);
  const cycleBase = w?.cycleBase ?? 0;
  const out: QuotaStatus[] = [];
  for (const q of quotas) {
    const credits = quotaCredits(q.percent, cycleBase);
    const used = await quotaUsed(db, tenantId, q, quotas, w?.cycleStartedAt ?? null);
    out.push({ ...q, credits, used, remaining: roundCredits(Math.max(0, credits - used)) });
  }
  const totalPercent = Math.round(quotas.reduce((n, q) => n + q.percent, 0) * 100) / 100;
  return {
    quotas: out,
    totalPercent,
    unassignedPercent: Math.max(0, Math.round((100 - totalPercent) * 100) / 100),
    cycleBase,
  };
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Trava a carteira do tenant (a mesma trava da reserva); `no_wallet` sem carteira. */
async function lockWallet(tx: Tx, tenantId: string): Promise<number> {
  const [w] = await tx
    .select({ available: wallet.available })
    .from(wallet)
    .where(eq(wallet.tenantId, tenantId))
    .for('update');
  if (!w) throw new CosmosError('no_wallet', 'o tenant ainda não ligou a Cosmos');
  return w.available;
}

const sameQuotas = (a: readonly Quota[], b: readonly Quota[]) =>
  a.length === b.length && a.every((q) => b.some((r) => r.scope === q.scope && r.percent === q.percent));

/** Grava as cotas com a carteira já travada; o lançamento `quota_change` só entra quando algo mudou. */
async function writeQuotas(
  tx: Tx,
  input: { tenantId: string; quotas: Quota[]; userId: string; available: number },
): Promise<Quota[]> {
  const before = await listQuotas(tx, input.tenantId);
  if (sameQuotas(before, input.quotas)) return input.quotas;
  const keep = input.quotas.map((q) => q.scope);
  await tx.delete(walletQuota).where(
    keep.length
      ? and(
          eq(walletQuota.tenantId, input.tenantId),
          sql`${walletQuota.scope} not in (${sql.join(
            keep.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        )
      : eq(walletQuota.tenantId, input.tenantId),
  );
  for (const q of input.quotas)
    await tx
      .insert(walletQuota)
      .values({ tenantId: input.tenantId, scope: q.scope, percent: q.percent, updatedBy: input.userId })
      .onConflictDoUpdate({
        target: [walletQuota.tenantId, walletQuota.scope],
        set: { percent: q.percent, updatedBy: input.userId, updatedAt: sql`now()` },
      });
  await tx.insert(ledger).values({
    tenantId: input.tenantId,
    kind: 'quota_change',
    credits: 0,
    balanceBefore: input.available,
    balanceAfter: input.available,
    userId: input.userId,
    metadata: { quotas: input.quotas },
  });
  return input.quotas;
}

/**
 * Troca as cotas do tenant (as que não vierem saem) e grava o lançamento `quota_change` no extrato, com 0 crédito e as
 * cotas novas. Recusa cotas inválidas (`invalid_quota`) e tenant sem carteira (`no_wallet`).
 */
export async function setQuotas(
  db: Database,
  input: { tenantId: string; quotas: unknown; userId: string },
): Promise<Quota[]> {
  const quotas = parseQuotas(input.quotas);
  if (!quotas) throw new CosmosError('invalid_quota', 'cotas inválidas');
  return db.transaction(async (tx) => {
    const available = await lockWallet(tx, input.tenantId);
    return writeQuotas(tx, { tenantId: input.tenantId, quotas, userId: input.userId, available });
  });
}

/**
 * Cotas depois de aumentar a de uma sala em pontos percentuais, até 100%. Parte da cota que vale hoje para a sala (a
 * dela ou, sem cota própria, a do produto): aumentar nunca diminui o que a sala já podia usar.
 */
export function raisedQuotas(current: readonly Quota[], scope: string, addPercent: number): Quota[] | null {
  if (!isQuotaScope(scope) || !Number.isFinite(addPercent) || addPercent <= 0) return null;
  const base = quotaFor(scope, current)?.percent ?? 0;
  const percent = Math.min(100, Math.round((base + addPercent) * 100) / 100);
  const next = current.some((q) => q.scope === scope)
    ? current.map((q) => (q.scope === scope ? { ...q, percent } : q))
    : [...current, { scope, percent }];
  return parseQuotas(next);
}

async function raiseIn(
  tx: Tx,
  input: { tenantId: string; scope: string; addPercent: number; userId: string },
): Promise<Quota[]> {
  const available = await lockWallet(tx, input.tenantId);
  // lido com a carteira travada: dois aumentos ao mesmo tempo não se perdem
  const next = raisedQuotas(await listQuotas(tx, input.tenantId), input.scope, input.addPercent);
  if (!next) throw new CosmosError('invalid_quota', 'cota inválida');
  return writeQuotas(tx, { tenantId: input.tenantId, quotas: next, userId: input.userId, available });
}

/** Aumenta (ou cria) a cota de uma sala em pontos percentuais, até 100%. */
export function raiseQuota(
  db: Database,
  input: { tenantId: string; scope: string; addPercent: number; userId: string },
): Promise<Quota[]> {
  return db.transaction((tx) => raiseIn(tx, input));
}

/**
 * Aprova o pedido de créditos (#996) e aumenta a cota da sala na mesma transação: se a cota não puder subir, o pedido
 * continua aberto.
 */
export function approveWithQuota(
  db: Database,
  input: {
    tenantId: string;
    requestId: string;
    userId: string;
    scope: string;
    addPercent: number;
    note?: string | null;
  },
): Promise<{ request: CreditRequest; quotas: Quota[] }> {
  return db.transaction(async (tx) => {
    const quotas = await raiseIn(tx, input);
    const request = await decideCreditRequest(tx, {
      tenantId: input.tenantId,
      requestId: input.requestId,
      decision: 'approved',
      userId: input.userId,
      note: input.note ?? null,
    });
    return { request, quotas };
  });
}
