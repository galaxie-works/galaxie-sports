/**
 * Assinatura do smoke test (infra/vps-telemetry/smoke.mjs), que roda dentro do contêiner da demo e não
 * tem sessão de admin: `x-galaxie-smoke: <unix>.<hmac>`, com HMAC-SHA256 do BETTER_AUTH_SECRET sobre
 * `ops-smoke:<unix>` e validade de 5 minutos. Quem tem esse segredo já poderia forjar uma sessão, então
 * não amplia acesso; e a rota devolve o mesmo conteúdo do painel, sem valor de credencial.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SMOKE_HEADER = 'x-galaxie-smoke';
const MAX_SKEW_S = 300;

export function smokeSignature(secret: string, unix: number): string {
  return `${unix}.${createHmac('sha256', secret).update(`ops-smoke:${unix}`).digest('hex')}`;
}

export function verifySmokeSignature(
  header: string | null,
  secret: string | undefined,
  nowMs: number,
): boolean {
  if (!header || !secret) return false;
  const [ts, mac] = header.split('.');
  const unix = Number(ts);
  if (!Number.isInteger(unix) || !mac || Math.abs(nowMs / 1000 - unix) > MAX_SKEW_S) return false;
  const expected = Buffer.from(smokeSignature(secret, unix).split('.')[1]!, 'hex');
  const got = Buffer.from(mac, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}
