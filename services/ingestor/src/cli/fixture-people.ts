/**
 * Preenche quem jogou e quem dirigiu cada partida (`core.football_fixture.player_pids`/`coach_pids`) nas linhas
 * anteriores ao trigger da migration 0061, em lotes. Idempotente; sem linha nula, só confere e sai.
 *   pnpm --filter @galaxie/ingestor fixture-people [--lote 1000] [--pausa-ms 250] [--max-minutos 45] [--plan]
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { fillFixturePeople } from '../ops/fixture-people.js';
import { intOption, runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      lote: { type: 'string' },
      'pausa-ms': { type: 'string' },
      'max-minutos': { type: 'string' },
      plan: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const batchSize = intOption(values.lote, 'lote');
  if (batchSize === 0) throw new Error('--lote precisa ser ≥ 1.');
  const maxMinutes = intOption(values['max-minutos'], 'max-minutos');
  const db = createDb(url, { max: 1 });
  try {
    const result = await fillFixturePeople(db, {
      batchSize,
      pauseMs: intOption(values['pausa-ms'], 'pausa-ms'),
      maxMs: maxMinutes === undefined ? undefined : maxMinutes * 60_000,
      dryRun: values.plan,
    });
    report(values.plan ? 'Pessoas por partida (plano — nada foi gravado)' : 'Pessoas por partida', [
      {
        [values.plan ? 'partidas a preencher' : 'preenchidas']: result.filled,
        lotes: result.batches,
        situação: result.partial ? 'parou no teto de tempo; continua na próxima' : 'completo',
      },
    ]);
  } finally {
    await closeDb(db);
  }
});
