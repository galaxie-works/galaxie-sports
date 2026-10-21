/**
 * Recalcula clássico (`derby_id`) e importância dos eventos já gravados a partir da base semântica do
 * banco (issue #39) — zero chamadas ao fornecedor. Eventos novos já saem certos do upsert; rode depois
 * de `pnpm db:seed:semantic` (clássico novo, intensidade revista, time ligado ao core).
 *   pnpm --filter @galaxie/ingestor events:importance                       # todos os eventos
 *   pnpm --filter @galaxie/ingestor events:importance --esporte football --desde 2026-01-01
 *   pnpm --filter @galaxie/ingestor events:importance --plan                # só mostra o que mudaria
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { recomputeEventImportance } from '../normalize/importance.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      esporte: { type: 'string' },
      desde: { type: 'string' },
      evento: { type: 'string', multiple: true },
      plan: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  let since: Date | undefined;
  if (values.desde) {
    since = new Date(values.desde);
    if (Number.isNaN(since.getTime())) throw new Error('--desde precisa ser uma data (AAAA-MM-DD).');
  }
  const db = createDb(url);
  try {
    const result = await recomputeEventImportance(db, {
      ...(values.esporte ? { sport: values.esporte } : {}),
      ...(since ? { since } : {}),
      ...(values.evento?.length ? { eventIds: values.evento } : {}),
      dryRun: values.plan,
    });
    report(values.plan ? 'Importância (plano — nada foi gravado)' : 'Importância recalculada', [
      {
        eventos: result.examined,
        classicos: result.derbies,
        'clássico alterado': result.derbiesChanged,
        'importância alterada': result.importanceChanged,
      },
    ]);
  } finally {
    await closeDb(db);
  }
});
