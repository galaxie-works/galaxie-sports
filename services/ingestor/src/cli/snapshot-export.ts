/**
 * Exporta raw.api_response (+ manifesto de core.asset) para um arquivo NDJSON.gz fora do Git (#20).
 *   pnpm --filter @galaxie/ingestor snapshot:export [arquivo]   (padrão: data/snapshots/raw-<data>.ndjson.gz)
 * Opções: --esporte football · --desde 2026-10-01 · --sem-assets
 * Zero chamadas ao fornecedor.
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { defaultSnapshotName, exportRawSnapshot } from '../snapshot/raw-snapshot.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values, positionals } = parseArgs({
    options: {
      esporte: { type: 'string' },
      desde: { type: 'string' },
      'sem-assets': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const since = values.desde ? new Date(`${values.desde}T00:00:00Z`) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new Error('--desde deve ser uma data AAAA-MM-DD.');
  const file = resolve(positionals[0] ?? `../../data/snapshots/${defaultSnapshotName()}`);
  const db = createDb(url);
  try {
    const result = await exportRawSnapshot(db, file, {
      sport: values.esporte,
      since,
      includeAssets: !values['sem-assets'],
    });
    const size = (await stat(file)).size;
    console.log(
      `Snapshot gravado em ${file}: ${result.raw} resposta(s) do raw · ${result.assets} asset(s) · ${(size / 1_048_576).toFixed(1)} MB`,
    );
  } finally {
    await closeDb(db);
  }
});
