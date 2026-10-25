import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Headers de segurança de uma resposta. Exposto para rotas que assumem o socket (`reply.hijack()`,
     * como o SSE), que não passam pelos hooks `onSend`.
     */
    securityHeaders?: (request: FastifyRequest, contentType: string) => Record<string, string>;
  }
}

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

  const headersFor = (request: FastifyRequest, contentType: string): Record<string, string> => {
    const headers: Record<string, string> = {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'x-permitted-cross-domain-policies': 'none',
      'x-dns-prefetch-control': 'off',
      'origin-agent-cluster': '?1',
      'content-security-policy': contentType.startsWith('text/html') ? DOCS_CSP : API_CSP,
    };
    if (hsts) headers['strict-transport-security'] = hsts;
    // rotas internas nunca devem ser indexadas nem guardadas por intermediários
    if (request.url.startsWith('/internal/')) headers['x-robots-tag'] = 'noindex, nofollow';
    return headers;
  };
  app.decorate('securityHeaders', headersFor);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.headers(headersFor(request, String(reply.getHeader('content-type') ?? '')));
    return payload;
  });
}
