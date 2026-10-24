/**
 * Regras de qualidade dos dados (job `data-quality`, docs/runbooks/qualidade-dos-dados.md): roda as regras, mostra o
 * placar por regra e esporte e grava em `ops.quality_*` (o painel Ajustes → Operação → Qualidade lê dali).
 *   pnpm --filter @galaxie/ingestor quality:run --plan                 # prévia: roda e mostra, não grava
 *   pnpm --filter @galaxie/ingestor quality:run                        # roda e grava
 *   pnpm --filter @galaxie/ingestor quality:run --plan --regras f1.,geo.ambiguous-country-code --esporte formula-1
 *   pnpm --filter @galaxie/ingestor quality:run --plan --json placar.json --md falhas.md
 * Só lê o core; as regras da F1 leem a API (QUALITY_API_URL/QUALITY_API_KEY) e o release fixado do F1DB, e a do
 * Wikidata consulta o wbgetentities (sem cota do fornecedor).
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { logger, report } from '../logger.js';
import { createQualityContext } from '../quality/context.js';
import { pruneQuality, runRules, saveRun, selectRules } from '../quality/engine.js';
import { markdownReport } from '../quality/report.js';
import { QUALITY_RULES } from '../quality/rules/index.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      regras: { type: 'string' },
      esporte: { type: 'string' },
      json: { type: 'string' },
      md: { type: 'string' },
      agendado: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(url, { max: 4 });
  const startedAt = new Date();
  try {
    const rules = selectRules(QUALITY_RULES, {
      only: values.regras
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      sport: values.esporte,
    });
    if (!rules.length) throw new Error('Nenhuma regra com esse filtro (--regras/--esporte).');
    const ctx = createQualityContext(db, {
      now: startedAt,
      log: (msg) => (process.stdout.isTTY ? console.error(msg) : logger.info({ quality: msg }, msg)),
    });
    const rows = await runRules(rules, ctx);
    report(values.plan ? 'Qualidade dos dados (prévia — nada foi gravado)' : 'Qualidade dos dados', [
      ...rows.map((r) => ({
        regra: r.ruleId,
        esporte: r.sport,
        severidade: r.severity,
        status: r.status,
        errados: r.failed,
        conferidos: r.checked,
        ...(r.detail ? { obs: r.detail.slice(0, 80) } : {}),
      })),
    ]);
    if (values.md) writeFileSync(values.md, markdownReport(rows, startedAt));
    if (values.json)
      writeFileSync(
        values.json,
        `${JSON.stringify({ generated_at: startedAt.toISOString(), results: rows }, null, 1)}\n`,
      );
    if (!values.plan) {
      const runId = await saveRun(db, QUALITY_RULES, rows, {
        trigger: values.agendado ? 'schedule' : 'cli',
        startedAt,
      });
      const pruned = await pruneQuality(db, startedAt);
      report('Execução gravada', { run_id: runId, retencao: pruned });
    }
    if (rows.some((r) => r.status === 'error')) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
});
