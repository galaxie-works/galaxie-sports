/**
 * Agente Resumo pós-jogo: `pnpm --filter @galaxie/ai-agents recap:run [--plan] [--evento <id>]`.
 * Rode a cada 2–5 min (ou no gatilho de FT) para cumprir "resumo ≤ 10 min após o FT" no tier 1.
 * Flags: --horas <n> (janela para trás, padrão 36) · --tier <n> · --locales · --forcar · --sem-llm · --limite <n>.
 */
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { runRecapAgent } from '../recap/run.js';
import { dbFromEnv, intFlag, llmOrNull, localesFlag, printAgentReport } from './common.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    evento: { type: 'string' },
    horas: { type: 'string' },
    tier: { type: 'string' },
    locales: { type: 'string' },
    forcar: { type: 'boolean', default: false },
    'sem-llm': { type: 'boolean', default: false },
    limite: { type: 'string' },
  },
  strict: true,
});

const db = dbFromEnv();
try {
  const llm = values.plan ? null : await llmOrNull(values['sem-llm'], db, 'context');
  const lookback = intFlag(values.horas, 'horas');
  const tier = intFlag(values.tier, 'tier');
  const limit = intFlag(values.limite, 'limite');
  const locales = localesFlag(values.locales);
  const report = await runRecapAgent(db, {
    llm,
    plan: values.plan,
    force: values.forcar,
    ...(values.evento ? { eventId: values.evento } : {}),
    ...(lookback !== undefined ? { lookbackHours: lookback } : {}),
    ...(tier !== undefined ? { maxTier: tier } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(locales ? { locales } : {}),
  });
  printAgentReport(report, values.plan);
} finally {
  await closeDb(db);
}
