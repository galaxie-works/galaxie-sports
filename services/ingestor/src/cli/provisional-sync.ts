/**
 * Grava em core.event os jogos provisórios de config/fixtures/provisional.yaml (anunciados oficialmente e
 * ainda não publicados pelo fornecedor). Idempotente e sem chamadas ao fornecedor: rodar de novo só
 * atualiza o que mudou no YAML, e um jogo que o fornecedor já publicou (junção feita) não é tocado.
 *   pnpm --filter @galaxie/ingestor provisional:sync                  # todos os jogos do YAML
 *   pnpm --filter @galaxie/ingestor provisional:sync --chave football-conmebol-libertadores-2026-final
 *   pnpm --filter @galaxie/ingestor provisional:sync --plan           # só mostra o que faria
 *   pnpm --filter @galaxie/ingestor provisional:sync --arquivo outro.yaml
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { defaultProvisionalPath, loadProvisionalFixtures } from '../provisional/config.js';
import { syncProvisionalFixtures } from '../provisional/sync.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      arquivo: { type: 'string' },
      chave: { type: 'string', multiple: true },
      plan: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const all = await loadProvisionalFixtures(values.arquivo ?? defaultProvisionalPath());
  const keys = values.chave ?? [];
  const unknown = keys.filter((k) => !all.some((f) => f.key === k));
  if (unknown.length) throw new Error(`Chave fora do YAML: ${unknown.join(', ')}`);
  const fixtures = keys.length ? all.filter((f) => keys.includes(f.key)) : all;

  const db = createDb(url);
  try {
    const results = await syncProvisionalFixtures(db, fixtures, { dryRun: values.plan });
    report(
      values.plan ? 'Jogos provisórios (plano — nada foi gravado)' : 'Jogos provisórios sincronizados',
      results.map((r) => ({
        chave: r.key,
        resultado: r.outcome,
        evento: r.eventId ?? '',
        detalhe: r.detail ?? '',
      })),
    );
    if (results.some((r) => r.outcome === 'pending')) process.exitCode = 2;
  } finally {
    await closeDb(db);
  }
});
