/**
 * Agente Curador Semântico: `pnpm --filter @galaxie/ai-agents curator:run --dry-run`.
 * Padrão (e --dry-run): grava proposals.json, report.md, changes.diff e os YAML propostos em
 * --saida (padrão: diretório temporário). --open-pr aplica num branch novo e abre o PR com `gh`.
 * Outras flags: --tier <n> (padrão 1) · --limite <n> (lacunas pesquisadas, padrão 10) · --sem-llm.
 * Agendamento sugerido: semanal (segunda 06:00 UTC) e sob demanda.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '@galaxie/knowledge';
import { openCuratorPr, runCurator, writeDryRun } from '../curator/run.js';
import { dbFromEnv, intFlag, llmOrNull } from './common.js';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'open-pr': { type: 'boolean', default: false },
    saida: { type: 'string' },
    tier: { type: 'string' },
    limite: { type: 'string' },
    'sem-llm': { type: 'boolean', default: false },
  },
  strict: true,
});
if (values['dry-run'] && values['open-pr']) throw new Error('Use --dry-run ou --open-pr, não os dois.');

const db = dbFromEnv();
try {
  const llm = llmOrNull(values['sem-llm'], db);
  const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
  const tier = intFlag(values.tier, 'tier');
  const limit = intFlag(values.limite, 'limite');
  const result = await runCurator(db, kb, {
    llm,
    ...(tier !== undefined ? { maxTier: tier } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  console.log(result.report);
  if (values['open-pr']) {
    const url = await openCuratorPr(result, {
      repoRoot: resolve(DEFAULT_KNOWLEDGE_DIR, '..', '..'),
      knowledgeDir: DEFAULT_KNOWLEDGE_DIR,
    });
    console.log(`PR aberto: ${url}`);
  } else {
    const out = values.saida
      ? resolve(values.saida)
      : await mkdtemp(join(tmpdir(), `galaxie-curator-${new Date().toISOString().slice(0, 10)}-`));
    const files = await writeDryRun(out, result);
    console.log(
      `Dry-run: nada foi alterado em data/knowledge. Saída em ${out} (${files.length} arquivo(s)).`,
    );
  }
} finally {
  await closeDb(db);
}
