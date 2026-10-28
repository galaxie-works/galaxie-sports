/**
 * Entrypoint do worker de webhooks: `pnpm --filter @galaxie/api webhooks:worker`.
 * Roda separado da API (pode haver várias instâncias: o enfileiramento e a reivindicação de
 * entregas usam `FOR UPDATE SKIP LOCKED`).
 */
import { closeDb, createDb } from '@galaxie/db';
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
const worker = new WebhookWorker(db, {
  ...(maxAttempts ? { maxAttempts } : {}),
  ...(baseDelayMs ? { baseDelayMs } : {}),
  ...(timeoutMs ? { timeoutMs } : {}),
  secrets,
  allowPrivateTargets: process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true',
  logger: { info: log('info'), warn: log('warn') },
});

const shutdown = async () => {
  await worker.stop();
  await closeDb(db);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await worker.start();
log('info')({}, 'webhooks: worker iniciado');
