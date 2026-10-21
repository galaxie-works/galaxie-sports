import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { parse } from 'yaml';
import { MediaDenylist, type MediaDenylistEntry } from '@galaxie/apisports-client';
import { closeDb, createDb } from '@galaxie/db';
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
const app = buildServer({
  ...(db ? { db } : {}),
  ...(redis ? { redis } : {}),
  logger: true,
  changeFeed: true,
  ...(process.env.ASSETS_PUBLIC_BASE_URL ? { assetsBaseUrl: process.env.ASSETS_PUBLIC_BASE_URL } : {}),
  ...(process.env.RULES_DIR ? { rulesDir: process.env.RULES_DIR } : {}),
  ...(mediaDenylist ? { mediaDenylist } : {}),
  publicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${port}`,
});

const shutdown = async () => {
  await app.close();
  redis?.disconnect();
  if (db) await closeDb(db);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port });
