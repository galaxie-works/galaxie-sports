import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { parse } from 'yaml';
import { MediaDenylist, type MediaDenylistEntry } from '@galaxie/apisports-client';
import { closeDb, createDb } from '@galaxie/db';
import { hardeningFromEnv } from './config.js';
import type { ReviewStatus } from './context.js';
import { buildServer } from './server.js';

/** config/assets/denylist.yaml (ou MEDIA_DENYLIST_PATH): mídia que nunca aparece reescrita no espelho. */
function loadDenylist(): MediaDenylist | undefined {
  const path =
    process.env.MEDIA_DENYLIST_PATH ??
    fileURLToPath(new URL('../../../config/assets/denylist.yaml', import.meta.url));
  if (!existsSync(path)) return undefined;
  const doc = parse(readFileSync(path, 'utf8')) as { denylist?: MediaDenylistEntry[] } | null;
  return new MediaDenylist(doc?.denylist ?? []);
}
const mediaDenylist = loadDenylist();

const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : undefined;
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
  : undefined;
redis?.on('error', () => {}); // reconexão automática; falhas de cache/rate limit são registradas por requisição

const port = Number(process.env.API_PORT ?? 8080);
const hardening = hardeningFromEnv();
const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'reviewed', 'approved'];
const minReviewStatus = process.env.SEMANTIC_MIN_REVIEW_STATUS as ReviewStatus | undefined;
if (minReviewStatus && !REVIEW_STATUSES.includes(minReviewStatus))
  throw new Error(
    `SEMANTIC_MIN_REVIEW_STATUS inválido: ${minReviewStatus} (use draft, reviewed ou approved)`,
  );
const app = buildServer({
  ...hardening,
  ...(db ? { db } : {}),
  ...(redis ? { redis } : {}),
  logger: true,
  changeFeed: true,
  ...(process.env.ASSETS_PUBLIC_BASE_URL ? { assetsBaseUrl: process.env.ASSETS_PUBLIC_BASE_URL } : {}),
  ...(process.env.RULES_DIR ? { rulesDir: process.env.RULES_DIR } : {}),
  ...(mediaDenylist ? { mediaDenylist } : {}),
  publicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${port}`,
  semantic: {
    minReviewStatus: minReviewStatus ?? 'approved',
    ...(process.env.KNOWLEDGE_DIR ? { knowledgeDir: process.env.KNOWLEDGE_DIR } : {}),
  },
});

if (hardening.admin && !hardening.admin.ipAllowlist?.length)
  app.log.warn(
    'ADMIN_IP_ALLOWLIST vazia: /internal/admin aceita qualquer IP (use só atrás de VPN/rede privada).',
  );

const shutdown = async () => {
  await app.close();
  redis?.disconnect();
  if (db) await closeDb(db);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port });
