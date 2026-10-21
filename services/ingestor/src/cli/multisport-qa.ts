/**
 * Relatório de qualidade do histórico multiesportivo (sem chamadas externas).
 *   pnpm --filter @galaxie/ingestor multisport:qa                 # todas as edições carregadas
 *   pnpm --filter @galaxie/ingestor multisport:qa --noc BRA,ARG   # histórico por país (quadro derivado)
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { closeDb, createDb, games, LATAM_NOCS, msEvent } from '@galaxie/db';
import { listArg, parseArgs, pct } from '../multisport/cli-args.js';
import { medalHistoryByNoc } from '../multisport/medal-store.js';
import {
  coverageByEdition,
  coverageByNoc,
  seedWikipediaReferences,
  updateMedalDataQuality,
} from '../multisport/qa/report.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const args = parseArgs(process.argv.slice(2));
const db = createDb(url, { max: 2 });
try {
  const slugs = listArg(args, 'games');
  await seedWikipediaReferences(db);
  const withMedals = await db
    .selectDistinct({ id: games.id, slug: games.slug })
    .from(games)
    .innerJoin(msEvent, eq(msEvent.gamesId, games.id))
    .where(slugs ? inArray(games.slug, slugs) : sql`true`);
  const quality = [];
  for (const g of withMedals) quality.push({ edição: g.slug, ...(await updateMedalDataQuality(db, g.id)) });
  console.log('Selo de qualidade por edição (quadro só deve ser publicado como "complete"/"partial"):');
  console.table(
    quality
      .sort((a, b) => a.edição.localeCompare(b.edição))
      .map((q) => ({ edição: q.edição, cobertura: pct(q.coverage), qualidade: q.quality })),
  );
  console.log('Cobertura por edição:');
  console.table(
    (await coverageByEdition(db, slugs)).map((e) => ({
      edição: e.games,
      provas: e.events,
      ...e.medals,
      revogadas: e.revoked,
      CONs: e.nocs,
      esperado: e.expected?.total ?? '—',
      cobertura: pct(e.coverage),
      alertas: Object.entries(e.issues)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    })),
  );
  const refs = (await coverageByNoc(db, [...LATAM_NOCS, 'USA', 'CHN', 'CAN'], slugs)).filter(
    (r) => r.wikipedia || r.wikidataDelegation,
  );
  console.log('Derivado × referências:');
  console.table(
    refs.map((r) => ({
      edição: r.games,
      CON: r.noc,
      derivado: `${r.derived.gold}/${r.derived.silver}/${r.derived.bronze}`,
      wikipedia: r.wikipedia ? `${r.wikipedia.gold}/${r.wikipedia.silver}/${r.wikipedia.bronze}` : '—',
      'wikidata (delegação)': r.wikidataDelegation
        ? `${r.wikidataDelegation.gold}/${r.wikidataDelegation.silver}/${r.wikidataDelegation.bronze}`
        : '—',
      cobertura: pct(r.coverage),
      confere: r.matches === null ? '—' : r.matches ? 'sim' : 'não',
    })),
  );
  const nocs = listArg(args, 'noc');
  if (nocs) {
    console.log(`Histórico (quadro derivado) de ${nocs.join(', ')}:`);
    console.table(await medalHistoryByNoc(db, nocs));
  }
} finally {
  await closeDb(db);
}
