/**
 * O motivo com que a equipe Galaxie age num tenant de cliente (PL17): ao escolher o tenant no seletor, a pessoa informa
 * o ticket ou o pedido do cliente, e ele fica num cookie assinado (`galaxie-staff-reason`, httpOnly, 8 h). Toda
 * escrita sobre o tenant lê o motivo daqui e grava em `billing.staff_action` (`staff.ts`). Puro, com o segredo
 * passado: o cookie é `<payload em base64url>.<HMAC-SHA256>`, preso ao tenant e com prazo; sem assinatura válida, ou
 * de outro tenant, não vale.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STAFF_REASON_COOKIE = 'galaxie-staff-reason';
/** Validade do motivo: um turno de trabalho. */
export const STAFF_REASON_TTL_S = 8 * 60 * 60;
/** O mesmo mínimo do CHECK de `billing.staff_action`. */
export const STAFF_REASON_MIN = 5;
export const STAFF_REASON_MAX = 500;

export interface StaffReason {
  tenantId: string;
  reason: string;
  /** Vencimento, em segundos desde a época. */
  exp: number;
}

/** Motivo aceitável: aparado, entre o mínimo e o máximo. */
export function normalizeStaffReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim().replace(/\s+/g, ' ');
  return reason.length >= STAFF_REASON_MIN ? reason.slice(0, STAFF_REASON_MAX) : null;
}

const mac = (secret: string, payload: string) =>
  createHmac('sha256', createHmac('sha256', secret).update('staff-reason').digest())
    .update(payload)
    .digest('base64url');

/** Valor do cookie para `reason` no tenant, vencendo em `STAFF_REASON_TTL_S` a partir de `nowS`. */
export function encodeStaffReason(
  secret: string,
  input: { tenantId: string; reason: string },
  nowS = Math.floor(Date.now() / 1000),
): string {
  const payload = Buffer.from(
    JSON.stringify({ tenantId: input.tenantId, reason: input.reason, exp: nowS + STAFF_REASON_TTL_S }),
  ).toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

/** O motivo do cookie, se a assinatura confere, é do tenant em foco e ainda não venceu; senão null. */
export function decodeStaffReason(
  secret: string,
  value: string | undefined | null,
  tenantId: string,
  nowS = Math.floor(Date.now() / 1000),
): StaffReason | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const want = Buffer.from(mac(secret, payload));
  const got = Buffer.from(value.slice(dot + 1));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const r = parsed as Partial<StaffReason> | null;
  if (!r || typeof r.tenantId !== 'string' || typeof r.reason !== 'string' || typeof r.exp !== 'number')
    return null;
  if (r.tenantId !== tenantId || r.exp <= nowS) return null;
  return { tenantId: r.tenantId, reason: r.reason, exp: r.exp };
}
