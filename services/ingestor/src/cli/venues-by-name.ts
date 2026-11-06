/**
 * Liga ao estádio os jogos de futebol já gravados em que a api-sports mandou só nome e cidade (`venue.id` nulo):
 * o upsert passou a fazer isso nos jogos novos; este CLI acerta o que já estava no banco. Idempotente.
 *   pnpm --filter @galaxie/ingestor venues-by-name [--plan]
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { linkEventVenuesByName } from '../ops/venues-by-name.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { plan: { type: 'boolean', default: false } }, strict: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(url, { max: 1 });
  try {
    const r = await linkEventVenuesByName(db, { dryRun: values.plan });
    report(values.plan ? 'Estádio por nome (plano — nada foi gravado)' : 'Estádio por nome', [
      { 'jogos sem estádio com nome': r.candidates, [values.plan ? 'a ligar' : 'ligados']: r.linked },
    ]);
  } finally {
    await closeDb(db);
  }
});
