/**
 * Estado da IA, em texto literal: global e por agente, com o gasto do dia UTC (ledger ops.llm_usage).
 *   pnpm --filter @galaxie/ai-agents ai:status
 * Exemplo: "IA: ligado · limitado · US$ 10/dia · 2.000.000 tokens/dia (hoje: US$ 1,23)" e "  wtw: desligado".
 * Sem DATABASE_URL mostra só a configuração. Configuração inválida (ex.: AI_DAILY_USD_BUDGET=0) sai com a
 * mensagem do erro e código 1. Não chama nenhum provedor.
 */
import { closeDb, createDb } from '@galaxie/db';
import { MemoryTokenBudgetStore, PgTokenBudgetStore, TokenBudget } from '../llm/budget.js';
import { llmSettingsFromEnv } from '../llm/config.js';
import { budgetPolicyFromSettings } from '../llm/factory.js';
import { aiStatusLines } from '../llm/status.js';

async function main(): Promise<void> {
  const settings = llmSettingsFromEnv(process.env);
  const url = process.env.DATABASE_URL;
  const db = url ? createDb(url, { max: 1 }) : null;
  try {
    const budget = new TokenBudget(
      db ? new PgTokenBudgetStore(db) : new MemoryTokenBudgetStore(),
      budgetPolicyFromSettings(settings),
    );
    for (const line of await aiStatusLines(budget, db !== null)) console.log(line);
    if (!db) console.log('(sem DATABASE_URL: gasto do dia não mostrado)');
  } finally {
    if (db) await closeDb(db);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
