/**
 * Retenção do change feed: apaga mudanças com mais de N dias (padrão 7, ou CHANGE_FEED_RETENTION_DAYS),
 * mantendo a mais recente de cada entidade e o que os webhooks ainda não leram.
 *   pnpm --filter @galaxie/ingestor change-feed:prune [--dias 7] [--plan]
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { DEFAULT_CHANGE_FEED_RETENTION_DAYS, pruneChangeFeed } from '../ops/change-feed-retention.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      dias: { type: 'string' },
      plan: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const days = Number(
    values.dias ?? process.env.CHANGE_FEED_RETENTION_DAYS ?? DEFAULT_CHANGE_FEED_RETENTION_DAYS,
  );
  if (!Number.isInteger(days) || days < 1) throw new Error('--dias precisa ser um inteiro ≥ 1.');
  const db = createDb(url, { max: 2 });
  try {
    const result = await pruneChangeFeed(db, { retentionDays: days, dryRun: values.plan });
    report(values.plan ? 'Change feed (plano — nada foi apagado)' : 'Change feed: retenção aplicada', [
      {
        'anterior a': result.cutoff.toISOString(),
        [values.plan ? 'seriam apagadas' : 'apagadas']: result.deleted,
        'piso dos consumidores (webhooks, cache da demo)': result.webhookCursor ?? '—',
      },
    ]);
  } finally {
    await closeDb(db);
  }
});
