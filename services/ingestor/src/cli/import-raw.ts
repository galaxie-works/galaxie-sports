/**
 * Importa respostas brutas salvas em disco para o schema raw (zero chamadas ao fornecedor).
 * Uso: pnpm --filter @galaxie/ingestor raw:import [pasta]   (padrão: ../../data/raw)
 */
import { resolve } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { importRawDirectory } from '../raw-import.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

const dir = resolve(process.argv[2] ?? '../../data/raw');
const db = createDb(url);
const result = await importRawDirectory(db, dir);
console.log(
  `Arquivos: ${result.files} · importados: ${result.imported} · já existentes: ${result.duplicates} · ignorados: ${result.skipped.length}`,
);
for (const s of result.skipped) console.log(`  ignorado ${s.file}: ${s.reason}`);
await closeDb(db);
