/**
 * Carteira da Cosmos: o serviço único que toda função chama (`reserve` → `settle` ou `release`), mais os
 * lançamentos que não são uso (teste, compra, estorno, ajuste) e a garantia de carteira.
 *
 * Regra de ouro: o saldo livre só diminui numa instrução condicional (`available >= n`) ou com a linha da
 * carteira travada (`FOR UPDATE`), então ele nunca fica negativo, mesmo com várias salas ao mesmo tempo. O
 * banco confere de novo (CHECK em `cosmos.wallet` e em `cosmos.ledger`).
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
// subcaminhos, não o índice: o índice traz o migrator (pasta drizzle/), que o bundler do Next não resolve
import type { Database } from '@galaxie/db/client';
import { functionDef, ledger, reservation, wallet, type LedgerKind } from '@galaxie/db/schema';
import { evaluateBalance } from './balance.js';
import { ceilCredits, creditsFor, roundCredits } from './credits.js';
import { CosmosError } from './errors.js';
import {
  isCosmosProvider,
  isPricedModel,
  resolveFunctionModel,
  type CosmosProvider,
  type FunctionModel,
} from './models.js';
import { readCosmosSettings, type CosmosSettings } from './settings.js';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Tx;

/** Prazo padrão de uma reserva aberta; passou dele, `releaseExpired` devolve o saldo. */
export const DEFAULT_RESERVATION_TTL_SECONDS = 300;

export interface WalletView {
  tenantId: string;
  available: number;
  reserved: number;
  receivedTotal: number;
  status: 'active' | 'blocked';
  trialGranted: boolean;
  /** Só a equipe Galaxie vê (ver `toClientWallet`). */
  multiplier: number;
  /** Teste ainda no saldo e quando vence (#994). */
  trialRemaining: number;
  trialExpiresAt: Date | null;
  /** Saldo no começo do ciclo de alertas e o maior limiar já alertado nele (0, 80, 90, 100). */
  cycleBase: number;
  cycleStartedAt: Date | null;
  alertLevel: number;
  blockReason: 'depleted' | 'staff' | null;
  /** O cliente ligou a Cosmos. Desligada, nenhuma função reserva (o saldo fica). */
  enabled: boolean;
}

const walletColumns = {
  tenantId: wallet.tenantId,
  available: wallet.available,
  reserved: wallet.reserved,
  receivedTotal: wallet.receivedTotal,
  status: wallet.status,
  trialGranted: wallet.trialGranted,
  multiplier: wallet.multiplier,
  trialRemaining: wallet.trialRemaining,
  trialExpiresAt: wallet.trialExpiresAt,
  cycleBase: wallet.cycleBase,
  cycleStartedAt: wallet.cycleStartedAt,
  alertLevel: wallet.alertLevel,
  blockReason: wallet.blockReason,
  enabled: wallet.enabled,
};

/** Carteira sem o que é só da Galaxie (multiplicador). */
export function toClientWallet(w: WalletView): Omit<WalletView, 'multiplier'> {
  const { multiplier: _multiplier, ...rest } = w;
  return rest;
}

export async function getWallet(db: Db, tenantId: string): Promise<WalletView | null> {
  const [row] = await db.select(walletColumns).from(wallet).where(eq(wallet.tenantId, tenantId));
  return row ?? null;
}

/** Cria a carteira vazia, se faltar (ligar a Cosmos). Idempotente. */
export async function ensureWallet(db: Db, tenantId: string): Promise<WalletView> {
  await db.insert(wallet).values({ tenantId }).onConflictDoNothing();
  const w = await getWallet(db, tenantId);
  if (!w) throw new CosmosError('no_wallet', `carteira do tenant ${tenantId} não foi criada`);
  return w;
}

async function lockWallet(tx: Tx, tenantId: string): Promise<WalletView | null> {
  const [row] = await tx
    .select(walletColumns)
    .from(wallet)
    .where(eq(wallet.tenantId, tenantId))
    .for('update');
  return row ?? null;
}

export interface FunctionDefInput {
  name: string;
  minCredits: number;
  permission: string;
  screen?: string | null;
  active?: boolean;
  /** Provedor de IA (#1088); null/ausente = o padrão da Cosmos. */
  provider?: CosmosProvider | null;
  /** Modelo no provedor; null/ausente = o leve padrão do provedor. Precisa de provedor. */
  model?: string | null;
}

/** Recusa provedor fora da lista, modelo sem provedor e modelo sem preço (o crédito sairia errado). */
function checkFunctionModel(def: Pick<FunctionDefInput, 'provider' | 'model'>) {
  const provider = def.provider ?? null;
  const model = def.model?.trim() || null;
  if (provider !== null && !isCosmosProvider(provider))
    throw new CosmosError('invalid_model', `provedor ${String(provider)} fora da lista da Cosmos`);
  if (model !== null && provider === null)
    throw new CosmosError('invalid_model', 'o modelo precisa de um provedor');
  const effective = resolveFunctionModel({ provider, model });
  if (!isPricedModel(effective.model))
    throw new CosmosError(
      'invalid_model',
      `o modelo ${effective.model} não tem preço na tabela do ai-ledger`,
    );
  return { provider, model };
}

/** Cadastra ou atualiza uma função do catálogo global (mínimo, permissão, tela, provedor e modelo). */
export async function upsertFunctionDef(db: Db, def: FunctionDefInput): Promise<void> {
  if (!(def.minCredits > 0))
    throw new CosmosError('invalid_amount', 'o mínimo da função precisa ser maior que 0');
  const values = {
    name: def.name,
    minCredits: ceilCredits(def.minCredits),
    permission: def.permission,
    screen: def.screen ?? null,
    active: def.active ?? true,
    ...checkFunctionModel(def),
  };
  // tela ausente na edição (a equipe não mexe nela) fica como está
  const { screen, ...rest } = values;
  await db
    .insert(functionDef)
    .values(values)
    .onConflictDoUpdate({
      target: functionDef.name,
      set: { ...rest, ...(def.screen === undefined ? {} : { screen }), updatedAt: new Date() },
    });
}

/** Função ativa do catálogo: o mínimo em créditos e o provedor e modelo efetivos; null fora dele ou desativada. */
export async function activeFunction(
  db: Db,
  name: string,
): Promise<({ minCredits: number } & FunctionModel) | null> {
  const [fn] = await db
    .select({ minCredits: functionDef.minCredits, provider: functionDef.provider, model: functionDef.model })
    .from(functionDef)
    .where(and(eq(functionDef.name, name), eq(functionDef.active, true)));
  return fn ? { minCredits: Number(fn.minCredits), ...resolveFunctionModel(fn) } : null;
}

/** Mínimo em créditos de uma função ativa do catálogo; null quando está fora dele ou desativada. */
export async function activeFunctionMinCredits(db: Db, name: string): Promise<number | null> {
  return (await activeFunction(db, name))?.minCredits ?? null;
}

export interface FunctionDefRow {
  name: string;
  minCredits: number;
  permission: string;
  screen: string | null;
  active: boolean;
  /** Gravado na função (null = padrão). */
  provider: CosmosProvider | null;
  model: string | null;
  /** O que a chamada usa de fato. */
  effective: FunctionModel;
}

/** Catálogo inteiro, ativas e desativadas, em ordem de nome (tela da equipe Galaxie). */
export async function listFunctionDefs(db: Db): Promise<FunctionDefRow[]> {
  const rows = await db.select().from(functionDef).orderBy(functionDef.name);
  return rows.map((r) => ({
    name: r.name,
    minCredits: Number(r.minCredits),
    permission: r.permission,
    screen: r.screen,
    active: r.active,
    provider: r.provider,
    model: r.model,
    effective: resolveFunctionModel(r),
  }));
}

/** Início do dia UTC de `now` (o teto de segurança vira junto com o dia UTC). */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Custo real somado de todos os tenants no dia UTC de `now`, em US$. */
export async function spentTodayUsd(db: Db, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${ledger.costUsd})` })
    .from(ledger)
    .where(and(eq(ledger.kind, 'usage'), gte(ledger.createdAt, utcDayStart(now))));
  return Number(row?.total ?? 0);
}

export interface ReserveInput {
  tenantId: string;
  functionName: string;
  /** Estimativa em créditos; abaixo do mínimo da função, vale o mínimo. */
  estimatedCredits?: number;
  /** Sala, Comunidade ou produto. */
  scope?: string | null;
  userId?: string | null;
  ttlSeconds?: number;
}

export interface ReserveOptions {
  /** Flags já lidas (lote de moderação); sem elas, lê do banco. */
  settings?: CosmosSettings;
  now?: Date;
}

export interface Reservation {
  id: string;
  tenantId: string;
  functionName: string;
  credits: number;
  expiresAt: Date;
  /** Saldo livre depois da reserva. */
  available: number;
}

/**
 * Reserva créditos antes de chamar o modelo. Recusa (CosmosError) sem carteira, com a carteira bloqueada,
 * sem saldo, com função desconhecida ou com o teto de segurança do dia alcançado.
 *
 * Grava na reserva o preço daquele momento (valor do crédito, multiplicador do tenant e mínimo da função):
 * o acerto usa só esse instantâneo, então mudar qualquer um deles no meio da chamada não muda o preço dela.
 */
export async function reserve(
  db: Database,
  input: ReserveInput,
  options: ReserveOptions = {},
): Promise<Reservation> {
  const now = options.now ?? new Date();
  const [fn] = await db
    .select({ minCredits: functionDef.minCredits })
    .from(functionDef)
    .where(and(eq(functionDef.name, input.functionName), eq(functionDef.active, true)));
  if (!fn)
    throw new CosmosError('unknown_function', `função ${input.functionName} fora do catálogo ou desativada`);

  const estimate = input.estimatedCredits ?? 0;
  if (!Number.isFinite(estimate) || estimate < 0)
    throw new CosmosError('invalid_amount', 'estimativa de créditos inválida');
  const minCredits = ceilCredits(fn.minCredits);
  const credits = ceilCredits(Math.max(estimate, minCredits));

  const settings = options.settings ?? (await readCosmosSettings(db));
  // teto brando: duas reservas no limite podem passar juntas um pouco dele; é rede de segurança, não cobrança
  if (settings.dailyUsdCeiling !== null && (await spentTodayUsd(db, now)) >= settings.dailyUsdCeiling)
    throw new CosmosError('safety_ceiling', 'teto de segurança da Cosmos alcançado hoje');

  const ttl = input.ttlSeconds ?? DEFAULT_RESERVATION_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new CosmosError('invalid_amount', 'prazo da reserva inválido');
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  return db.transaction(async (tx) => {
    // uma instrução só: duas reservas ao mesmo tempo não passam juntas do saldo
    const [updated] = await tx
      .update(wallet)
      .set({
        available: sql`${wallet.available} - ${credits}`,
        reserved: sql`${wallet.reserved} + ${credits}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(wallet.tenantId, input.tenantId),
          eq(wallet.enabled, true),
          eq(wallet.status, 'active'),
          gte(wallet.available, credits),
        ),
      )
      .returning({ available: wallet.available, multiplier: wallet.multiplier });
    if (!updated) {
      const w = await getWallet(tx, input.tenantId);
      if (!w) throw new CosmosError('no_wallet', 'o tenant ainda não ligou a Cosmos');
      if (!w.enabled) throw new CosmosError('cosmos_disabled', 'a Cosmos está desligada neste tenant');
      if (w.status === 'blocked') throw new CosmosError('wallet_blocked', 'carteira bloqueada');
      throw new CosmosError('insufficient_credits', 'saldo insuficiente');
    }
    const [row] = await tx
      .insert(reservation)
      .values({
        tenantId: input.tenantId,
        functionName: input.functionName,
        credits,
        scope: input.scope ?? null,
        userId: input.userId ?? null,
        creditUsd: settings.creditUsd,
        multiplier: updated.multiplier,
        minCredits,
        expiresAt,
        createdAt: now,
      })
      .returning({ id: reservation.id });
    return {
      id: row!.id,
      tenantId: input.tenantId,
      functionName: input.functionName,
      credits,
      expiresAt,
      available: updated.available,
    };
  });
}

export interface SettleInput {
  tenantId: string;
  reservationId: string;
  /** Custo real no provedor, em US$ (convertido pelo preço gravado na reserva). */
  costUsd?: number | null;
  /** Créditos fixos, no lugar da conversão do custo (ainda respeita o mínimo gravado na reserva). */
  credits?: number;
  tokensIn?: number | null;
  tokensCached?: number | null;
  tokensOut?: number | null;
  model?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * Teto do acerto em créditos (nunca abaixo do mínimo gravado na reserva). O assistente passa a própria reserva:
   * o cliente nunca paga mais que o "cerca de N créditos" que viu antes; o que passar é custo da Galaxie.
   */
  maxCredits?: number;
}

export interface Settlement {
  ledgerId: string;
  /** Créditos que saíram do saldo. */
  charged: number;
  /** O que passou do saldo livre e não foi cobrado (o saldo nunca fica negativo). */
  uncharged: number;
  /** Saldo livre logo depois do acerto. */
  available: number;
  /** true quando a reserva já estava acertada e esta chamada só devolveu o acerto anterior. */
  replayed: boolean;
}

const reservationColumns = {
  status: reservation.status,
  credits: reservation.credits,
  functionName: reservation.functionName,
  scope: reservation.scope,
  userId: reservation.userId,
  creditUsd: reservation.creditUsd,
  multiplier: reservation.multiplier,
  minCredits: reservation.minCredits,
};

async function lockReservation(tx: Tx, tenantId: string, reservationId: string) {
  const [r] = await tx
    .select(reservationColumns)
    .from(reservation)
    .where(and(eq(reservation.id, reservationId), eq(reservation.tenantId, tenantId)))
    .for('update');
  return r ?? null;
}

/**
 * Acerta a reserva pelo valor real, com o preço gravado nela: devolve a sobra ou cobra a diferença, até o
 * saldo livre. Um lançamento de uso no extrato (na moderação, um por lote).
 *
 * Idempotente: repetir o acerto de uma reserva já acertada (a resposta se perdeu na rede) devolve o mesmo
 * acerto, sem cobrar de novo (`replayed`). Reserva devolvida ou vencida pelo `releaseExpired` é recusada
 * (`reservation_closed`): o saldo dela já voltou. Reserva aberta depois do prazo ainda acerta normalmente.
 */
export async function settle(
  db: Database,
  input: SettleInput,
  options: { now?: Date } = {},
): Promise<Settlement> {
  const now = options.now ?? new Date();
  // custo inválido (NaN, Infinity, negativo) não pode virar crédito nem entrar no teto do dia
  if (
    input.costUsd !== undefined &&
    input.costUsd !== null &&
    (!Number.isFinite(input.costUsd) || input.costUsd < 0)
  )
    throw new CosmosError('invalid_amount', 'custo real inválido');
  if (input.credits !== undefined && (!Number.isFinite(input.credits) || input.credits < 0))
    throw new CosmosError('invalid_amount', 'créditos do acerto inválidos');
  return db.transaction(async (tx) => {
    const r = await lockReservation(tx, input.tenantId, input.reservationId);
    if (!r) throw new CosmosError('reservation_closed', 'reserva inexistente ou de outro tenant');
    if (r.status === 'settled') {
      const [prev] = await tx
        .select({
          id: ledger.id,
          credits: ledger.credits,
          after: ledger.balanceAfter,
          metadata: ledger.metadata,
        })
        .from(ledger)
        .where(and(eq(ledger.reservationId, input.reservationId), eq(ledger.kind, 'usage')));
      if (!prev) throw new CosmosError('reservation_closed', 'reserva acertada sem lançamento');
      const raw = Number((prev.metadata as { uncharged?: unknown } | null)?.uncharged);
      const uncharged = Number.isFinite(raw) && raw > 0 ? raw : 0;
      return { ledgerId: prev.id, charged: -prev.credits, uncharged, available: prev.after, replayed: true };
    }
    if (r.status !== 'open') throw new CosmosError('reservation_closed', 'reserva já devolvida ou vencida');

    const w = await lockWallet(tx, input.tenantId);
    if (!w) throw new CosmosError('no_wallet', 'carteira sumiu com a reserva aberta');

    // só o instantâneo da reserva: nada de reler flags, multiplicador ou catálogo aqui
    const target =
      input.credits !== undefined
        ? Math.max(ceilCredits(input.credits), r.minCredits)
        : creditsFor({
            costUsd: input.costUsd ?? null,
            multiplier: r.multiplier,
            creditUsd: r.creditUsd,
            minCredits: r.minCredits,
          });

    const capped =
      input.maxCredits !== undefined && Number.isFinite(input.maxCredits)
        ? Math.min(target, Math.max(ceilCredits(input.maxCredits), r.minCredits))
        : target;

    // o que estaria livre se a reserva voltasse inteira
    const pool = roundCredits(w.available + r.credits);
    const charged = Math.min(capped, pool);
    const available = roundCredits(pool - charged);
    const uncharged = roundCredits(capped - charged);

    await tx
      .update(wallet)
      .set({
        available,
        reserved: sql`${wallet.reserved} - ${r.credits}`,
        // o uso gasta o teste primeiro
        trialRemaining: roundCredits(Math.max(0, w.trialRemaining - charged)),
        ...(await evaluateBalance(tx, w, available, now)),
        updatedAt: now,
      })
      .where(eq(wallet.tenantId, input.tenantId));
    const [entry] = await tx
      .insert(ledger)
      .values({
        tenantId: input.tenantId,
        kind: 'usage',
        credits: -charged,
        balanceBefore: pool,
        balanceAfter: available,
        functionName: r.functionName,
        scope: r.scope,
        userId: r.userId,
        reservationId: input.reservationId,
        tokensIn: input.tokensIn ?? null,
        tokensCached: input.tokensCached ?? null,
        tokensOut: input.tokensOut ?? null,
        costUsd: input.costUsd ?? null,
        model: input.model ?? null,
        note: input.note ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          // chaves reservadas: sempre as calculadas aqui, por cima do que vier do chamador
          reserved: r.credits,
          uncharged,
        },
        createdAt: now,
      })
      .returning({ id: ledger.id });
    await tx
      .update(reservation)
      .set({ status: 'settled', chargedCredits: charged, closedAt: now })
      .where(eq(reservation.id, input.reservationId));
    return { ledgerId: entry!.id, charged, uncharged, available, replayed: false };
  });
}

/**
 * Devolve a reserva inteira (a chamada falhou ou foi cancelada). Sem lançamento no extrato.
 *
 * Idempotente: devolver de novo uma reserva já devolvida ou vencida não devolve duas vezes (`released`
 * false). Reserva já acertada é recusada (`reservation_closed`): o uso já foi cobrado.
 */
export async function release(
  db: Database,
  input: { tenantId: string; reservationId: string },
  options: { now?: Date; status?: 'released' | 'expired' } = {},
): Promise<{ available: number; released: boolean }> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const r = await lockReservation(tx, input.tenantId, input.reservationId);
    if (!r) throw new CosmosError('reservation_closed', 'reserva inexistente ou de outro tenant');
    if (r.status === 'settled') throw new CosmosError('reservation_closed', 'reserva já acertada');
    if (r.status !== 'open') {
      const w = await getWallet(tx, input.tenantId);
      return { available: w?.available ?? 0, released: false };
    }
    const [w] = await tx
      .update(wallet)
      .set({
        available: sql`${wallet.available} + ${r.credits}`,
        reserved: sql`${wallet.reserved} - ${r.credits}`,
        // bloqueada por saldo zerado com a reserva de volta: o saldo livre é positivo, então libera
        status: sql`case when ${wallet.blockReason} = 'depleted' and ${wallet.available} + ${r.credits} > 0 then 'active'::cosmos.wallet_status else ${wallet.status} end`,
        blockReason: sql`case when ${wallet.blockReason} = 'depleted' and ${wallet.available} + ${r.credits} > 0 then null else ${wallet.blockReason} end`,
        updatedAt: now,
      })
      .where(eq(wallet.tenantId, input.tenantId))
      .returning({ available: wallet.available });
    await tx
      .update(reservation)
      .set({ status: options.status ?? 'released', chargedCredits: 0, closedAt: now })
      .where(eq(reservation.id, input.reservationId));
    return { available: w?.available ?? 0, released: true };
  });
}

/** Devolve as reservas abertas que passaram do prazo (processo que morreu no meio). Devolve quantas. */
export async function releaseExpired(db: Database, now: Date = new Date(), limit = 500): Promise<number> {
  const stale = await db
    .select({ id: reservation.id, tenantId: reservation.tenantId })
    .from(reservation)
    .where(and(eq(reservation.status, 'open'), lt(reservation.expiresAt, now)))
    .limit(limit);
  let released = 0;
  for (const r of stale) {
    try {
      const result = await release(
        db,
        { tenantId: r.tenantId, reservationId: r.id },
        { now, status: 'expired' },
      );
      if (result.released) released += 1;
    } catch (e) {
      // acertada por outro processo entre a leitura e a trava: nada a devolver
      if (!(e instanceof CosmosError && e.code === 'reservation_closed')) throw e;
    }
  }
  return released;
}

/** Lançamentos que não são uso (o uso entra só por `settle`). */
export type EntryKind = Exclude<LedgerKind, 'usage'>;

/** Tipos que somam em "total recebido" quando entram créditos. */
const RECEIVED_KINDS: ReadonlySet<EntryKind> = new Set(['trial', 'purchase', 'adjustment']);

/** Tipos que só entram créditos. */
const POSITIVE_KINDS: ReadonlySet<EntryKind> = new Set(['trial', 'purchase']);

export interface EntryInput {
  tenantId: string;
  kind: EntryKind;
  /** Positivo entra, negativo sai (nunca além do saldo livre). */
  credits: number;
  userId?: string | null;
  scope?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * Chave de idempotência (única por tenant): obrigatória na compra e no estorno (o id do evento ou da sessão do
   * Stripe, por exemplo). Repetir com a mesma chave devolve o lançamento original sem mexer no saldo.
   */
  idempotencyKey?: string | null;
  /** Só no teste: quando ele vence (o que sobrar sai do saldo com `trial_expiry`). */
  trialExpiresAt?: Date | null;
}

/** Tipos que só entram com chave de idempotência (dinheiro de fora: repetir não pode somar de novo). */
const KEYED_KINDS: ReadonlySet<EntryKind> = new Set(['purchase', 'refund']);

/**
 * Lança teste, compra, estorno, ajuste, vencimento do teste ou mudança de cota, com o saldo antes e depois.
 * Cria a carteira se faltar (a compra pode chegar antes de a Cosmos ser ligada). Saída maior que o saldo
 * livre é recusada (`insufficient_credits`).
 */
export async function addEntry(
  db: Database,
  input: EntryInput,
  options: { now?: Date } = {},
): Promise<{ ledgerId: string; available: number; replayed: boolean }> {
  return db.transaction((tx) => addEntryInTx(tx, input, options));
}

/** O mesmo que `addEntry`, dentro de uma transação já aberta (o webhook credita junto com o evento). */
export async function addEntryInTx(
  tx: Tx,
  input: EntryInput,
  options: { now?: Date } = {},
): Promise<{ ledgerId: string; available: number; replayed: boolean }> {
  const now = options.now ?? new Date();
  const key = input.idempotencyKey?.trim() || null;
  if (!key && KEYED_KINDS.has(input.kind))
    throw new CosmosError('missing_idempotency_key', `lançamento ${input.kind} sem chave de idempotência`);
  if (!Number.isFinite(input.credits)) throw new CosmosError('invalid_amount', 'créditos inválidos');
  const credits = roundCredits(input.credits);
  // lançamento zerado não diz nada; teste e compra só entram positivos (um teste de 0 queimaria o teste de vez)
  if (credits === 0 || (POSITIVE_KINDS.has(input.kind) && credits < 0))
    throw new CosmosError(
      'invalid_amount',
      'créditos do lançamento precisam ser diferentes de 0 (positivos no teste e na compra)',
    );
  await tx.insert(wallet).values({ tenantId: input.tenantId }).onConflictDoNothing();
  const w = await lockWallet(tx, input.tenantId);
  if (!w) throw new CosmosError('no_wallet', 'carteira não foi criada');
  // repetição (ou outro processo com a mesma chave): com a carteira travada, devolve o lançamento original
  if (key) {
    const [prev] = await tx
      .select({ id: ledger.id, after: ledger.balanceAfter, kind: ledger.kind, credits: ledger.credits })
      .from(ledger)
      .where(and(eq(ledger.tenantId, input.tenantId), eq(ledger.idempotencyKey, key)));
    if (prev) {
      // a repetição só vale para o mesmo lançamento: outro valor ou tipo com a mesma chave sumiria calado
      if (prev.kind !== input.kind || Number(prev.credits) !== credits)
        throw new CosmosError(
          'idempotency_conflict',
          'a chave de idempotência já foi usada em outro lançamento',
        );
      return { ledgerId: prev.id, available: prev.after, replayed: true };
    }
  }
  // teste uma vez só por tenant: com a carteira travada, a segunda concessão (repetição ou outro processo) é recusada
  if (input.kind === 'trial' && w.trialGranted)
    throw new CosmosError('trial_already_granted', 'créditos de teste já concedidos a este tenant');
  // teste sem prazo nunca venceria: o prazo é obrigatório
  if (input.kind === 'trial' && !(input.trialExpiresAt instanceof Date && input.trialExpiresAt > now))
    throw new CosmosError('invalid_amount', 'o teste precisa de um prazo de validade no futuro');
  const available = roundCredits(w.available + credits);
  if (available < 0) throw new CosmosError('insufficient_credits', 'saída maior que o saldo livre');
  const received = credits > 0 && RECEIVED_KINDS.has(input.kind) ? credits : 0;
  // qualquer entrada de créditos (estorno incluído) abre um ciclo novo de alertas e libera a carteira bloqueada
  // por saldo zerado; só teste, compra e ajuste somam no total recebido
  const cycle =
    credits > 0
      ? {
          cycleBase: available,
          cycleStartedAt: now,
          alertLevel: 0,
          ...(w.status === 'blocked' && w.blockReason === 'depleted'
            ? { status: 'active' as const, blockReason: null }
            : {}),
        }
      : credits < 0
        ? await evaluateBalance(tx, w, available, now)
        : {};
  await tx
    .update(wallet)
    .set({
      available,
      receivedTotal: sql`${wallet.receivedTotal} + ${received}`,
      ...(input.kind === 'trial'
        ? { trialGranted: true, trialRemaining: credits, trialExpiresAt: input.trialExpiresAt ?? null }
        : {}),
      // o vencimento tira só o que saiu; a parte do teste que estava reservada vence quando voltar (expireTrials)
      ...(input.kind === 'trial_expiry'
        ? { trialRemaining: sql`greatest(${wallet.trialRemaining} + ${credits}, 0)` }
        : {}),
      ...cycle,
      updatedAt: now,
    })
    .where(eq(wallet.tenantId, input.tenantId));
  const [entry] = await tx
    .insert(ledger)
    .values({
      tenantId: input.tenantId,
      kind: input.kind,
      credits,
      balanceBefore: w.available,
      balanceAfter: available,
      userId: input.userId ?? null,
      scope: input.scope ?? null,
      note: input.note ?? null,
      metadata: input.metadata ?? null,
      idempotencyKey: key,
      createdAt: now,
    })
    .returning({ id: ledger.id });
  return { ledgerId: entry!.id, available, replayed: false };
}

/** Bloqueia (decisão da Galaxie, `staff`) ou libera a carteira. */
export async function setWalletStatus(db: Db, tenantId: string, status: 'active' | 'blocked'): Promise<void> {
  await db
    .update(wallet)
    .set({ status, blockReason: status === 'blocked' ? 'staff' : null, updatedAt: new Date() })
    .where(eq(wallet.tenantId, tenantId));
}

/** Multiplicador sobre o custo real (só a Galaxie muda). */
export async function setWalletMultiplier(db: Db, tenantId: string, multiplier: number): Promise<void> {
  if (!(multiplier > 0) || !Number.isFinite(multiplier))
    throw new CosmosError('invalid_amount', 'o multiplicador precisa ser maior que 0');
  await db.update(wallet).set({ multiplier, updatedAt: new Date() }).where(eq(wallet.tenantId, tenantId));
}
