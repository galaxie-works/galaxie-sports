/**
 * Limpa o resíduo do recálculo antigo: tabela calculada no grupo sem nome numa temporada que tem grupos com
 * nome (as "duas tabelas" da mesma temporada). Sem `--aplicar`, só lista. Idempotente; zero chamadas.
 *   pnpm --filter @galaxie/ingestor standings:limpar-grupo-vazio            # prévia
 *   pnpm --filter @galaxie/ingestor standings:limpar-grupo-vazio --aplicar  # apaga
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { cleanupEmptyGroupResidue } from '../standings/empty-group-cleanup.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { aplicar: { type: 'boolean', default: false } } });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(url);
  try {
    const found = await cleanupEmptyGroupResidue(db, { apply: values.aplicar });
    const rows = found.reduce((n, f) => n + f.rows, 0);
    if (!found.length) console.log('Nenhuma tabela calculada no grupo sem nome ao lado de grupos com nome.');
    else
      report(
        `${values.aplicar ? 'Apagadas' : 'Prévia (use --aplicar para apagar)'}: ${rows} linha(s) em ${found.length} temporada(s)`,
        found.map((f) => ({ competicao: f.competition, temporada: f.year, linhas: f.rows })),
      );
  } finally {
    await closeDb(db);
  }
});
