/**
 * Assinatura da rota interna de revalidação (`REVALIDATE_ROUTE`), chamada pelo seguidor do change feed
 * que roda no próprio servidor da demo: `x-galaxie-revalidate: <unix>.<sha256 do corpo>.<hmac>`, com
 * HMAC-SHA256 sobre `cache-revalidate:<unix>:<sha256 do corpo>` e validade de 5 minutos (desenho do smoke
 * test, lib/ops/smoke.ts).
 *
 * O resumo do corpo vai no header para a rota recusar quem não tem o segredo antes de ler um byte do
 * corpo (`verifyRevalidateHeader`); depois de ler, com teto, ela confere que o corpo é o resumido
 * (`bodyMatches`). O segredo é o BETTER_AUTH_SECRET (quem o tem já forjaria uma sessão); sem ele, um
 * segredo aleatório do processo, que o seguidor e a rota compartilham por estarem no mesmo servidor.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const REVALIDATE_ROUTE = '/api/interno/revalidar';
export const REVALIDATE_HEADER = 'x-galaxie-revalidate';
const MAX_SKEW_S = 300;

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');
const mac = (secret: string, unix: number, digest: string) =>
  createHmac('sha256', secret).update(`cache-revalidate:${unix}:${digest}`).digest('hex');

const sameHex = (a: string, b: string) => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export function signRevalidate(secret: string, unix: number, body: string): string {
  const digest = sha256(body);
  return `${unix}.${digest}.${mac(secret, unix, digest)}`;
}

/**
 * Confere só o header (segredo e janela de tempo), sem o corpo. Devolve o resumo do corpo assinado, ou
 * null se a assinatura não vale.
 */
export function verifyRevalidateHeader(
  header: string | null,
  secret: string | undefined,
  nowMs: number,
): { digest: string } | null {
  if (!header || !secret) return null;
  const [ts, digest, got, ...rest] = header.split('.');
  const unix = Number(ts);
  if (rest.length || !Number.isInteger(unix) || !digest || !got) return null;
  if (!/^[0-9a-f]{64}$/.test(digest) || Math.abs(nowMs / 1000 - unix) > MAX_SKEW_S) return null;
  return sameHex(got, mac(secret, unix, digest)) ? { digest } : null;
}

/** O corpo lido é o que foi assinado? */
export function bodyMatches(digest: string, body: string): boolean {
  return sameHex(digest, sha256(body));
}

/** Header e corpo juntos (testes e chamadas que já têm o corpo). */
export function verifyRevalidate(
  header: string | null,
  secret: string | undefined,
  body: string,
  nowMs: number,
): boolean {
  const signed = verifyRevalidateHeader(header, secret, nowMs);
  return signed !== null && bodyMatches(signed.digest, body);
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
