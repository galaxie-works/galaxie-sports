/**
 * Importa um pacote de hipismo (SQLite) — docs/13-hipismo.md §3.
 *   pnpm --filter @galaxie/ingestor equestrian:import --sqlite <arquivo.sqlite>
 *   pnpm --filter @galaxie/ingestor equestrian:import --sqlite <arquivo> --source fei-public --license fei_public_pages_unlicensed
 *   pnpm --filter @galaxie/ingestor equestrian:import --from-raw <sha256>   # renormaliza só a partir do raw
 * O arquivo vai inteiro para o raw store (páginas por tabela); a normalização lê do raw e faz upsert por
 * `(source, source_key)`, então reimportar o mesmo pacote — ou uma versão nova — não duplica registros.
 */
import { eq } from 'drizzle-orm';
import { closeDb, createDb, eqImportRun } from '@galaxie/db';
import { parseArgs } from '../multisport/cli-args.js';
import { normalizePackage } from '../equestrian/normalize.js';
import { loadPackageRaw, readPackage, storePackageRaw } from '../equestrian/package-raw.js';
import { persistEquestrian } from '../equestrian/persist.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const args = parseArgs(process.argv.slice(2));
const source = String(args.get('source') ?? 'fei-public');
const license = String(args.get('license') ?? 'fei_public_pages_unlicensed');
const sqlitePath = args.get('sqlite');
const fromRaw = args.get('from-raw');
if (typeof sqlitePath !== 'string' && typeof fromRaw !== 'string')
  throw new Error('Use --sqlite <arquivo.sqlite> ou --from-raw <sha256 do pacote>.');

const db = createDb(url, { max: 3 });
try {
  let sha: string;
  let schemaVersion: number | null = null;
  let packageName: string;
  if (typeof sqlitePath === 'string') {
    const pkg = await readPackage(sqlitePath);
    sha = pkg.sha256;
    schemaVersion = pkg.schemaVersion;
    packageName = sqlitePath.split(/[\\/]/).pop()!;
    const pages = await storePackageRaw(db, source, pkg);
    console.log(
      `raw: ${pages} página(s) nova(s) para o pacote ${sha.slice(0, 12)} (schema ${schemaVersion ?? '?'})`,
    );
  } else {
    sha = fromRaw as string;
    packageName = `raw:${sha.slice(0, 12)}`;
  }

  const tables = await loadPackageRaw(db, source, sha);
  if (!Object.keys(tables).length) throw new Error(`Nada no raw para o pacote ${sha}.`);
  const normalized = normalizePackage(tables);

  // tudo numa transação: uma falha no meio não deixa o schema com metade do pacote novo
  const counts = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(eqImportRun)
      .values({ source, license, packageName, packageSha256: sha, schemaVersion })
      .returning({ id: eqImportRun.id });
    const c = await persistEquestrian(tx, normalized, { source, importRunId: run!.id });
    await tx
      .update(eqImportRun)
      .set({ counts: { ...c }, finishedAt: new Date() })
      .where(eq(eqImportRun.id, run!.id));
    return c;
  });
  console.table(counts);
} finally {
  await closeDb(db);
}
