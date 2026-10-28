/**
 * Agente Cenário pré-jogo: `pnpm --filter @galaxie/ai-agents context:run [--plan] [--evento <id>]`.
 * Flags: --horas <n> (janela à frente, padrão 72) · --tier <n> (padrão 2) · --locales pt-BR,es-AR
 * · --forcar (regenera mesmo sem mudança) · --sem-llm (só texto determinístico) · --limite <n>.
 */
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { runScenarioAgent } from '../context/run.js';
import {
  dbFromEnv,
  intFlag,
  llmOrNull,
  localesFlag,
  printAgentReport,
  priorityFor,
  budgetDayFor,
} from './common.js';

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
  const horizon = intFlag(values.horas, 'horas');
  const tier = intFlag(values.tier, 'tier');
  const limit = intFlag(values.limite, 'limite');
  const locales = localesFlag(values.locales);
  const report = await runScenarioAgent(db, {
    llm,
    priorityOf: await priorityFor(db),
    budgetDay: await budgetDayFor(db),
    plan: values.plan,
    force: values.forcar,
    ...(values.evento ? { eventId: values.evento } : {}),
    ...(horizon !== undefined ? { horizonHours: horizon } : {}),
    ...(tier !== undefined ? { maxTier: tier } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(locales ? { locales } : {}),
  });
  printAgentReport(report, values.plan);
} finally {
  await closeDb(db);
}
