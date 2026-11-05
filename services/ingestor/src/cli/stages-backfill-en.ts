/**
 * Nome em inglês das fases já gravadas (`core.stage.name->>'en'`): recalcula pelo rótulo do fornecedor com
 * `parseRound` onde o `en` está vazio ou ainda é o rótulo cru. Sem `--aplicar`, só mostra a prévia.
 * Idempotente; zero chamadas ao fornecedor. Rode uma vez depois do deploy do locale `en`.
 *   pnpm --filter @galaxie/ingestor stages:backfill-en                       # prévia (futebol)
 *   pnpm --filter @galaxie/ingestor stages:backfill-en --aplicar             # grava
 *   pnpm --filter @galaxie/ingestor stages:backfill-en --esporte basketball  # outro esporte que usa parseRound
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { backfillStageEnglishNames } from '../stages/backfill-en.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      aplicar: { type: 'boolean', default: false },
      esporte: { type: 'string', default: 'football' },
    },
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(url);
  try {
    const r = await backfillStageEnglishNames(db, { apply: values.aplicar, sport: values.esporte });
    if (!r.changed)
      console.log(`Nenhuma fase de ${values.esporte} sem nome em inglês (${r.examined} examinada(s)).`);
    else
      report(
        `${values.aplicar ? 'Gravadas' : 'Prévia (use --aplicar para gravar)'}: ${r.changed} fase(s) de ${values.esporte} com nome em inglês (${r.examined} examinada(s); amostra abaixo)`,
        r.sample,
      );
  } finally {
    await closeDb(db);
  }
});
