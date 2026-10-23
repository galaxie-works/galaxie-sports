/**
 * Fotos de pessoas do futebol no Wikidata e na Wikimedia Commons (licença livre), para quem a api-sports não tem
 * foto. Não usa a cota da api-sports.
 *   pnpm --filter @galaxie/ingestor assets:fotos-wikidata --plan     # quantos candidatos e consultas, sem rede
 *   pnpm --filter @galaxie/ingestor assets:fotos-wikidata            # busca, baixa, grava o crédito e liga
 * Opções: --desde 2026-01-01 (escalados desde) · --tier-max 2 · --limite N
 * Variáveis: DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { WIKIMEDIA_USER_AGENT, WikimediaClient } from '../assets/commons/client.js';
import { objectStoreFromEnv } from '../assets/object-store.js';
import {
  findWikidataPeople,
  importPeoplePhotos,
  matchCandidates,
  photoCandidates,
} from '../assets/wikimedia-photos.js';
import { PgSparqlCache, SparqlClient } from '../multisport/wikidata/sparql-client.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    desde: { type: 'string', default: '2026-01-01' },
    'tier-max': { type: 'string', default: '2' },
    limite: { type: 'string' },
  },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url);
try {
  const candidates = await photoCandidates(db, {
    since: new Date(`${values.desde}T00:00:00Z`),
    maxTier: Number(values['tier-max']),
    limit: values.limite ? Number(values.limite) : undefined,
  });
  const dates = new Set(candidates.map((c) => c.birthDate)).size;
  console.log(
    `Candidatos (sem foto, com data de nascimento): ${candidates.length} · datas distintas: ${dates}`,
  );
  if (values.plan) {
    console.log(
      `Consultas ao Wikidata: ~${Math.ceil(dates / 40)} (40 datas por consulta). Nada foi buscado.`,
    );
  } else {
    const sparql = new SparqlClient({
      userAgent: WIKIMEDIA_USER_AGENT,
      cache: new PgSparqlCache(db, 'assets:fotos-wikidata'),
      log: (m) => console.log(`  ${m}`),
    });
    const people = await findWikidataPeople(sparql, candidates, {
      onBatch: (done, total) => {
        if (done === total || done % 400 === 0) console.log(`  Wikidata: ${done}/${total} datas`);
      },
    });
    const matches = matchCandidates(candidates, people);
    console.log(`Pessoas do Wikidata com foto nessas datas: ${people.length} · casadas: ${matches.length}`);
    const store = objectStoreFromEnv();
    const r = await importPeoplePhotos(
      db,
      store,
      new WikimediaClient({ log: (m) => console.log(`  ${m}`) }),
      matches,
    );
    store.close();
    console.log(
      `Fotos ligadas: ${r.linked} (${(r.bytes / 1024).toFixed(0)} KiB) · sem licença livre: ${r.notFree} · já tinham foto: ${r.skipped}`,
    );
  }
} finally {
  await closeDb(db);
}
