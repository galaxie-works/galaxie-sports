/**
 * Retenção diária dos dados que só crescem (job `data-retention`, docs/04 §1.1): o raw do ao vivo com mais de
 * RAW_LIVE_RETENTION_DAYS (30) dias e as tabelas de operação pelas regras de ops-retention.ts (o ledger de IA é
 * agregado por dia antes). Lotes curtos, idempotente.
 *   pnpm --filter @galaxie/ingestor data:retention [--plan] [--dias-raw 30]
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { pruneOpsTables } from '../ops/ops-retention.js';
import { pruneRawLive, RAW_LIVE_RETENTION_DAYS } from '../ops/raw-retention.js';
import { runCli } from './job-cli.js';

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      'dias-raw': { type: 'string' },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const rawDays = Number(
    values['dias-raw'] ?? process.env.RAW_LIVE_RETENTION_DAYS ?? RAW_LIVE_RETENTION_DAYS,
  );
  if (!Number.isInteger(rawDays) || rawDays < 1) throw new Error('--dias-raw precisa ser um inteiro ≥ 1.');
  const dryRun = values.plan;
  const db = createDb(url, { max: 2, applicationName: 'galaxie-data-retention' });
  try {
    const raw = await pruneRawLive(db, { retentionDays: rawDays, dryRun });
    const ops = await pruneOpsTables(db, { dryRun });
    const deleted = dryRun ? 'seriam apagadas' : 'apagadas';
    report(dryRun ? 'Retenção (plano — nada foi apagado)' : 'Retenção aplicada', [
      {
        tabela: 'raw.api_response',
        regra: `ao vivo, ${rawDays} dias (fica a última de cada requisição)`,
        'anterior a': raw.cutoff.toISOString(),
        [deleted]: raw.deleted,
        corpos: mb(raw.bodyBytes),
      },
      ...ops.rows.map((r) => ({
        tabela: r.table,
        regra: r.rule,
        'anterior a': r.cutoff.toISOString(),
        [deleted]: r.deleted,
      })),
    ]);
    if (!dryRun && ops.llmDaysAggregated)
      report('Ledger de IA agregado por dia', { dias: ops.llmDaysAggregated, tabela: 'ops.llm_usage_daily' });
  } finally {
    await closeDb(db);
  }
});
