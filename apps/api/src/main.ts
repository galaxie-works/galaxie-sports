import { createDb } from '@galaxie/db';
import { buildServer } from './server.js';

const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : undefined;
const app = buildServer({ ...(db ? { db } : {}), logger: true });

await app.listen({ host: '0.0.0.0', port: Number(process.env.API_PORT ?? 8080) });
