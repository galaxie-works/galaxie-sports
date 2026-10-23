/**
 * Fotos de pessoas do futebol no Wikidata e no Wikimedia Commons (licença livre), para quem a api-sports não tem foto.
 * Não usa a cota da api-sports.
 *   pnpm --filter @galaxie/ingestor assets:fotos-wikidata --plan     # quantos candidatos e consultas, sem rede
 *   pnpm --filter @galaxie/ingestor assets:fotos-wikidata            # busca, grava licença e autor e espelha
 * Opções: --desde 2026-01-01 (escalados desde) · --tier-max 2 · --limite N · --sem-espelho
 * Variáveis: DATABASE_URL e, para espelhar, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { PgAssetStore } from '../assets/asset-store.js';
import { objectStoreFromEnv } from '../assets/object-store.js';
import {
  fetchCommonsInfo,
  findWikidataPeople,
  matchCandidates,
  mirrorWikimediaPhotos,
  photoCandidates,
  saveWikimediaPhotos,
  WIKIMEDIA_USER_AGENT,
} from '../assets/wikimedia-photos.js';
import { PgSparqlCache, SparqlClient } from '../multisport/wikidata/sparql-client.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    desde: { type: 'string', default: '2026-01-01' },
    'tier-max': { type: 'string', default: '2' },
    limite: { type: 'string' },
    'sem-espelho': { type: 'boolean', default: false },
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
    const client = new SparqlClient({
      userAgent: WIKIMEDIA_USER_AGENT,
      cache: new PgSparqlCache(db, 'assets:fotos-wikidata'),
      log: (m) => console.log(`  ${m}`),
    });
    const people = await findWikidataPeople(client, candidates, {
      onBatch: (done, total) => {
        if (done === total || done % 400 === 0) console.log(`  Wikidata: ${done}/${total} datas`);
      },
    });
    const matches = matchCandidates(candidates, people);
    console.log(`Pessoas do Wikidata com foto nessas datas: ${people.length} · casadas: ${matches.length}`);
    const images = await fetchCommonsInfo(matches.map((m) => m.person.image));
    const saved = await saveWikimediaPhotos(db, matches, images);
    console.log(
      `Fotos ligadas: ${saved.linked} · sem licença livre: ${saved.notFree} · já tinham foto: ${saved.skipped}`,
    );
    if (!values['sem-espelho']) {
      const objects = objectStoreFromEnv();
      const m = await mirrorWikimediaPhotos(db, new PgAssetStore(db), objects);
      objects.close();
      console.log(`Espelhadas: ${m.stored} (${(m.bytes / 1024).toFixed(0)} KiB) · falhas: ${m.failed}`);
    }
  }
} finally {
  await closeDb(db);
}
