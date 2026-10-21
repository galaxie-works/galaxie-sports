import { Redis } from 'ioredis';
import { closeDb, createDb } from '@galaxie/db';
import { buildServer } from './server.js';

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
  realtime: {
    maxConnectionsPerTenant: Number(process.env.SSE_MAX_CONNECTIONS_PER_TENANT ?? 100),
  },
  ...(process.env.ASSETS_PUBLIC_BASE_URL ? { assetsBaseUrl: process.env.ASSETS_PUBLIC_BASE_URL } : {}),
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
