/**
 * `/metrics` do processo da demo para o Prometheus da stack, por serviço (`site`, `console`): a versão (`build_info`,
 * como o servidor de operação dos outros serviços) e a memória e o tempo no ar do processo, os números que o
 * `mem_limit` de cada um vigia. Numa porta própria (`DEMO_METRICS_PORT`, 9464 no compose), fora do Next e do Traefik:
 * nenhum router chega nela. Com `METRICS_TOKEN`, exige `Authorization: Bearer` (o mesmo token do Prometheus).
 *
 * Sem dependência: o formato texto do Prometheus com meia dúzia de linhas. `renderMetrics` é puro (testes).
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface ProcessSample {
  service: string;
  imageHash: string;
  startedAtMs: number;
  memory: NodeJS.MemoryUsage;
}

const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export function renderMetrics(sample: ProcessSample): string {
  const gauge = (name: string, help: string, value: number | string, labels = '') =>
    `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${labels} ${value}\n`;
  const { memory } = sample;
  return [
    gauge(
      'build_info',
      'Hash da entrada da imagem que o processo roda (tag in-<hash>)',
      1,
      `{service="${escape(sample.service)}",image_hash="${escape(sample.imageHash)}"}`,
    ),
    gauge(
      'process_start_time_seconds',
      'Hora em que o processo subiu, em segundos Unix',
      sample.startedAtMs / 1000,
    ),
    gauge('process_resident_memory_bytes', 'RSS do processo, em bytes', memory.rss),
    gauge('nodejs_heap_size_total_bytes', 'Heap do V8 reservado, em bytes', memory.heapTotal),
    gauge('nodejs_heap_size_used_bytes', 'Heap do V8 em uso, em bytes', memory.heapUsed),
    gauge(
      'nodejs_external_memory_bytes',
      'Buffers e outros objetos fora do heap do V8, em bytes',
      memory.external,
    ),
  ].join('');
}

/** Comparação em tempo constante do `Authorization: Bearer <token>`. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const startedAtMs = Date.now() - Math.round(process.uptime() * 1000);

export interface MetricsServerOptions {
  service: string;
  port: number;
  env?: Record<string, string | undefined>;
}

/** Sobe o servidor de métricas. Não segura o processo no ar; falha (porta ocupada) só avisa. */
export function startMetricsServer({ service, port, env = process.env }: MetricsServerOptions): Server {
  const token = env.METRICS_TOKEN;
  const server = createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (req.method !== 'GET' || path !== '/metrics') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found\n');
      return;
    }
    if (token && !bearerMatches(req.headers.authorization, token)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }).end('unauthorized\n');
      return;
    }
    const body = renderMetrics({
      service,
      imageHash: env.GALAXIE_IMAGE_HASH || 'dev',
      startedAtMs,
      memory: process.memoryUsage(),
    });
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }).end(body);
  });
  server.on('error', (err) => console.warn('[demo-metrics] servidor de métricas fora do ar', String(err)));
  server.listen(port, '0.0.0.0');
  server.unref();
  return server;
}
