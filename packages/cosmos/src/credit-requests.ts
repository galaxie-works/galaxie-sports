/**
 * Pedido de créditos ao dono (#996). Quem vê a Cosmos mas não pode comprar escreve uma justificativa; quem pode
 * comprar (`cosmos.manage`) aprova, e a tela abre a compra, ou recusa com uma nota. Um pedido aberto por pessoa e
 * tenant; quem pediu pode cancelar o próprio. Cada mudança de estado guarda quem fez e quando.
 *
 * Quem pode pedir e quem pode decidir é checado por quem chama (o painel, pelo `can()` de `@galaxie/engage`); aqui
 * fica o estado: só um pedido aberto anda, e nunca de volta.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
// subcaminhos, não o índice: o índice traz o migrator (pasta drizzle/), que o bundler do Next não resolve
import type { Database } from '@galaxie/db/client';
import { CREDIT_REQUEST_STATUSES, creditRequest, type CreditRequestStatus } from '@galaxie/db/schema';
import { CosmosError } from './errors.js';

export { CREDIT_REQUEST_STATUSES, type CreditRequestStatus };

export const CREDIT_REQUEST_REASON_MIN = 5;
export const CREDIT_REQUEST_REASON_MAX = 500;
export const CREDIT_REQUEST_NOTE_MAX = 500;

export interface CreditRequest {
  id: string;
  requestedBy: string;
  reason: string;
  status: CreditRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

type Row = typeof creditRequest.$inferSelect;
const toRequest = (r: Row): CreditRequest => ({
  id: r.id,
  requestedBy: r.requestedBy,
  reason: r.reason,
  status: r.status,
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt,
  decisionNote: r.decisionNote,
  createdAt: r.createdAt,
});

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

/** Abre um pedido. Justificativa de 5 a 500 caracteres; a mesma pessoa não abre dois ao mesmo tempo. */
export async function createCreditRequest(
  db: Pick<Database, 'insert'>,
  input: { tenantId: string; userId: string; reason: string },
): Promise<CreditRequest> {
  const reason = input.reason.trim();
  if (reason.length < CREDIT_REQUEST_REASON_MIN || reason.length > CREDIT_REQUEST_REASON_MAX)
    throw new CosmosError('reason_required', 'justificativa de 5 a 500 caracteres');
  try {
    const [row] = await db
      .insert(creditRequest)
      .values({ tenantId: input.tenantId, requestedBy: input.userId, reason })
      .returning();
    return toRequest(row!);
  } catch (err) {
    if (isUniqueViolation(err))
      throw new CosmosError('request_open', 'já existe um pedido aberto desta pessoa');
    throw err;
  }
}

/** Pedidos do tenant, do mais novo ao mais antigo; com `status`, só esses; com `requestedBy`, só os da pessoa. */
export async function listCreditRequests(
  db: Pick<Database, 'select'>,
  tenantId: string,
  options: { status?: readonly CreditRequestStatus[]; requestedBy?: string; limit?: number } = {},
): Promise<CreditRequest[]> {
  const where = [eq(creditRequest.tenantId, tenantId)];
  if (options.status?.length) where.push(inArray(creditRequest.status, [...options.status]));
  if (options.requestedBy) where.push(eq(creditRequest.requestedBy, options.requestedBy));
  const rows = await db
    .select()
    .from(creditRequest)
    .where(and(...where))
    .orderBy(desc(creditRequest.id))
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
  return rows.map(toRequest);
}

/** Fecha um pedido aberto. Pedido de outro tenant, inexistente ou já fechado dá `request_closed`. */
async function close(
  db: Pick<Database, 'update'>,
  input: {
    tenantId: string;
    requestId: string;
    status: Exclude<CreditRequestStatus, 'open'>;
    userId: string;
    note?: string | null;
    onlyRequester?: boolean;
  },
): Promise<CreditRequest> {
  const note = input.note?.trim() || null;
  if (note && note.length > CREDIT_REQUEST_NOTE_MAX)
    throw new CosmosError('reason_required', 'nota até 500 caracteres');
  const where = [
    eq(creditRequest.id, input.requestId),
    eq(creditRequest.tenantId, input.tenantId),
    eq(creditRequest.status, 'open'),
  ];
  if (input.onlyRequester) where.push(eq(creditRequest.requestedBy, input.userId));
  const [row] = await db
    .update(creditRequest)
    .set({ status: input.status, decidedBy: input.userId, decidedAt: new Date(), decisionNote: note })
    .where(and(...where))
    .returning();
  if (!row) throw new CosmosError('request_closed', 'pedido inexistente, de outro tenant ou já fechado');
  return toRequest(row);
}

/** Aprovar (a tela abre a compra) ou recusar, por quem pode comprar. */
export function decideCreditRequest(
  db: Pick<Database, 'update'>,
  input: {
    tenantId: string;
    requestId: string;
    decision: 'approved' | 'declined';
    userId: string;
    note?: string | null;
  },
): Promise<CreditRequest> {
  return close(db, { ...input, status: input.decision });
}

/** Quem pediu desiste do próprio pedido. */
export function cancelCreditRequest(
  db: Pick<Database, 'update'>,
  input: { tenantId: string; requestId: string; userId: string },
): Promise<CreditRequest> {
  return close(db, { ...input, status: 'canceled', onlyRequester: true });
}
