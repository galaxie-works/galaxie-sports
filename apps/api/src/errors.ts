import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorCode, Problem } from '@galaxie/contracts';
import type { ZodError } from 'zod';
import { QUOTA_BLOCK_RATIO } from './usage/quota.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';
const TYPE_BASE = 'https://docs.galaxie.sports/errors/';

/** Erro de domínio serializado como RFC 9457 (docs/05 §6). */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly detail?: string,
    readonly extra: Pick<Problem, 'errors' | 'age_gate' | 'upgrade_url'> & {
      headers?: Record<string, string>;
    } = {},
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
      ...(this.extra.age_gate ? { age_gate: this.extra.age_gate } : {}),
      ...(this.extra.upgrade_url ? { upgrade_url: this.extra.upgrade_url } : {}),
    };
  }
}

/**
 * Onde o cliente contrata o módulo (cartão em Planos e módulos do console, #1137): `UPGRADE_URL_BASE` com o módulo na
 * query. Sem módulo (trial vencido, assinatura suspensa: F3), é o endereço da loja inteira. Sem a variável, a resposta
 * sai sem o link (a tela ainda não existe em todo ambiente).
 */
export function upgradeUrl(module?: string): string | undefined {
  const base = process.env.UPGRADE_URL_BASE?.trim();
  if (!base || (module !== undefined && !/^[a-z_]+$/.test(module))) return undefined;
  try {
    const url = new URL(base);
    if (module !== undefined) url.searchParams.set('module', module);
    return url.toString();
  } catch {
    return undefined;
  }
}

const withUpgrade = () => {
  const upgrade = upgradeUrl();
  return upgrade ? { upgrade_url: upgrade } : {};
};

export const problems = {
  invalidParams: (errors: { path: string; message: string }[], detail?: string) =>
    new ProblemError(400, 'INVALID_PARAMS', 'Invalid parameter', detail, { errors }),
  invalidKey: (detail = 'Send a valid key in the x-galaxie-key header.') =>
    new ProblemError(401, 'INVALID_KEY', 'Missing or invalid API key', detail),
  // estado do tenant (F3, decisão 3): a chave é válida, o tenant é que não tem acesso agora
  tenantPendingReview: () =>
    new ProblemError(
      401,
      'TENANT_PENDING_REVIEW',
      'Sign-up under review',
      'The account is still being provisioned or is waiting for review by the Galaxie team. The keys start working once it is approved.',
    ),
  tenantRejected: () =>
    new ProblemError(
      401,
      'TENANT_REJECTED',
      'Sign-up rejected',
      'The Galaxie team rejected the sign-up. Contact support through the console.',
    ),
  trialExpired: () =>
    new ProblemError(
      401,
      'TRIAL_EXPIRED',
      'Trial expired',
      'The trial period is over. Choose a plan under Plans and modules to reactivate the keys.',
      withUpgrade(),
    ),
  subscriptionSuspended: () =>
    new ProblemError(
      402,
      'SUBSCRIPTION_SUSPENDED',
      'Subscription suspended',
      'The subscription is suspended. Settle billing under Plans and modules to reactivate the keys.',
      withUpgrade(),
    ),
  tenantCancelled: () =>
    new ProblemError(
      401,
      'TENANT_CANCELLED',
      'Account cancelled',
      'The account was cancelled. Data is kept for the retention period; the keys no longer authenticate.',
    ),
  realtimeNotInPlan: (plan: string) =>
    new ProblemError(
      403,
      'MODULE_NOT_IN_PLAN',
      'Plan does not include real time',
      `The ${plan} plan does not include SSE (/v1/stream) or webhooks.`,
    ),
  moduleNotInPlan: (module: string) => {
    const upgrade = upgradeUrl(module);
    return new ProblemError(
      403,
      'MODULE_NOT_IN_PLAN',
      `Plan does not include the ${module} module`,
      undefined,
      upgrade ? { upgrade_url: upgrade } : {},
    );
  },
  sportNotInPlan: (sport: string) =>
    new ProblemError(403, 'MODULE_NOT_IN_PLAN', `Plan does not include the sport ${sport}`),
  marketNotInPlan: (market: string) =>
    new ProblemError(403, 'MARKET_NOT_IN_PLAN', `Plan does not include the market ${market}`),
  originNotAllowed: (origin: string | undefined) =>
    new ProblemError(
      403,
      'ORIGIN_NOT_ALLOWED',
      'Origin not allowed for this publishable key',
      origin
        ? `The origin ${origin} is not among the key's allowed origins.`
        : 'Request without Origin or Referer: the publishable key only works from an authorized page.',
    ),
  publishableKeyNotAllowed: (
    detail = 'The publishable key only allows reads (GET) on the /v1 API. Use the secret key on your backend.',
  ) =>
    new ProblemError(403, 'PUBLISHABLE_KEY_NOT_ALLOWED', 'Route not available for publishable keys', detail),
  fanAgeRestricted: (detail: string, ageGate?: NonNullable<Problem['age_gate']>) =>
    new ProblemError(
      403,
      'FAN_AGE_RESTRICTED',
      "The fan's age group does not allow this action",
      detail,
      ageGate ? { age_gate: ageGate } : {},
    ),
  invalidFanToken: (
    detail = 'Send the fan token in Authorization: Bearer gft_…; ask your server for a new one if it expired.',
  ) => new ProblemError(401, 'INVALID_KEY', 'Missing or invalid fan token', detail),
  notFound: (what = 'Resource') => new ProblemError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (detail: string) => new ProblemError(409, 'CONFLICT', 'Conflict with the current state', detail),
  quotaExceeded: (limit: number, retryAfterSec: number) =>
    new ProblemError(
      429,
      'QUOTA_EXCEEDED',
      'Daily plan quota exhausted',
      `The tenant went over ${Math.round(QUOTA_BLOCK_RATIO * 100)}% of its daily quota of ${limit} requests. The quota resets at midnight (UTC).`,
      { headers: { 'retry-after': String(retryAfterSec) } },
    ),
  rateLimited: (retryAfterSec: number) =>
    new ProblemError(429, 'RATE_LIMITED', 'Tenant rate limit reached', undefined, {
      headers: { 'retry-after': String(retryAfterSec) },
    }),
  degraded: (detail: string) => new ProblemError(503, 'DEGRADED', 'Service temporarily degraded', detail),
};

/** Converte um ZodError em INVALID_PARAMS com a lista de campos. */
export function fromZodError(error: ZodError): ProblemError {
  return problems.invalidParams(
    error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
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
  app.setNotFoundHandler((request, reply) => sendProblem(reply, request, problems.notFound('Route')));

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
        new ProblemError(status, 'INVALID_PARAMS', 'Invalid request', err.message),
      );
    }
    request.log.error({ err }, 'erro não tratado');
    return sendProblem(
      reply,
      request,
      new ProblemError(
        500,
        'INTERNAL_ERROR',
        'Internal error',
        'Try again; if it persists, contact support.',
      ),
    );
  });
}
