/**
 * Estado literal da IA para a CLI `ai:status`: global e por agente (os que têm estado ou teto próprio),
 * com o gasto do dia UTC quando o ledger está disponível.
 */
import type { TokenBudget } from './budget.js';

const usd = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Agentes com estado (AI_AGENT_STATUS) ou teto em US$ próprio (AI_AGENT_USD_BUDGETS), em ordem alfabética. */
export function configuredAgents(budget: TokenBudget): string[] {
  const keys = new Set([
    ...Object.keys(budget.policy.agentStatus ?? {}),
    ...Object.keys(budget.policy.agentUsdLimits ?? {}),
  ]);
  return [...keys].sort();
}

/**
 * Linhas do relatório: "IA: ligado · limitado · US$ 10/dia · 2.000.000 tokens/dia (hoje: US$ 1,23)" e
 * uma por agente ("  wtw: desligado"), mais o teto padrão dos agentes fora da lista. Com AI_STATUS=off (chave geral), todo agente aparece desligado
 * por ela, inclusive o listado com `agente=on`. Sem ledger (`withSpend` falso), sem o gasto do dia.
 */
export async function aiStatusLines(budget: TokenBudget, withSpend = true): Promise<string[]> {
  const spend = async (agent?: string) =>
    withSpend ? ` (hoje: US$ ${usd((await budget.usdStatus(agent)).usedUsd)})` : '';
  const globalOff = budget.statusOf() === 'off';
  const lines = [`IA: ${budget.describe()}${await spend()}`];
  for (const agent of configuredAgents(budget)) {
    const state = globalOff
      ? `desligado pela chave geral (AI_STATUS=off)${budget.policy.agentStatus?.[agent] === 'on' ? '; agente=on sem efeito' : ''}`
      : budget.describe(agent);
    const isDefault =
      !globalOff && budget.agentUsdLimitOf(agent).isDefault && budget.statusOf(agent) === 'on';
    lines.push(`  ${agent}: ${state}${isDefault ? ' (teto padrão)' : ''}${await spend(agent)}`);
  }
  // agente fora da lista (agente novo): o teto padrão, nunca sem teto
  const fallback = budget.policy.agentDefaultUsdLimit ?? null;
  if (!globalOff)
    lines.push(
      `  outros agentes: ${fallback === null ? 'só o teto global' : `teto padrão de US$ ${usd(fallback)}/dia`} (AI_AGENT_DEFAULT_USD_BUDGET)`,
    );
  return lines;
}
