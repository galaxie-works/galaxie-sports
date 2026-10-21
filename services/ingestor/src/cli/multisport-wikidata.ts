/**
 * Histórico de medalhas a partir do Wikidata (CC0) — issue #75.
 *   pnpm --filter @galaxie/ingestor multisport:wikidata                       # todas as edições encerradas
 *   pnpm --filter @galaxie/ingestor multisport:wikidata --games og-summer-2016,pan-2023
 *   pnpm --filter @galaxie/ingestor multisport:wikidata --type PAN --from 1995 --to 2023
 *   pnpm --filter @galaxie/ingestor multisport:wikidata --refresh            # ignora o cache do raw
 *   pnpm --filter @galaxie/ingestor multisport:wikidata --max-age-days 30   # cache vale 30 dias
 * Requisições sequenciais, com intervalo mínimo e novas tentativas; respostas brutas ficam em raw.api_response
 * (provider = wikidata), então rodar de novo não volta ao endpoint.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { closeDb, createDb, games, LATAM_NOCS } from '@galaxie/db';
import { listArg, parseArgs, pct } from '../multisport/cli-args.js';
import { coverageByEdition, coverageByNoc, seedWikipediaReferences } from '../multisport/qa/report.js';
import { WikidataMedalLoader } from '../multisport/wikidata/loader.js';
import { PgSparqlCache, SparqlClient } from '../multisport/wikidata/sparql-client.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const args = parseArgs(process.argv.slice(2));
const db = createDb(url, { max: 3 });

try {
  const slugs = listArg(args, 'games');
  const type = args.get('type');
  const season = args.get('season');
  const from = Number(args.get('from') ?? 0) || 0;
  const to = Number(args.get('to') ?? 9999) || 9999;
  const maxAgeDays = args.get('max-age-days');

  const selected = await db
    .select()
    .from(games)
    .where(
      and(
        isNotNull(games.wikidataQid),
        slugs ? inArray(games.slug, slugs) : eq(games.status, 'completed'),
        typeof type === 'string' ? eq(games.type, type as 'OG' | 'PAN') : sql`true`,
        typeof season === 'string' ? eq(games.season, season as 'summer' | 'winter') : sql`true`,
        gte(games.year, from),
        lte(games.year, to),
      ),
    )
    .orderBy(asc(games.year), asc(games.type), asc(games.season));
  if (!selected.length) throw new Error('Nenhuma edição selecionada — rode antes `multisport:seed`.');

  const client = new SparqlClient({
    cache: new PgSparqlCache(db),
    refresh: args.has('refresh'),
    cacheMaxAgeMs: typeof maxAgeDays === 'string' ? Number(maxAgeDays) * 86_400_000 : null,
    log: (m) => console.log(m),
  });
  const loader = new WikidataMedalLoader(db, client, { log: (m) => console.log(m) });

  await seedWikipediaReferences(db);
  const summary = [];
  for (const g of selected) {
    const t0 = Date.now();
    const r = await loader.loadGames(g);
    summary.push({
      edição: r.slug,
      declarações: r.statements,
      provas: r.medalEvents,
      excluídas: r.excludedEvents,
      ouro: r.medals.G,
      prata: r.medals.S,
      bronze: r.medals.B,
      revogadas: r.medals.revoked,
      'sem CON': r.unresolvedNoc.length,
      conflitos: r.conflicts.length,
      'ref. delegações': r.delegationReferences,
      cobertura: pct(r.coverage),
      qualidade: r.quality,
      's ': Math.round((Date.now() - t0) / 1000),
    });
    console.log(
      `${r.slug}: ${r.medals.active} medalhas em ${r.medalEvents} provas` +
        (r.unmappedSports.length ? ` · esportes sem disciplina: ${r.unmappedSports.join(', ')}` : ''),
    );
  }
  console.table(summary);
  console.log(`Chamadas ao WDQS: ${client.networkCalls} · respostas do cache: ${client.cacheHits}`);

  const loaded = selected.map((g) => g.slug);
  console.log('\nCobertura por edição (provas com medalha carregadas e alertas de QA):');
  console.table(
    (await coverageByEdition(db, loaded)).map((e) => ({
      edição: e.games,
      provas: e.events,
      ...e.medals,
      CONs: e.nocs,
      esperado: e.expected?.total ?? '—',
      cobertura: pct(e.coverage),
      alertas: Object.entries(e.issues)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    })),
  );
  console.log('\nAmérica Latina × referências (Wikipedia; senão agregado das delegações no Wikidata):');
  console.table(
    (await coverageByNoc(db, [...LATAM_NOCS, 'USA'], loaded))
      .filter((r) => r.wikipedia || ['BRA', 'ARG', 'MEX', 'COL', 'CUB'].includes(r.noc))
      .map((r) => ({
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
} finally {
  await closeDb(db);
}
