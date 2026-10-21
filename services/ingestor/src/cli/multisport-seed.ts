/**
 * Tabelas de referência do módulo multiesportivo (issue #75) + ligação com os torneios da api-sports (#78).
 *   pnpm --filter @galaxie/ingestor multisport:seed
 * Carrega CONs (206 do COI + especiais/históricos), edições (OG 1896–2032, Inverno 1924–2030, Pan 1951–2027),
 * esportes/disciplinas, ligas dos coletivos e os totais de referência da Wikipedia (QA). Zero chamadas externas.
 */
import { closeDb, createDb } from '@galaxie/db';
import { linkGamesCompetitions } from '../multisport/competition-link.js';
import { seedWikipediaReferences } from '../multisport/qa/report.js';
import { seedMultisport } from '../multisport/seed.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url, { max: 2 });
try {
  const stats = await seedMultisport(db);
  console.log('Referência gravada:', JSON.stringify(stats));
  console.log(`Totais de referência (Wikipedia, QA): ${await seedWikipediaReferences(db)}`);
  const link = await linkGamesCompetitions(db);
  console.log(`Torneios ligados às edições: ${link.linked.length}`);
  if (link.linked.length) console.table(link.linked);
  if (link.pending.length) {
    console.log('Ligas sem catálogo no core (ligadas quando o esporte for carregado):');
    console.table(link.pending);
  }
  if (link.unmatchedSeasons.length) {
    console.log('Temporadas sem edição correspondente:');
    console.table(link.unmatchedSeasons);
  }
} finally {
  await closeDb(db);
}
