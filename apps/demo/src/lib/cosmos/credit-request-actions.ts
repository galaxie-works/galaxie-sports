'use server';

/**
 * Pedido de créditos ao dono (#996). Quem vê a Cosmos sem poder comprar pede com uma justificativa; o Dono (e quem
 * tiver `cosmos.manage`) recebe na tela e por e-mail, aprova (a tela abre a compra) ou recusa. Tenant e cargo saem
 * da sessão; o pacote garante o estado (um aberto por pessoa, só aberto anda).
 */
import {
  approveWithQuota,
  cancelCreditRequest,
  createCreditRequest,
  decideCreditRequest,
  isCosmosError,
  isQuotaScope,
  listCreditRequests,
} from '@galaxie/cosmos';

import { pool } from '@/lib/auth/db';
import { sendAccessEmail } from '@/lib/auth/email';
import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface CreditRequestResult {
  ok: boolean;
  error?: string;
}

type Texts = ReturnType<typeof getDictionary>['cosmos']['creditRequests'];

async function gate(manage: boolean) {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const t = getDictionary(locale).cosmos.creditRequests;
  if (!ctx?.tenant || !ctx.actor || !can(ctx, 'cosmos.view')) return { error: t.errors.forbidden } as const;
  if (manage && !can(ctx, 'cosmos.manage')) return { error: t.errors.notOwner } as const;
  return { ctx: { ...ctx, tenant: ctx.tenant }, t, locale } as const;
}

function failure(err: unknown, t: Texts): CreditRequestResult {
  if (isCosmosError(err)) {
    if (err.code === 'reason_required') return { ok: false, error: t.errors.reason };
    if (err.code === 'request_open') return { ok: false, error: t.errors.alreadyOpen };
    if (err.code === 'request_closed') return { ok: false, error: t.errors.closed };
    if (err.code === 'note_too_long') return { ok: false, error: t.errors.note };
    if (err.code === 'invalid_quota') return { ok: false, error: t.quotaInvalid };
    if (err.code === 'no_wallet') return { ok: false, error: t.errors.generic };
  }
  console.error('[cosmos] pedido de créditos falhou', err);
  return { ok: false, error: t.errors.generic };
}

/** Um aviso por e-mail por pessoa nesta janela: pedir, cancelar e pedir de novo não lota a caixa dos Donos. */
const EMAIL_WINDOW_MS = 30 * 60_000;

/**
 * E-mail para os Donos com usuário no console e convite aceito. Falha de envio não desfaz o pedido: ele já está na
 * tela. Vai no idioma de quem pediu (a demo não guarda o idioma de cada pessoa).
 */
async function notifyOwners(input: {
  tenantId: string;
  tenantName: string;
  requesterId: string;
  reason: string;
  locale: Awaited<ReturnType<typeof getRequestLocale>>;
}) {
  const { rows } = await pool.query<{ email: string; name: string; requester: string | null }>(
    `select u.email, u.name, (select r.name from "user" r where r.id = $2) as requester
       from api.tenant_member m join "user" u on u.id = m.user_id
      where m.tenant_id = $1 and m.role = 'owner' and m.user_id <> $2 and m.accepted_at is not null`,
    [input.tenantId, input.requesterId],
  );
  const base = (process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  await Promise.all(
    rows.map((r) =>
      sendAccessEmail({
        kind: 'credit_request',
        to: r.email,
        name: r.name,
        requester: r.requester?.trim() || getDictionary(input.locale).cosmos.creditRequests.someone,
        tenant: input.tenantName,
        reason: input.reason,
        url: `${base}/cliente/cosmos`,
        locale: input.locale,
      }),
    ),
  );
}

export async function requestCosmosCredits(reason: string): Promise<CreditRequestResult> {
  const g = await gate(false);
  if ('error' in g) return { ok: false, error: g.error };
  // quem já pode comprar não pede: compra
  if (can(g.ctx, 'cosmos.manage')) return { ok: false, error: g.t.errors.canBuy };
  if (typeof reason !== 'string') return { ok: false, error: g.t.errors.reason };
  try {
    const r = await createCreditRequest(builderDb(), {
      tenantId: g.ctx.tenant.id,
      userId: g.ctx.userId,
      reason,
    });
    const recent = await listCreditRequests(builderDb(), g.ctx.tenant.id, {
      requestedBy: g.ctx.userId,
      since: new Date(Date.now() - EMAIL_WINDOW_MS),
      limit: 2,
    });
    if (recent.length <= 1)
      await notifyOwners({
        tenantId: g.ctx.tenant.id,
        tenantName: g.ctx.tenant.name,
        requesterId: g.ctx.userId,
        reason: r.reason,
        locale: g.locale,
      }).catch((err) => console.error('[cosmos] aviso do pedido de créditos não saiu', err));
    return { ok: true };
  } catch (err) {
    return failure(err, g.t);
  }
}

/** Aumento de cota pedido junto com a aprovação (#1116): sala e pontos percentuais. */
export interface QuotaRaise {
  scope: string;
  addPercent: number;
}

const validRaise = (r: QuotaRaise) =>
  isQuotaScope(r.scope) && typeof r.addPercent === 'number' && r.addPercent > 0 && r.addPercent <= 100;

/**
 * Aprova ou recusa. Aprovar com `raise` também aumenta a cota da sala (#1116), em vez de só abrir a compra: aprovação e
 * aumento entram na mesma transação (se a cota não puder subir, o pedido continua aberto).
 */
export async function decideCosmosCreditRequest(
  requestId: string,
  decision: 'approved' | 'declined',
  note?: string,
  raise?: QuotaRaise,
): Promise<CreditRequestResult> {
  const g = await gate(true);
  if ('error' in g) return { ok: false, error: g.error };
  if (!isUuid(requestId) || (decision !== 'approved' && decision !== 'declined'))
    return { ok: false, error: g.t.errors.closed };
  if (raise && (decision !== 'approved' || typeof raise !== 'object' || !validRaise(raise)))
    return { ok: false, error: g.t.quotaError };
  try {
    if (raise)
      await approveWithQuota(builderDb(), {
        tenantId: g.ctx.tenant.id,
        requestId,
        userId: g.ctx.userId,
        scope: raise.scope,
        addPercent: raise.addPercent,
        note: typeof note === 'string' ? note : null,
      });
    else
      await decideCreditRequest(builderDb(), {
        tenantId: g.ctx.tenant.id,
        requestId,
        decision,
        userId: g.ctx.userId,
        note: typeof note === 'string' ? note : null,
      });
    return { ok: true };
  } catch (err) {
    return failure(err, g.t);
  }
}

export async function cancelCosmosCreditRequest(requestId: string): Promise<CreditRequestResult> {
  const g = await gate(false);
  if ('error' in g) return { ok: false, error: g.error };
  if (!isUuid(requestId)) return { ok: false, error: g.t.errors.closed };
  try {
    await cancelCreditRequest(builderDb(), { tenantId: g.ctx.tenant.id, requestId, userId: g.ctx.userId });
    return { ok: true };
  } catch (err) {
    return failure(err, g.t);
  }
}
