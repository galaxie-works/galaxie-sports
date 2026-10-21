/**
 * Importa respostas brutas salvas em disco para o schema raw (zero chamadas ao fornecedor).
 * Uso: pnpm --filter @galaxie/ingestor raw:import [pasta]   (padrão: ../../data/raw)
 */
import { resolve } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { importRawDirectory } from '../raw-import.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

const dir = resolve(process.argv[2] ?? '../../data/raw');
const db = createDb(url);
const result = await importRawDirectory(db, dir);
report('Importação do raw concluída', {
  dir,
  files: result.files,
  imported: result.imported,
  duplicates: result.duplicates,
  skipped: result.skipped.length,
});
if (result.skipped.length) report('Arquivos ignorados', result.skipped);
await closeDb(db);
