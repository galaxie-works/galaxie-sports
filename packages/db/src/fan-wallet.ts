/**
 * Serviço da carteira de pontos (#938, B6), usado pelos módulos de engajamento: `credit`, `debit` (resgate do
 * Saldo) e `revert` (estorno do evento de origem). Cada lançamento trava a linha da carteira (`for update`), grava o
 * extrato com o valor depois do lançamento e é idempotente: repetir o mesmo evento devolve o lançamento que já existe.
 *
 * Regras que valem aqui, para todos os módulos:
 * - compra e clique na loja nunca creditam (o tipo não aceita `shopping`, e o banco recusa);
 * - Perfil `under13` fica fora; `13_17` ganha Pontos mas não resgata (D1);
 * - Perfil excluído não recebe lançamento novo;
 * - o estorno tira o que o lançamento deu; se parte do Saldo já foi gasta, tira só o que sobrou (os Pontos saem
 *   inteiros, porque nunca foram gastos);
 * - evento estornado não credita mais, nem quando o estorno chega antes do crédito (`fan.points_revoked_event`).
 */
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  FAN_POINTS_SOURCES,
  fanPointsLedger,
  fanPointsRevokedEvent,
  fanProfile,
  fanWallet,
  type FanAgeBand,
  type FanPointsReason,
  type FanPointsSource,
} from './schema/fan.js';

/** Motivos que creditam (o resgate e o estorno têm função própria). */
export type FanCreditReason = Exclude<FanPointsReason, 'redeem' | 'revert'>;

export interface FanWalletKey {
  tenantId: string;
  profileId: string;
  /** País do programa, ISO 3166-1 alfa-2. */
  programCountry: string;
}

export interface FanLedgerEntry {
  id: string;
  reason: FanPointsReason;
  source: FanPointsSource;
  sourceEvent: string;
  revertsId: string | null;
  pointsDelta: number;
  balanceDelta: number;
  pointsAfter: number;
  balanceAfter: number;
  note: string | null;
  createdAt: Date;
}

export interface FanWalletView {
  programCountry: string;
  points: number;
  balance: number;
}

export type FanWalletResult =
  | { ok: true; entry: FanLedgerEntry; duplicate: boolean }
  | {
      ok: false;
      error:
        | 'profile_not_found'
        | 'age_restricted'
        | 'insufficient_balance'
        | 'entry_not_found'
        | 'not_revertible'
        | 'reverted';
    };

const COUNTRY = /^[A-Z]{2}$/;
const MAX_AMOUNT = 1_000_000_000;

function check(key: FanWalletKey, amount?: number): void {
  if (!COUNTRY.test(key.programCountry)) throw new Error(`país do programa inválido: ${key.programCountry}`);
  if (amount !== undefined && (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT))
    throw new Error(`quantidade de pontos inválida: ${amount}`);
}

function checkSource(source: string): asserts source is FanPointsSource {
  if (!(FAN_POINTS_SOURCES as readonly string[]).includes(source))
    throw new Error(`origem que não credita pontos: ${source}`);
}

const entryColumns = {
  id: fanPointsLedger.id,
  reason: fanPointsLedger.reason,
  source: fanPointsLedger.source,
  sourceEvent: fanPointsLedger.sourceEvent,
  revertsId: fanPointsLedger.revertsId,
  pointsDelta: fanPointsLedger.pointsDelta,
  balanceDelta: fanPointsLedger.balanceDelta,
  pointsAfter: fanPointsLedger.pointsAfter,
  balanceAfter: fanPointsLedger.balanceAfter,
  note: fanPointsLedger.note,
  createdAt: fanPointsLedger.createdAt,
};

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Faixa do Perfil ativo, ou null se não existe ou foi excluído. Trava a linha do Perfil (`for share`) até o fim
 * da transação: uma exclusão em andamento termina antes, e o lançamento vê o `deleted_at`.
 */
async function lockProfile(
  tx: Tx,
  key: FanWalletKey,
): Promise<{ ageBand: FanAgeBand; deleted: boolean } | null> {
  const [row] = await tx
    .select({ ageBand: fanProfile.ageBand, deletedAt: fanProfile.deletedAt })
    .from(fanProfile)
    .where(and(eq(fanProfile.tenantId, key.tenantId), eq(fanProfile.id, key.profileId)))
    .for('share');
  return row ? { ageBand: row.ageBand, deleted: row.deletedAt !== null } : null;
}

async function activeAgeBand(tx: Tx, key: FanWalletKey): Promise<FanAgeBand | null> {
  const p = await lockProfile(tx, key);
  return p && !p.deleted ? p.ageBand : null;
}

/** Trava a linha da carteira até o fim da transação; com `create`, cria antes se falta. */
async function lockWallet(
  tx: Tx,
  key: FanWalletKey,
  create = true,
): Promise<{ points: number; balance: number } | undefined> {
  if (create)
    await tx
      .insert(fanWallet)
      .values({ tenantId: key.tenantId, profileId: key.profileId, programCountry: key.programCountry })
      .onConflictDoNothing();
  const [row] = await tx
    .select({ points: fanWallet.points, balance: fanWallet.balance })
    .from(fanWallet)
    .where(
      and(
        eq(fanWallet.tenantId, key.tenantId),
        eq(fanWallet.profileId, key.profileId),
        eq(fanWallet.programCountry, key.programCountry),
      ),
    )
    .for('update');
  return row;
}

async function revertOf(tx: Tx, tenantId: string, entryId: string): Promise<FanLedgerEntry | undefined> {
  const [row] = await tx
    .select(entryColumns)
    .from(fanPointsLedger)
    .where(and(eq(fanPointsLedger.tenantId, tenantId), eq(fanPointsLedger.revertsId, entryId)));
  return row;
}

type EventKey = FanWalletKey & { source: FanPointsSource; sourceEvent: string; reason: FanCreditReason };

const revokedWhere = (k: EventKey) =>
  and(
    eq(fanPointsRevokedEvent.tenantId, k.tenantId),
    eq(fanPointsRevokedEvent.profileId, k.profileId),
    eq(fanPointsRevokedEvent.programCountry, k.programCountry),
    eq(fanPointsRevokedEvent.source, k.source),
    eq(fanPointsRevokedEvent.sourceEvent, k.sourceEvent),
    eq(fanPointsRevokedEvent.reason, k.reason),
  );

async function existingEntry(
  tx: Tx,
  key: FanWalletKey,
  source: FanPointsSource,
  sourceEvent: string,
  reason: FanPointsReason,
): Promise<FanLedgerEntry | undefined> {
  const [row] = await tx
    .select(entryColumns)
    .from(fanPointsLedger)
    .where(
      and(
        eq(fanPointsLedger.tenantId, key.tenantId),
        eq(fanPointsLedger.profileId, key.profileId),
        eq(fanPointsLedger.programCountry, key.programCountry),
        eq(fanPointsLedger.source, source),
        eq(fanPointsLedger.sourceEvent, sourceEvent),
        eq(fanPointsLedger.reason, reason),
        sql`${fanPointsLedger.revertsId} is null`,
      ),
    );
  return row;
}

async function apply(
  tx: Tx,
  key: FanWalletKey,
  current: { points: number; balance: number },
  entry: {
    reason: FanPointsReason;
    source: FanPointsSource;
    sourceEvent: string;
    revertsId?: string;
    pointsDelta: number;
    balanceDelta: number;
    note?: string | undefined;
  },
): Promise<FanLedgerEntry> {
  const pointsAfter = current.points + entry.pointsDelta;
  const balanceAfter = current.balance + entry.balanceDelta;
  await tx
    .update(fanWallet)
    .set({ points: pointsAfter, balance: balanceAfter, updatedAt: sql`now()` })
    .where(
      and(
        eq(fanWallet.tenantId, key.tenantId),
        eq(fanWallet.profileId, key.profileId),
        eq(fanWallet.programCountry, key.programCountry),
      ),
    );
  const [row] = await tx
    .insert(fanPointsLedger)
    .values({
      tenantId: key.tenantId,
      profileId: key.profileId,
      programCountry: key.programCountry,
      reason: entry.reason,
      source: entry.source,
      sourceEvent: entry.sourceEvent,
      revertsId: entry.revertsId ?? null,
      pointsDelta: entry.pointsDelta,
      balanceDelta: entry.balanceDelta,
      pointsAfter,
      balanceAfter,
      note: entry.note ?? null,
    })
    .returning(entryColumns);
  return row!;
}

/**
 * Credita Pontos (e o mesmo tanto de Saldo) por um evento de origem. Repetir o mesmo `source` + `sourceEvent` +
 * `reason` para o mesmo Perfil devolve o lançamento original, sem creditar de novo.
 */
export async function creditPoints(
  db: Database,
  input: FanWalletKey & {
    amount: number;
    reason: FanCreditReason;
    source: FanPointsSource;
    sourceEvent: string;
    note?: string;
  },
): Promise<FanWalletResult> {
  check(input, input.amount);
  checkSource(input.source);
  if ((input.reason as string) === 'redeem' || (input.reason as string) === 'revert')
    throw new Error(`creditPoints não aceita o motivo ${input.reason}`);
  return db.transaction(async (tx) => {
    const band = await activeAgeBand(tx, input);
    if (!band) return { ok: false, error: 'profile_not_found' };
    if (band === 'under13') return { ok: false, error: 'age_restricted' };
    const current = (await lockWallet(tx, input))!;
    const dup = await existingEntry(tx, input, input.source, input.sourceEvent, input.reason);
    // evento já estornado (palpite recalculado usa um `sourceEvent` novo, ex.: `palpite:1:v2`)
    if (dup)
      return (await revertOf(tx, input.tenantId, dup.id))
        ? { ok: false, error: 'reverted' }
        : { ok: true, entry: dup, duplicate: true };
    // o estorno chegou antes do crédito (fila fora de ordem): o crédito não entra
    const [revoked] = await tx
      .select({ at: fanPointsRevokedEvent.createdAt })
      .from(fanPointsRevokedEvent)
      .where(revokedWhere(input));
    if (revoked) return { ok: false, error: 'reverted' };
    const entry = await apply(tx, input, current, {
      reason: input.reason,
      source: input.source,
      sourceEvent: input.sourceEvent,
      pointsDelta: input.amount,
      balanceDelta: input.amount,
      note: input.note,
    });
    return { ok: true, entry, duplicate: false };
  });
}

/**
 * Gasta Saldo num resgate (só `18plus`). Os Pontos e o Ranking não mudam. Idempotente pelo `sourceEvent` do
 * resgate.
 */
export async function debitBalance(
  db: Database,
  input: FanWalletKey & { amount: number; source: FanPointsSource; sourceEvent: string; note?: string },
): Promise<FanWalletResult> {
  check(input, input.amount);
  checkSource(input.source);
  return db.transaction(async (tx) => {
    const band = await activeAgeBand(tx, input);
    if (!band) return { ok: false, error: 'profile_not_found' };
    if (band !== '18plus') return { ok: false, error: 'age_restricted' };
    const current = (await lockWallet(tx, input))!;
    const dup = await existingEntry(tx, input, input.source, input.sourceEvent, 'redeem');
    if (dup) return { ok: true, entry: dup, duplicate: true };
    if (current.balance < input.amount) return { ok: false, error: 'insufficient_balance' };
    const entry = await apply(tx, input, current, {
      reason: 'redeem',
      source: input.source,
      sourceEvent: input.sourceEvent,
      pointsDelta: 0,
      balanceDelta: -input.amount,
      note: input.note,
    });
    return { ok: true, entry, duplicate: false };
  });
}

/**
 * Estorna o crédito de um evento de origem (gol anulado, palpite recalculado). Tira os Pontos inteiros e o Saldo
 * até o que sobrou. Estornar de novo devolve o estorno já feito. Resgate não se estorna por aqui (é a Gamificação
 * que devolve, com um crédito `adjustment`). Funciona também com o Perfil excluído ou com faixa mudada.
 *
 * Estorno que chega antes do crédito (fila fora de ordem) responde `entry_not_found`, mas fica marcado: o crédito
 * desse evento que chegar depois é recusado (`reverted`). Depois de estornado, o mesmo evento não credita de novo;
 * o recálculo usa um `sourceEvent` novo.
 */
export async function revertPoints(
  db: Database,
  input: EventKey & { note?: string },
): Promise<FanWalletResult> {
  check(input);
  checkSource(input.source);
  return db.transaction(async (tx) => {
    const profile = await lockProfile(tx, input);
    if (!profile) return { ok: false, error: 'profile_not_found' };
    // não cria carteira: estorno sem crédito não deixa linha vazia (nem num Perfil excluído)
    const current = await lockWallet(tx, input, false);
    const original = current
      ? await existingEntry(tx, input, input.source, input.sourceEvent, input.reason)
      : undefined;
    if (!current || !original) {
      if (!profile.deleted)
        await tx
          .insert(fanPointsRevokedEvent)
          .values({
            tenantId: input.tenantId,
            profileId: input.profileId,
            programCountry: input.programCountry,
            source: input.source,
            sourceEvent: input.sourceEvent,
            reason: input.reason,
          })
          .onConflictDoNothing();
      return { ok: false, error: 'entry_not_found' };
    }
    if (original.pointsDelta <= 0) return { ok: false, error: 'not_revertible' };
    const already = await revertOf(tx, input.tenantId, original.id);
    if (already) return { ok: true, entry: already, duplicate: true };
    const pointsDelta = -Math.min(original.pointsDelta, current.points);
    const balanceDelta = -Math.min(original.balanceDelta, current.balance);
    const entry = await apply(tx, input, current, {
      reason: 'revert',
      source: input.source,
      sourceEvent: input.sourceEvent,
      revertsId: original.id,
      pointsDelta,
      balanceDelta,
      note: input.note,
    });
    return { ok: true, entry, duplicate: false };
  });
}

/** Carteiras do Perfil, uma por país de programa (vazio se nunca ganhou ponto). */
export async function readWallets(
  db: Database,
  tenantId: string,
  profileId: string,
): Promise<FanWalletView[]> {
  return db
    .select({
      programCountry: fanWallet.programCountry,
      points: fanWallet.points,
      balance: fanWallet.balance,
    })
    .from(fanWallet)
    .where(and(eq(fanWallet.tenantId, tenantId), eq(fanWallet.profileId, profileId)))
    .orderBy(fanWallet.programCountry);
}

/** Extrato de um programa, do mais novo para o mais antigo, paginado pelo id (UUID v7, ordenado no tempo). */
export async function readLedger(
  db: Database,
  key: FanWalletKey,
  opts: { limit: number; before?: string | undefined },
): Promise<FanLedgerEntry[]> {
  check(key);
  const conds = [
    eq(fanPointsLedger.tenantId, key.tenantId),
    eq(fanPointsLedger.profileId, key.profileId),
    eq(fanPointsLedger.programCountry, key.programCountry),
  ];
  if (opts.before) conds.push(lt(fanPointsLedger.id, opts.before));
  return db
    .select(entryColumns)
    .from(fanPointsLedger)
    .where(and(...conds))
    .orderBy(desc(fanPointsLedger.id))
    .limit(opts.limit);
}
