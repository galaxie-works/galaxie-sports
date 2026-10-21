/**
 * Recalcula localmente as tabelas da temporada atual (issue #19) a partir dos resultados do core — zero
 * chamadas ao fornecedor. O sync diário e o ao vivo já fazem isso sozinhos; este comando serve para
 * reprocessar à mão.
 *   pnpm --filter @galaxie/ingestor standings:recompute                 # temporadas com resultado novo nos últimos 4 dias
 *   pnpm --filter @galaxie/ingestor standings:recompute --dias 10
 *   pnpm --filter @galaxie/ingestor standings:recompute --temporada <uuid> [--temporada <uuid>]
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { recomputeStandings } from '../standings/recompute.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      dias: { type: 'string', default: '4' },
      temporada: { type: 'string', multiple: true },
      'sem-publicar': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const days = Number(values.dias);
  if (!Number.isInteger(days) || days < 0) throw new Error('--dias precisa ser um inteiro ≥ 0.');
  const db = createDb(url);
  try {
    const tables = await recomputeStandings(db, {
      ...(values.temporada?.length
        ? { seasonIds: values.temporada }
        : { since: new Date(Date.now() - days * 86_400_000) }),
      rulesDir: resolve('../../config/rules'),
      publish: !values['sem-publicar'],
    });
    if (!tables.length) console.log('Nenhuma temporada com resultado novo.');
    else
      report(
        'Tabelas calculadas localmente',
        tables.map((t) => ({
          competicao: t.competition,
          temporada: t.year,
          resultado: t.outcome,
          jogos: t.results,
          linhas: t.rows,
          detalhe: t.detail ?? '',
        })),
      );
  } finally {
    await closeDb(db);
  }
});
