/**
 * Logos das plataformas da grade de canais e ofertas (enrich.platform), no padrão da biblioteca de
 * emissoras: a entrada da biblioteca com o mesmo site oficial, senão o logo da Wikimedia Commons ligado
 * pelo Wikidata e conferido pelo site oficial, com o crédito em core.asset_credit.
 *
 *   pnpm --filter @galaxie/ingestor assets:platform-logos --plan        # o que seria ligado (sem gravar)
 *   pnpm --filter @galaxie/ingestor assets:platform-logos [--pais BR,AR] [--plataforma <slug>] [--refazer]
 *
 * Só as plataformas sem logo (`--refazer`: todas). Idempotente. Variáveis: DATABASE_URL, S3_ENDPOINT,
 * S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { WikimediaClient } from '../assets/commons/client.js';
import { InMemoryObjectStore, objectStoreFromEnv } from '../assets/object-store.js';
import { platformsWithoutLogo, runPlatformLogos } from '../assets/platform-logos.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    pais: { type: 'string' },
    plataforma: { type: 'string' },
    refazer: { type: 'boolean', default: false },
  },
  strict: true,
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url, { max: 2 });
try {
  const countries = values.pais
    ?.split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const targets = await platformsWithoutLogo(db, {
    ...(countries?.length ? { countries } : {}),
    ...(values.plataforma ? { slug: values.plataforma } : {}),
    force: values.refazer,
  });
  console.log(`${targets.length} plataforma(s) ${values.refazer ? 'no recorte' : 'sem logo'}.`);
  const client = new WikimediaClient({
    userAgent:
      'GalaxieSports/1.0 (https://github.com/galaxie-works/galaxie-sports; logos da grade de canais)',
  });
  const report = await runPlatformLogos({
    db,
    client,
    objects: values.plan ? new InMemoryObjectStore() : objectStoreFromEnv(),
    targets,
    dryRun: values.plan,
    log: (m) => console.log(`  ${m}`),
  });
  const count = (s: string) => report.outcomes.filter((o) => o.status === s).length;
  console.log(
    `${values.plan ? 'PRÉVIA (nada gravado): ' : ''}${count('library')} da biblioteca de emissoras, ` +
      `${count('commons')} da Commons, ${count('skipped')} sem logo verificável · ` +
      `${client.requests} requisição(ões) à Wikimedia.`,
  );
} finally {
  await closeDb(db);
}
