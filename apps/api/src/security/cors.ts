import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface CorsOptions {
  /**
   * Origens autorizadas (ex.: `https://app.exemplo.com`). `*` libera qualquer origem — aceitável
   * porque a autenticação é por header (sem cookies), mas prefira a lista explícita. Vazio = sem CORS.
   */
  origins: string[];
  /** Cache do preflight no navegador (s). Padrão 600. */
  maxAgeSec?: number;
}

/**
 * CORS das chaves publicáveis: cada chave libera só as próprias origens. O preflight chega sem
 * chave, então ele é respondido para as origens de alguma chave ativa; a resposta real só leva
 * `Access-Control-Allow-Origin` quando a origem bateu com a chave usada (`request.publishableOrigin`).
 */
export interface PublishableCors {
  isRegisteredOrigin(origin: string): Promise<boolean>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Origem já conferida contra a chave publicável desta requisição. */
    publishableOrigin?: string;
  }
  interface FastifyInstance {
    /**
     * Headers CORS de uma resposta (sem preflight). Exposto para rotas que assumem o socket
     * (`reply.hijack()`, como o SSE), que não passam pelos hooks `onSend`. Ausente = CORS desligado.
     */
    corsHeaders?: (request: FastifyRequest) => Record<string, string>;
  }
}

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST'];
/** Chave publicável: só leitura. */
const PUBLISHABLE_METHODS = ['GET', 'HEAD'];
const ALLOWED_HEADERS = [
  'x-galaxie-key',
  'x-galaxie-publishable-key',
  'content-type',
  'accept-language',
  'if-none-match',
  'last-event-id',
];
const EXPOSED_HEADERS = [
  'etag',
  'content-language',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-galaxie-quota-limit',
  'x-galaxie-quota-remaining',
  'x-galaxie-quota-warning',
  'x-galaxie-source',
  'x-galaxie-fetched-at',
  'x-galaxie-asset-base',
  'x-galaxie-cache',
];

/** Normaliza uma origem (`scheme://host[:porta]`, minúsculas, sem barra final); inválida → null. */
export function normalizeOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.pathname !== '/' || u.search || u.hash || u.username) return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * CORS estrito, sem dependência extra: só as origens configuradas recebem
 * `Access-Control-Allow-Origin`; nunca com credenciais; rotas `/internal/*` nunca recebem CORS.
 * Preflight (`OPTIONS`) responde 204 — com os headers CORS só se a origem e o método forem aceitos.
 */
export function registerCors(
  app: FastifyInstance,
  options: CorsOptions,
  publishable?: PublishableCors,
): void {
  const any = options.origins.includes('*');
  const allowed = new Set(
    options.origins
      .filter((o) => o !== '*')
      .map((o) => {
        const n = normalizeOrigin(o);
        if (!n) throw new Error(`CORS_ORIGINS: origem inválida "${o}"`);
        return n;
      }),
  );
  const maxAge = String(options.maxAgeSec ?? 600);

  const allowOrigin = (origin: string | undefined, url: string): string | null => {
    if (!origin || url.startsWith('/internal/')) return null;
    if (any) return '*';
    const n = normalizeOrigin(origin);
    return n && allowed.has(n) ? origin : null;
  };

  const corsHeaders = (request: FastifyRequest): Record<string, string> => {
    const origin =
      request.publishableOrigin && request.publishableOrigin === request.headers.origin
        ? request.publishableOrigin
        : allowOrigin(request.headers.origin, request.url);
    return origin
      ? { 'access-control-allow-origin': origin, 'access-control-expose-headers': EXPOSED_HEADERS.join(', ') }
      : {};
  };
  app.decorate('corsHeaders', corsHeaders);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('vary', mergeVary(reply.getHeader('vary'), 'Origin'));
    if (reply.hasHeader('access-control-allow-origin')) return payload; // preflight publicável
    const headers = corsHeaders(request);
    if (!headers['access-control-allow-origin']) return payload;
    reply.headers(headers);
    if (request.method === 'OPTIONS') {
      const method = String(request.headers['access-control-request-method'] ?? '').toUpperCase();
      if (ALLOWED_METHODS.includes(method)) {
        reply
          .header('access-control-allow-methods', ALLOWED_METHODS.join(', '))
          .header('access-control-allow-headers', ALLOWED_HEADERS.join(', '))
          .header('access-control-max-age', maxAge);
      }
    }
    return payload;
  });

  // Preflight para qualquer rota pública (rotas internas caem no 404).
  app.options('/*', { config: { public: true } }, async (request, reply) => {
    if (request.url.startsWith('/internal/')) return reply.callNotFound();
    const origin = request.headers.origin;
    const method = String(request.headers['access-control-request-method'] ?? '').toUpperCase();
    if (
      publishable &&
      origin &&
      !allowOrigin(origin, request.url) &&
      request.url.startsWith('/v1/') &&
      PUBLISHABLE_METHODS.includes(method) &&
      (await publishable.isRegisteredOrigin(origin))
    ) {
      reply
        .header('access-control-allow-origin', origin)
        .header('access-control-allow-methods', PUBLISHABLE_METHODS.join(', '))
        .header('access-control-allow-headers', ALLOWED_HEADERS.join(', '))
        .header('access-control-max-age', maxAge);
    }
    return reply.code(204).send();
  });
}

function mergeVary(current: unknown, value: string): string {
  const parts = String(current ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === value.toLowerCase())) parts.push(value);
  return parts.join(', ');
}
