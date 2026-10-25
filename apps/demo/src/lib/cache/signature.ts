/**
 * Assinatura da rota interna de revalidação (`REVALIDATE_ROUTE`), chamada pelo seguidor do change feed
 * que roda no próprio servidor da demo: `x-galaxie-revalidate: <unix>.<hmac>`, HMAC-SHA256 sobre
 * `cache-revalidate:<unix>:<corpo>`, validade de 5 minutos (mesmo desenho do smoke test, lib/ops/smoke.ts).
 * O segredo é o BETTER_AUTH_SECRET (quem o tem já forjaria uma sessão); sem ele, um segredo aleatório do
 * processo, que o seguidor e a rota compartilham por estarem no mesmo servidor.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const REVALIDATE_ROUTE = '/api/interno/revalidar';
export const REVALIDATE_HEADER = 'x-galaxie-revalidate';
const MAX_SKEW_S = 300;

const mac = (secret: string, unix: number, body: string) =>
  createHmac('sha256', secret).update(`cache-revalidate:${unix}:${body}`).digest('hex');

export function signRevalidate(secret: string, unix: number, body: string): string {
  return `${unix}.${mac(secret, unix, body)}`;
}

export function verifyRevalidate(
  header: string | null,
  secret: string | undefined,
  body: string,
  nowMs: number,
): boolean {
  if (!header || !secret) return false;
  const [ts, got] = header.split('.');
  const unix = Number(ts);
  if (!Number.isInteger(unix) || !got || Math.abs(nowMs / 1000 - unix) > MAX_SKEW_S) return false;
  const expected = Buffer.from(mac(secret, unix, body), 'hex');
  const received = Buffer.from(got, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const PROCESS_SECRET = Symbol.for('galaxie.demo.revalidate-secret');

/** Segredo compartilhado entre o seguidor e a rota (o mesmo processo do servidor Next). */
export function revalidateSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET;
  if (configured) return configured;
  const g = globalThis as { [PROCESS_SECRET]?: string };
  g[PROCESS_SECRET] ??= randomBytes(32).toString('hex');
  return g[PROCESS_SECRET];
}
