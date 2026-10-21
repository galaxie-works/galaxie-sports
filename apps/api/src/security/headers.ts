import type { FastifyInstance } from 'fastify';

export interface SecurityHeadersOptions {
  /**
   * Strict-Transport-Security (s). Só faz sentido atrás de HTTPS; 0/ausente = não envia.
   * Recomendado em produção: 31536000 (1 ano).
   */
  hstsMaxAgeSec?: number;
}

/** CSP de uma API JSON: nada pode ser carregado nem embutido. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/**
 * A referência interativa (/docs) carrega o Scalar de CDN e aplica estilos/fontes próprios; ali
 * só bloqueamos o enquadramento (clickjacking) e mantemos os demais headers.
 */
const DOCS_CSP = "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * Headers de segurança no estilo helmet, sem dependência extra. Aplicados a toda resposta
 * (inclusive erros e 404). Fastify não envia `x-powered-by`.
 */
export function registerSecurityHeaders(app: FastifyInstance, options: SecurityHeadersOptions = {}): void {
  const hsts = options.hstsMaxAgeSec
    ? `max-age=${Math.floor(options.hstsMaxAgeSec)}; includeSubDomains`
    : null;

  app.addHook('onSend', async (request, reply, payload) => {
    const isHtml = String(reply.getHeader('content-type') ?? '').startsWith('text/html');
    reply
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer')
      .header('cross-origin-opener-policy', 'same-origin')
      .header('cross-origin-resource-policy', 'same-origin')
      .header('x-permitted-cross-domain-policies', 'none')
      .header('x-dns-prefetch-control', 'off')
      .header('origin-agent-cluster', '?1')
      .header('content-security-policy', isHtml ? DOCS_CSP : API_CSP);
    if (hsts) reply.header('strict-transport-security', hsts);
    // rotas internas nunca devem ser indexadas nem guardadas por intermediários
    if (request.url.startsWith('/internal/')) reply.header('x-robots-tag', 'noindex, nofollow');
    return payload;
  });
}
