/**
 * Importa o F1DB (histórico da Fórmula 1 desde 1950, CC BY 4.0) como segunda fonte da F1.
 *   pnpm --filter @galaxie/ingestor f1db:import --previa          # baixa o release fixado, casa e mostra o que mudaria
 *   pnpm --filter @galaxie/ingestor f1db:import                   # grava
 *   pnpm --filter @galaxie/ingestor f1db:import --dir /dados/f1db # onde guardar o release (padrão: F1DB_DIR ou ~/.galaxie/f1db)
 *   pnpm --filter @galaxie/ingestor f1db:import --from-raw <sha256> [--previa]  # renormaliza só a partir do raw
 *   pnpm --filter @galaxie/ingestor f1db:import --reprocessar      # reaplica o mesmo release (normalizador mudou)
 * O release vai para o raw store (páginas por tabela); a normalização lê do raw e casa com a F1 da api-sports
 * pelo `provider_map`. Reimportar o mesmo release não duplica nada.
 */
import { closeDb, createDb } from '@galaxie/db';
import { F1DB_LICENSE, F1DB_SOURCE_URL } from '@galaxie/providers';
import { importF1db } from '../f1db/import.js';
import { loadF1dbRaw, readF1dbPackage, storeF1dbRaw } from '../f1db/package-raw.js';
import { ensureRelease, F1DB_RELEASE, f1dbDir } from '../f1db/release.js';
import { parseArgs } from '../multisport/cli-args.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const args = parseArgs(process.argv.slice(2));
const dryRun = args.has('previa') || args.has('dry-run');
const fromRaw = args.get('from-raw');
const dirArg = args.get('dir');
// o instante da observação é o do raw (reimportar não muda nada); `--reprocessar` usa o de agora
const reprocess = args.has('reprocessar');

const db = createDb(url, { max: 3 });
try {
  let sha: string;
  let release: string;
  if (typeof fromRaw === 'string') {
    sha = fromRaw;
    release = '';
  } else {
    const dbPath = await ensureRelease(
      f1dbDir(typeof dirArg === 'string' ? dirArg : undefined),
      F1DB_RELEASE,
      (m) => console.log(m),
    );
    const pkg = await readF1dbPackage(dbPath, F1DB_RELEASE.version);
    sha = pkg.sha256;
    release = pkg.release;
    // o raw é a cópia fiel do release: fica mesmo na prévia (idempotente)
    const pages = await storeF1dbRaw(db, pkg);
    console.log(`raw: ${pages} página(s) nova(s) do F1DB ${release} (${sha.slice(0, 12)})`);
  }

  const raw = await loadF1dbRaw(db, sha);
  if (!raw.tables.race?.length) throw new Error(`Nada no raw para o pacote ${sha}.`);
  const result = await importF1db(db, {
    tables: raw.tables,
    release: raw.release ?? release,
    observedAt: reprocess ? new Date() : (raw.fetchedAt ?? new Date()),
    dryRun,
  });

  console.log(
    `\nF1DB ${raw.release ?? release} · ${F1DB_LICENSE} · ${F1DB_SOURCE_URL}${dryRun ? ' · PRÉVIA (nada gravado)' : ''}`,
  );
  console.table({
    'corridas casadas (GP coberto pela api-sports)': result.match.racesMatched,
    'sessões casadas': result.match.sessionsMatched,
    'pilotos casados (classificação / nome)': `${result.match.drivers.byResults} / ${result.match.drivers.byName}`,
    'construtores casados (classificação / nome)': `${result.match.constructors.byResults} / ${result.match.constructors.byName}`,
    'circuitos casados (corrida / nome)': `${result.match.venues.byRaces} / ${result.match.venues.byName}`,
    'vínculos novos no provider_map':
      result.linked.participants + result.linked.venues + result.linked.events,
    'sessões no lote': result.batch.events,
    'GPs (fases) no lote': result.batch.stages,
    'pilotos e construtores no lote': result.batch.participants,
    'circuitos no lote': result.batch.venues,
    'linhas de campeonato': result.batch.standings,
    'temporadas criadas': result.upsert.seasonsCreated,
    'eventos inseridos': result.upsert.events.inserted,
    'eventos atualizados': result.upsert.events.updated,
    'eventos sem mudança (inclui observação repetida)':
      result.upsert.events.unchanged +
      Object.values(result.upsert.events.ignored).reduce((sum, n) => sum + n, 0),
    'eventos de outra fonte (preservados)': result.upsert.events.skippedByPrecedence,
  });
  const { unmatched, conflicts, named } = result.match;
  if (named.length) console.log(`\nCasados pelo nome (confira):\n  ${named.join('\n  ')}`);
  if (unmatched.drivers.length || unmatched.constructors.length || unmatched.venues.length) {
    console.log('\nSem par no F1DB (ficam como estão):');
    if (unmatched.drivers.length) console.log(`  pilotos: ${unmatched.drivers.join(', ')}`);
    if (unmatched.constructors.length) console.log(`  construtores: ${unmatched.constructors.join(', ')}`);
    if (unmatched.venues.length) console.log(`  circuitos: ${unmatched.venues.join(', ')}`);
  }
  if (conflicts.length) console.log(`\nConflitos (par recusado):\n  ${conflicts.join('\n  ')}`);
} finally {
  await closeDb(db);
}
