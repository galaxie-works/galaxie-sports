import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';

/**
 * A versão que este processo roda. O que identifica a versão é o hash da entrada da imagem (a tag `in-<hash>`), gravado
 * no build em GALAXIE_IMAGE_HASH, e não o SHA do commit: a mesma imagem é reaproveitada entre commits.
 */
export interface VersionInfo {
  service: string;
  image_hash: string;
  started_at: string;
  node: string;
}

const startedAt = new Date().toISOString();

export function versionInfo(service: string, env: NodeJS.ProcessEnv = process.env): VersionInfo {
  return {
    service,
    image_hash: env.GALAXIE_IMAGE_HASH || 'dev',
    started_at: startedAt,
    node: process.version,
  };
}

/** `build_info{service,image_hash} 1`: a versão no ar por serviço, no Prometheus e no Grafana. */
export function registerBuildInfo(
  registry: Registry,
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  new Gauge({
    name: 'build_info',
    help: 'Versão que o processo roda: o hash da entrada da imagem (tag in-<hash>)',
    labelNames: ['service', 'image_hash'],
    registers: [registry],
  }).set({ service, image_hash: versionInfo(service, env).image_hash }, 1);
}

/** Comparação em tempo constante do `Authorization: Bearer <token>` do /metrics. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface OpsServerOptions {
  service: string;
  port: number;
  env?: NodeJS.ProcessEnv;
  /** Falha do servidor (porta ocupada, por exemplo): só avisa, o serviço segue sem ele. */
  onError?: (err: Error) => void;
  /** Métricas do próprio serviço, além das do processo e do `build_info` (ex.: as do ritmo do ao vivo, lidas do banco). */
  register?: (registry: Registry) => void;
  /**
   * Estado do serviço no corpo do `/health`, além de `status` e `service` (ex.: o worker da fila diz se está ocioso e
   * o que roda). Lido a cada requisição; não muda o código da resposta.
   */
  health?: () => Record<string, unknown>;
}

/**
 * HTTP de operação de quem não tem servidor próprio (worker dos webhooks, scheduler do ingestor e dos agents): GET
 * /health, GET /version e GET /metrics (com `Authorization: Bearer` quando há METRICS_TOKEN). Nunca passa pelo Traefik:
 * esses serviços não têm router. Não segura o processo no ar.
 */
export function startOpsServer(options: OpsServerOptions): Server {
  const env = options.env ?? process.env;
  const { service } = options;
  const token = env.METRICS_TOKEN;
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  registerBuildInfo(registry, service, env);
  options.register?.(registry);

  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const path = req.url?.split('?')[0];
    if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
    if (path === '/health') return json(200, { status: 'ok', service, ...options.health?.() });
    if (path === '/version') return json(200, versionInfo(service, env));
    if (path !== '/metrics') return json(404, { error: 'not found' });
    if (token && !bearerMatches(req.headers.authorization, token)) {
      return json(401, { error: 'unauthorized' });
    }
    return void registry.metrics().then(
      (body) => {
        res.writeHead(200, { 'content-type': registry.contentType });
        res.end(body);
      },
      (err: Error) => {
        options.onError?.(err);
        json(500, { error: 'metrics' });
      },
    );
  });
  server.on('error', (err) => options.onError?.(err));
  server.listen(options.port);
  server.unref();
  return server;
}
