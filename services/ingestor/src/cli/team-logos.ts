/**
 * Logos de time sem logo do fornecedor (começou pelos construtores da F1), da Wikimedia Commons (lista curada em
 * config/assets/commons/team-logos.yaml), com a licença conferida e o crédito em core.asset_credit.
 *
 *   pnpm --filter @galaxie/ingestor assets:team-logos --plan     # o que seria ligado (sem gravar)
 *   pnpm --filter @galaxie/ingestor assets:team-logos [--refazer]
 *
 * Time com logo do fornecedor fica como está; `--refazer` baixa de novo o que já veio da Commons.
 * Idempotente. Variáveis: DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { WikimediaClient } from '../assets/commons/client.js';
import { loadTeamLogos, runTeamLogos } from '../assets/team-logos.js';
import { InMemoryObjectStore, objectStoreFromEnv } from '../assets/object-store.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    refazer: { type: 'boolean', default: false },
  },
  strict: true,
});

const root = join(import.meta.dirname, '..', '..', '..', '..');
const MANIFEST = join(root, 'config', 'assets', 'commons', 'team-logos.yaml');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url, { max: 2 });
try {
  const entries = loadTeamLogos(MANIFEST);
  console.log(`${entries.length} time(s) na lista.`);
  const client = new WikimediaClient({
    userAgent: 'GalaxieSports/1.0 (https://github.com/galaxie-works/galaxie-sports; logos de times)',
  });
  const outcomes = await runTeamLogos({
    db,
    client,
    objects: values.plan ? new InMemoryObjectStore() : objectStoreFromEnv(),
    entries,
    dryRun: values.plan,
    refresh: values.refazer,
    log: (m) => console.log(`  ${m}`),
  });
  const linked = outcomes.filter((o) => o.status === 'linked').length;
  console.log(
    `${values.plan ? 'PRÉVIA (nada gravado): ' : ''}${linked} ligado(s), ${outcomes.length - linked} sem mudança · ` +
      `${client.requests} requisição(ões) à Wikimedia.`,
  );
} finally {
  await closeDb(db);
}
