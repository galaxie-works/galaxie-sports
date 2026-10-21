/**
 * Geografia da navegação (config/geo): confederação, código COI e nomes pt-BR/es em core.country.
 * Idempotente e sem chamadas ao fornecedor — pode rodar a qualquer momento (também roda ao fim do
 * bootstrap:catalog).
 *   pnpm --filter @galaxie/ingestor geo:seed
 */
import { closeDb, createDb } from '@galaxie/db';
import { loadGeoConfig } from '@galaxie/geo';
import { seedGeo } from '../geo/seed.js';
import { report } from '../logger.js';

if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(process.env.DATABASE_URL);
try {
  const stats = await seedGeo(db, loadGeoConfig());
  report('Geografia gravada em core.country', stats);
} finally {
  await closeDb(db);
}
