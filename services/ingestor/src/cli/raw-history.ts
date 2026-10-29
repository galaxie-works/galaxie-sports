/**
 * Arruma, uma vez, o histórico do raw gravado antes da dedupe (lote 6): classifica como `live` o que veio dos jobs
 * do ao vivo e junta as respostas repetidas em sequência numa linha só (o "visto em" e a contagem ficam na
 * primeira). Idempotente e em lotes curtos; sem `--aplicar`, só mostra o plano. Não roda no deploy: na produção,
 * só com o OK do dono (docs/runbooks/retencao-de-dados.md).
 *   pnpm --filter @galaxie/ingestor raw:compactar-historico [--aplicar]
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { compactRawHistory } from '../ops/raw-retention.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { aplicar: { type: 'boolean', default: false } }, strict: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(url, { max: 2, applicationName: 'galaxie-raw-history' });
  try {
    const startedAt = Date.now();
    const r = await compactRawHistory(db, { dryRun: !values.aplicar });
    report(
      values.aplicar
        ? 'Histórico do raw compactado'
        : 'Histórico do raw (plano — nada foi alterado; use --aplicar)',
      {
        'linhas do ao vivo classificadas como live': r.classified,
        [values.aplicar ? 'repetidas juntadas' : 'repetidas a juntar']: r.merged,
        'corpos (MB, comprimidos)': Number((r.mergedBodyBytes / 1_048_576).toFixed(1)),
        segundos: Math.round((Date.now() - startedAt) / 1000),
      },
    );
  } finally {
    await closeDb(db);
  }
});
