/**
 * Rastro da equipe Galaxie no painel do cliente (PL17): toda escrita de `admin` ou `support` sobre um tenant que não é
 * da Galaxie grava `billing.staff_action` com quem, o quê, por quê e o que foi pedido. O motivo vem do cookie assinado
 * que o seletor de tenant grava (`staff-reason.ts`); sem motivo, a ação do servidor recusa antes de tocar no banco.
 *
 * `withStaffAudit(nome, ação)` embrulha cada ação de escrita de `app/[locale]/(app)/client/** /actions.ts`: para o
 * cliente é transparente; para a equipe, exige o motivo e grava depois de `ok`. O teste ao lado confere que nenhuma
 * ação de escrita ficou de fora.
 */
import { cookies } from 'next/headers';

import { pool } from '@/lib/auth/db';
import { isStaffRole } from '@/lib/auth/roles';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

import { readClientContext, type ClientContext } from './session';
import { decodeStaffReason, STAFF_REASON_COOKIE, type StaffReason } from './staff-reason';

/** Ação da equipe sem motivo registrado: o servidor recusa. */
export class StaffReasonError extends Error {
  constructor() {
    super('staff reason required');
    this.name = 'StaffReasonError';
  }
}

/** A sessão é da equipe Galaxie e o tenant em foco é de um cliente (não é o da Galaxie)? */
export const needsStaffReason = (
  ctx: Pick<ClientContext, 'role' | 'tenant'> | null | undefined,
): ctx is ClientContext & { tenant: NonNullable<ClientContext['tenant']> } =>
  Boolean(ctx && isStaffRole(ctx.role) && ctx.tenant && !ctx.tenant.isGalaxie);

const secret = () => process.env.BETTER_AUTH_SECRET ?? '';

/** O motivo gravado para o tenant (cookie assinado), ou null (sem motivo, vencido, de outro tenant). */
export async function readStaffReason(tenantId: string): Promise<StaffReason | null> {
  const value = (await cookies()).get(STAFF_REASON_COOKIE)?.value;
  return decodeStaffReason(secret(), value, tenantId);
}

/** Tamanho máximo do pedido copiado no registro (o que passar disso fica cortado, marcado). */
const PAYLOAD_MAX = 4_000;

/** O pedido da ação como JSON, cortado se for grande demais; nunca lança. */
export function auditPayload(input: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  let text: string;
  try {
    text = JSON.stringify(input) ?? 'undefined';
  } catch {
    return { input: String(input) };
  }
  if (text.length <= PAYLOAD_MAX) return { input: JSON.parse(text) as unknown };
  return { input: text.slice(0, PAYLOAD_MAX), truncated: true };
}

/**
 * Grava a ação da equipe sobre o tenant em foco. Fora do caso (cliente, ou tenant da Galaxie), não grava nada; para a
 * equipe sem motivo, lança `StaffReasonError`.
 */
export async function recordStaffAction(
  ctx: ClientContext,
  action: string,
  payload?: Record<string, unknown> | null,
): Promise<void> {
  if (!needsStaffReason(ctx)) return;
  const reason = await readStaffReason(ctx.tenant.id);
  if (!reason) throw new StaffReasonError();
  await pool.query(
    `insert into billing.staff_action (tenant_id, organization_id, actor, action, reason, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [ctx.tenant.id, ctx.tenant.organizationId, ctx.userId, action, reason.reason, payload ?? null],
  );
}

interface AuditedResult {
  ok: boolean;
  error?: string;
}

/**
 * Embrulha uma ação de escrita do painel: para a equipe num tenant de cliente, recusa sem motivo (erro traduzido) e,
 * depois de `ok`, grava `billing.staff_action` com `name` e o primeiro argumento como pedido. Para o cliente, só chama
 * a ação. `name` é `area.verbo` (`keys.create`, `members.invite`).
 */
export function withStaffAudit<A extends unknown[], R extends AuditedResult>(
  name: string,
  action: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const ctx = await readClientContext();
    const audited = needsStaffReason(ctx);
    if (audited && !(await readStaffReason(ctx.tenant.id))) {
      const t = getDictionary(await getRequestLocale()).client.staff;
      return { ok: false, error: t.reasonRequired } as R;
    }
    const result = await action(...args);
    if (audited && result.ok) await recordStaffAction(ctx, name, auditPayload(args[0]));
    return result;
  };
}

/** Uma ação da equipe, como a tela de Ajustes mostra. */
export interface StaffActionRow {
  id: string;
  tenantId: string | null;
  organizationId: string | null;
  actor: string;
  actorEmail: string | null;
  action: string;
  reason: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

/** Ações da equipe sobre uma organização e as marcas dela, da mais nova à mais antiga. */
export async function listStaffActions(organizationId: string, limit = 100): Promise<StaffActionRow[]> {
  const { rows } = await pool.query<{
    id: string;
    tenant_id: string | null;
    organization_id: string | null;
    actor: string;
    actor_email: string | null;
    action: string;
    reason: string;
    payload: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `select a.id::text, a.tenant_id::text as tenant_id, a.organization_id::text as organization_id, a.actor,
            u.email as actor_email, a.action, a.reason, a.payload, a.created_at
       from billing.staff_action a
       left join "user" u on u.id = a.actor
      where a.organization_id = $1
         or a.tenant_id in (select id from api.tenant where organization_id = $1)
      order by a.id desc
      limit $2`,
    [organizationId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    organizationId: r.organization_id,
    actor: r.actor,
    actorEmail: r.actor_email,
    action: r.action,
    reason: r.reason,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  }));
}
