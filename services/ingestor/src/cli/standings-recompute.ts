/**
 * Recalcula localmente as tabelas da temporada atual (issue #19) a partir dos resultados do core — zero
 * chamadas ao fornecedor. O sync diário e o ao vivo já fazem isso sozinhos; este comando serve para
 * reprocessar à mão.
 *   pnpm --filter @galaxie/ingestor standings:recompute                 # temporadas com resultado novo nos últimos 4 dias
 *   pnpm --filter @galaxie/ingestor standings:recompute --dias 10
 *   pnpm --filter @galaxie/ingestor standings:recompute --temporada <uuid> [--temporada <uuid>]
 *   pnpm --filter @galaxie/ingestor standings:recompute --com-fornecedor --simular   # prévia do #880, nada gravado
 *
 * `--com-fornecedor` escolhe as temporadas que hoje têm linha do fornecedor e resultado encerrado.
 * `--simular` recalcula cada temporada numa transação desfeita no fim e mostra o que mudaria.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { recomputeStandings, seasonsWithNewResults } from '../standings/recompute.js';
import { seasonsWithProviderTable, simulateSeasonStandings } from '../standings/simulate.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      dias: { type: 'string', default: '4' },
      temporada: { type: 'string', multiple: true },
      'com-fornecedor': { type: 'boolean', default: false },
      simular: { type: 'boolean', default: false },
      'sem-publicar': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const days = Number(values.dias);
  if (!Number.isInteger(days) || days < 0) throw new Error('--dias precisa ser um inteiro ≥ 0.');
  const db = createDb(url);
  const rulesDir = resolve('../../config/rules');
  try {
    const seasonIds = values.temporada?.length
      ? values.temporada
      : values['com-fornecedor']
        ? await seasonsWithProviderTable(db)
        : await seasonsWithNewResults(db, new Date(Date.now() - days * 86_400_000));
    if (!seasonIds.length) {
      console.log('Nenhuma temporada para recalcular.');
      return;
    }

    if (values.simular) {
      const rows = [];
      for (const id of seasonIds) {
        const { report: r, diff } = await simulateSeasonStandings(db, id, { rulesDir });
        rows.push({
          competicao: r.competition,
          temporada: r.year,
          resultado: r.outcome,
          linhas: r.rows,
          do_fornecedor_trocadas: diff.providerReplaced,
          mudaram_de_posicao: diff.moved,
          maior_salto: diff.maxShift,
          novas: diff.added,
          saem: diff.removed,
          detalhe: r.detail ?? '',
        });
      }
      report('Prévia do recálculo (nada gravado)', rows);
      return;
    }

    const tables = await recomputeStandings(db, {
      seasonIds,
      rulesDir,
      publish: !values['sem-publicar'],
    });
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
