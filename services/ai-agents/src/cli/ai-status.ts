/**
 * Estado da IA, em texto literal: global, por agente e por faixa de prioridade, com o gasto do dia de
 * orçamento (ledger ops.llm_usage; vira em AI_BUDGET_DAY_START, padrão 06:00 em Brasília).
 *   pnpm --filter @galaxie/ai-agents ai:status
 * Exemplo: "IA: ligado · limitado · US$ 10/dia · 2.000.000 tokens/dia (hoje: US$ 1,23)" e "  wtw: desligado".
 * Com DATABASE_URL, aplica as sobrescritas do painel (o mesmo env que os jobs do scheduler recebem); sem,
 * mostra só a configuração do env. Configuração inválida (ex.: AI_DAILY_USD_BUDGET=0) sai com a mensagem
 * do erro e código 1. Não chama nenhum provedor.
 */
import { closeDb, createDb } from '@galaxie/db';
import { MemoryTokenBudgetStore, PgTokenBudgetStore, TokenBudget } from '../llm/budget.js';
import { llmSettingsFromEnv } from '../llm/config.js';
import { bandsFromEnv, budgetPolicyFromSettings } from '../llm/factory.js';
import { aiStatusLines } from '../llm/status.js';
import { runtimeEnv } from './common.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const db = url ? createDb(url, { max: 1 }) : null;
  try {
    const env = db ? await runtimeEnv(db) : process.env;
    const settings = llmSettingsFromEnv(env);
    // as faixas como o scheduler as vê (a faixa `manual` vale para qualquer comando rodado à mão)
    const budget = new TokenBudget(
      db ? new PgTokenBudgetStore(db) : new MemoryTokenBudgetStore(),
      budgetPolicyFromSettings(settings, undefined, { ...bandsFromEnv(env, settings), manual: false }),
    );
    for (const line of await aiStatusLines(budget, db !== null)) console.log(line);
    if (!db) console.log('(sem DATABASE_URL: sem as sobrescritas do painel e sem o gasto do dia)');
  } finally {
    if (db) await closeDb(db);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
