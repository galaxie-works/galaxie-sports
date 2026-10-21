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
  notFound: (what = 'Recurso') => new ProblemError(404, 'NOT_FOUND', `${what} não encontrado`),
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
      return sendProblem(
        reply,
        request,
        status === 404 ? problems.notFound() : problems.invalidParams([], err.message),
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
