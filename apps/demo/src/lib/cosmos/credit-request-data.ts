/**
 * Pedidos de créditos da Cosmos na tela (#996): quem pode comprar vê os abertos e os últimos decididos; quem não pode
 * vê só os próprios. Com o nome de quem pediu e de quem decidiu. Só servidor.
 */
import { listCreditRequests, type CreditRequestStatus } from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';

import { people } from './data';

export interface CreditRequestView {
  id: string;
  status: CreditRequestStatus;
  reason: string;
  requester: string | null;
  mine: boolean;
  decider: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export async function loadCreditRequests(
  tenantId: string,
  userId: string,
  canManage: boolean,
): Promise<CreditRequestView[]> {
  const rows = await listCreditRequests(builderDb(), tenantId, {
    ...(canManage ? {} : { requestedBy: userId }),
    limit: canManage ? 30 : 5,
  });
  const who = await people(rows.flatMap((r) => [r.requestedBy, r.decidedBy]));
  const name = (id: string | null) => (id ? who.get(id)?.name?.trim() || null : null);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    requester: name(r.requestedBy),
    mine: r.requestedBy === userId,
    decider: name(r.decidedBy),
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
}
