/**
 * Proteções da rota interna de revalidação, que o proxy deixa passar sem sessão (o chamador é o próprio
 * servidor): origem local e corpo com teto, lido em stream (um corpo grande nunca é carregado inteiro).
 */

/** Endereços do próprio host. */
export function isLoopback(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = address.trim().toLowerCase();
  return a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.');
}

/**
 * Quem conectou no servidor: o Next grava o endereço do socket em `x-forwarded-for` quando o header não
 * veio (base-server); atrás do Traefik, ele traz o cliente de verdade (o Traefik descarta o
 * `X-Forwarded-For` que chega de fora). O primeiro da lista é a origem.
 */
export function clientAddress(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`corpo acima de ${limit} bytes`);
  }
}

/**
 * Corpo como texto, com teto em bytes: recusa pelo Content-Length antes de ler e, sem ele (ou com ele
 * mentindo), para de ler assim que passa do teto.
 */
export async function readBodyWithLimit(request: Request, limit: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new BodyTooLargeError(limit);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(limit);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
