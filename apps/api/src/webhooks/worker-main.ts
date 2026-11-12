/**
 * Entrypoint do worker de webhooks: `pnpm --filter @galaxie/api webhooks:worker`.
 * Roda separado da API (pode haver várias instâncias: o enfileiramento e a reivindicação de
 * entregas usam `FOR UPDATE SKIP LOCKED`).
 */
import { closeDb, createDb } from '@galaxie/db';
import { startOpsServer, versionInfo } from '@galaxie/observability';
import { WebhookSecretBox } from './secret-box.js';
import { WebhookWorker } from './worker.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida (veja .env.example).');
  process.exit(1);
}

const num = (name: string): number | undefined => (process.env[name] ? Number(process.env[name]) : undefined);

const log =
  (level: 'info' | 'warn') =>
  (obj: object, msg?: string): void => {
    const entry = Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, v instanceof Error ? { name: v.name, message: v.message } : v]),
    );
    console[level === 'info' ? 'log' : 'warn'](
      JSON.stringify({ level, time: new Date().toISOString(), msg, ...entry }),
    );
  };

// KEK dos segredos: sem ela só os segredos legados (texto puro) assinam; os cifrados falham (SECURITY.md)
const secrets = WebhookSecretBox.fromEnv();
if (!secrets.configured)
  log('warn')(
    {},
    'webhooks: WEBHOOK_SIGNING_SECRET não definida — só endpoints com segredo legado em texto puro serão entregues',
  );

const db = createDb(url, { max: 5, applicationName: 'galaxie-webhooks' });
const maxAttempts = num('WEBHOOK_MAX_ATTEMPTS');
const baseDelayMs = num('WEBHOOK_RETRY_BASE_MS');
const timeoutMs = num('WEBHOOK_TIMEOUT_MS');
// circuit breaker (#360): horas de falha seguida até desativar o endpoint; 0 desliga
const breakerHours = num('WEBHOOK_BREAKER_HOURS');
// rate limit por endpoint (#360): entregas por minuto; 0 desliga
const endpointRatePerMinute = num('WEBHOOK_ENDPOINT_RATE_PER_MIN');
const worker = new WebhookWorker(db, {
  ...(maxAttempts ? { maxAttempts } : {}),
  ...(breakerHours != null ? { breakerAfterMs: breakerHours * 3_600_000 } : {}),
  ...(endpointRatePerMinute != null ? { endpointRatePerMinute } : {}),
  ...(baseDelayMs ? { baseDelayMs } : {}),
  ...(timeoutMs ? { timeoutMs } : {}),
  secrets,
  allowPrivateTargets: process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true',
  logger: { info: log('info'), warn: log('warn') },
});

// /health, /version e /metrics do worker (sem router no Traefik); na porta da imagem, a do healthcheck dela
const ops = startOpsServer({
  service: 'webhooks',
  port: num('API_PORT') ?? 8080,
  onError: (err) => log('warn')({ err }, 'webhooks: servidor de operação com falha'),
});

const shutdown = async () => {
  ops.close();
  await worker.stop();
  await closeDb(db);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await worker.start();
log('info')(versionInfo('webhooks'), 'webhooks: worker iniciado');
