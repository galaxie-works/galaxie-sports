import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
import type { Database } from '@galaxie/db';
import { createMetrics, loggerOptions, maskIp, quotaPolicyFromEnv } from '@galaxie/observability';
import { redactKey } from './realtime/sse.js';

/**
 * Observabilidade da API (issue #6): logs JSON (pino) e /metrics (Prometheus).
 * Isolado aqui para que o server.ts só precise de duas linhas.
 */

/** Logger do Fastify com os mesmos campos dos demais serviços e IP do cliente mascarado (docs/11 §3). */
export function apiLoggerOptions(
  env: NodeJS.ProcessEnv = process.env,
): Exclude<FastifyServerOptions['logger'], undefined> {
  return {
    ...loggerOptions({ service: 'api' }, env),
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: redactKey(req.url), // `?key=` do EventSource nunca vai para o log
        route: req.routeOptions?.url,
        client_ip: maskIp(req.ip),
      }),
    },
  };
}

export interface ObservabilityOptions {
  db?: Database | undefined;
  env?: NodeJS.ProcessEnv;
}

/**
 * Registra o histograma de latência de todas as rotas e o GET /metrics.
 * Chamar logo após criar a instância (antes das rotas). Se METRICS_TOKEN estiver definido,
 * /metrics exige `Authorization: Bearer <token>` — o proxy público também não deve expor a rota.
 */
export function registerObservability(app: FastifyInstance, options: ObservabilityOptions = {}): void {
  const env = options.env ?? process.env;
  const metrics = createMetrics({
    db: options.db,
    policyFor: quotaPolicyFromEnv(env),
    livePollIntervalSeconds: Number(env.LIVE_POLL_INTERVAL_SECONDS ?? 300),
    onCollectorError: (collector, err) => app.log.error({ err, collector }, 'falha ao coletar métricas'),
  });
  const token = env.METRICS_TOKEN;

  // healthchecks do Docker/proxy a cada poucos segundos não precisam virar log de acesso
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/health') && !route.logLevel) route.logLevel = 'warn';
  });

  app.addHook('onResponse', async (req, reply) => {
    metrics.httpDuration.observe(
      {
        method: req.method,
        route: req.routeOptions?.url ?? 'unmatched',
        status_code: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/metrics', { logLevel: 'warn' }, async (req, reply) => {
    if (token && !bearerMatches(req.headers.authorization, token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body = await metrics.registry.metrics();
    return reply.type(metrics.registry.contentType).send(body);
  });
}

function bearerMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
