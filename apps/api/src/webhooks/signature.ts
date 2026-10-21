import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Header com a assinatura: `t=<unix segundos>,v1=<hex HMAC-SHA256(segredo, "<t>.<corpo>")>`. */
export const SIGNATURE_HEADER = 'x-galaxie-signature';

/** Segredo de assinatura de um endpoint (exibido uma única vez, na criação). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Valor do header `x-galaxie-signature` para o corpo exato enviado. */
export function signWebhook(secret: string, body: string, timestampSec: number): string {
  return `t=${timestampSec},v1=${hmac(secret, timestampSec, body)}`;
}

/**
 * Verifica a assinatura (o mesmo algoritmo do snippet em docs/05 §5.2): HMAC do corpo bruto,
 * comparação em tempo constante e janela de tolerância contra replay.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | undefined,
  options: { toleranceSec?: number; nowSec?: number } = {},
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  const now = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (options.toleranceSec ?? 300)) return false;
  const expected = Buffer.from(hmac(secret, t, body), 'hex');
  const received = Buffer.from(parts.v1, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
