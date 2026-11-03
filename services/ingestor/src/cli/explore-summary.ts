/**
 * Resumo da home "Explorar" pré-calculado (#596): recalcula e grava em core.explore_summary quando precisa (sem
 * resumo, resumo com 10 min ou jogo que mudou de status); senão sai sem consultar o resto. Sem chamadas ao fornecedor.
 *   pnpm --filter @galaxie/ingestor explore:summary            # o do scheduler (a cada minuto)
 *   pnpm --filter @galaxie/ingestor explore:summary --forcar   # recalcula agora
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { loadGeoConfig } from '@galaxie/geo';
import { refreshExploreSummary } from '../explore/refresh.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { forcar: { type: 'boolean', default: false } }, strict: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(url, { max: 4 });
  try {
    const result = await refreshExploreSummary(db, loadGeoConfig(), { force: values.forcar });
    console.log(
      result.reason && !result.rows
        ? `Resumo do Explorar recalculado (${result.reason}), mas não gravado: outra rodada gravou uma conta mais nova`
        : result.reason
          ? `Resumo do Explorar recalculado (${result.reason}): ${result.rows} linhas em ${result.ms} ms`
          : `Resumo do Explorar em dia (sem mudança de status desde a última conta): nada a fazer`,
    );
  } finally {
    await closeDb(db);
  }
});
