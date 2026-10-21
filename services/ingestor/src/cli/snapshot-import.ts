/**
 * Restaura um snapshot do raw no banco local (#20) — zero chamadas, não precisa de APISPORTS_KEY.
 *   pnpm --filter @galaxie/ingestor snapshot:import [arquivo]   (padrão: o mais recente em data/snapshots)
 * Depois, sem chave, `bootstrap:catalog` reprocessa o catálogo a partir do raw (cliente em modo offline).
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { importRawSnapshot } from '../snapshot/raw-snapshot.js';
import { runCli } from './job-cli.js';

async function latestSnapshot(dir: string): Promise<string> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.ndjson.gz')).sort();
  } catch {
    // pasta ausente: cai no erro abaixo
  }
  const last = files.at(-1);
  if (!last) throw new Error(`Nenhum snapshot em ${dir}; informe o arquivo.`);
  return join(dir, last);
}

await runCli(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const file = arg ? resolve(arg) : await latestSnapshot(resolve('../../data/snapshots'));
  const db = createDb(url);
  try {
    const r = await importRawSnapshot(db, file);
    console.log(
      `Snapshot ${file}: ${r.raw} resposta(s) lidas · ${r.imported} importada(s) · ${r.duplicates} já existentes · ${r.assets} asset(s).`,
    );
  } finally {
    await closeDb(db);
  }
});
