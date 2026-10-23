import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorCode, Problem } from '@galaxie/contracts';
import type { ZodError } from 'zod';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';
const TYPE_BASE = 'https://docs.galaxie.sports/errors/';

/** Erro de domínio serializado como RFC 9457 (docs/05 §6). */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly detail?: string,
    readonly extra: Pick<Problem, 'errors'> & { headers?: Record<string, string> } = {},
  ) {
    super(title);
    this.name = 'ProblemError';
  }

  toProblem(instance?: string): Problem {
    return {
      type: TYPE_BASE + this.code.toLowerCase().replace(/_/g, '-'),
      title: this.title,
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      ...(this.extra.errors ? { errors: this.extra.errors } : {}),
    };
  }
}

export const problems = {
  invalidParams: (errors: { path: string; message: string }[], detail?: string) =>
    new ProblemError(400, 'INVALID_PARAMS', 'Parâmetro inválido', detail, { errors }),
  invalidKey: (detail = 'Envie uma chave válida no header x-galaxie-key.') =>
    new ProblemError(401, 'INVALID_KEY', 'Chave de API ausente ou inválida', detail),
  moduleNotInPlan: (module: string) =>
    new ProblemError(403, 'MODULE_NOT_IN_PLAN', `Plano não inclui o módulo ${module}`),
  sportNotInPlan: (sport: string) =>
    new ProblemError(403, 'MODULE_NOT_IN_PLAN', `Plano não inclui o esporte ${sport}`),
  marketNotInPlan: (market: string) =>
    new ProblemError(403, 'MARKET_NOT_IN_PLAN', `Plano não inclui o mercado ${market}`),
  originNotAllowed: (origin: string | undefined) =>
    new ProblemError(
      403,
      'ORIGIN_NOT_ALLOWED',
      'Origem não autorizada para esta chave publicável',
      origin
        ? `A origem ${origin} não está entre as origens permitidas da chave.`
        : 'Requisição sem Origin nem Referer: a chave publicável só vale a partir de uma página autorizada.',
    ),
  publishableKeyNotAllowed: () =>
    new ProblemError(
      403,
      'PUBLISHABLE_KEY_NOT_ALLOWED',
      'Rota não disponível para chave publicável',
      'A chave publicável só faz leituras (GET) da API /v1. Use a chave secreta no seu backend.',
    ),
  notFound: (what = 'Recurso') => new ProblemError(404, 'NOT_FOUND', `${what} não encontrado`),
  conflict: (detail: string) => new ProblemError(409, 'CONFLICT', 'Conflito com o estado atual', detail),
  rateLimited: (retryAfterSec: number) =>
    new ProblemError(429, 'RATE_LIMITED', 'Limite de requisições do tenant atingido', undefined, {
      headers: { 'retry-after': String(retryAfterSec) },
    }),
  degraded: (detail: string) =>
    new ProblemError(503, 'DEGRADED', 'Serviço temporariamente degradado', detail),
};

/** Converte um ZodError em INVALID_PARAMS com a lista de campos. */
export function fromZodError(error: ZodError): ProblemError {
  return problems.invalidParams(
    error.issues.map((i) => ({ path: i.path.join('.') || '(raiz)', message: i.message })),
  );
}

export function sendProblem(reply: FastifyReply, request: FastifyRequest, error: ProblemError): FastifyReply {
  for (const [k, v] of Object.entries(error.extra.headers ?? {})) reply.header(k, v);
  return reply
    .code(error.status)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .header('cache-control', 'no-store')
    .send(error.toProblem(request.url.split('?')[0]));
}

/** Todas as respostas de erro saem em application/problem+json. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => sendProblem(reply, request, problems.notFound('Rota')));

  app.setErrorHandler((err: FastifyError | ProblemError, request, reply) => {
    if (err instanceof ProblemError) return sendProblem(reply, request, err);
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 400 && status < 500) {
      if (status === 404) return sendProblem(reply, request, problems.notFound());
      if (status === 400) return sendProblem(reply, request, problems.invalidParams([], err.message));
      // 413 (corpo grande demais), 415 (content-type não suportado) etc. mantêm o status original
      return sendProblem(
        reply,
        request,
        new ProblemError(status, 'INVALID_PARAMS', 'Requisição inválida', err.message),
      );
    }
    request.log.error({ err }, 'erro não tratado');
    return sendProblem(
      reply,
      request,
      new ProblemError(
        500,
        'INTERNAL_ERROR',
        'Erro interno',
        'Tente novamente; se persistir, contate o suporte.',
      ),
    );
  });
}
