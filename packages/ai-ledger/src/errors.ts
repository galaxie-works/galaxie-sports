/** Erros da camada de IA (mensagens em português; `kind` orienta retry e métricas). */

export type LlmErrorKind =
  'config' | 'provider' | 'rate_limit' | 'quota' | 'timeout' | 'schema' | 'refusal' | 'incomplete' | 'budget';

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}

/**
 * Orçamento diário esgotado — de tokens (AI_DAILY_TOKEN_BUDGET) ou de US$ (AI_DAILY_USD_BUDGET, global,
 * ou AI_AGENT_USD_BUDGETS, do agente). Não é tentado de novo: o agente segue com o determinístico.
 * `midCall`: a recusa veio no meio de uma chamada (mais uma retentativa ou continuação não cabia), não
 * na reserva — o dia pode ainda ter saldo para chamadas menores.
 */
export class BudgetExceededError extends LlmError {
  constructor(
    readonly agent: string,
    readonly used: number,
    readonly limit: number,
    readonly requested: number,
    readonly unit: 'tokens' | 'usd' = 'tokens',
    readonly midCall = false,
  ) {
    super(
      midCall
        ? unit === 'usd'
          ? `Orçamento diário em US$ (${agent}) não comporta mais uma tentativa desta chamada: gastos US$ ${used.toFixed(4)} de US$ ${limit} (contando a chamada), próxima estimada em US$ ${requested.toFixed(4)}.`
          : `Orçamento diário de tokens (${agent}) não comporta mais uma tentativa desta chamada: usados ${used} de ${limit} (contando a chamada), próxima estimada em ${requested}.`
        : unit === 'usd'
          ? `Orçamento diário em US$ esgotado (${agent}): gastos US$ ${used.toFixed(4)} de US$ ${limit}, pedido estimado US$ ${requested.toFixed(4)}.`
          : `Orçamento diário de tokens esgotado (${agent}): usados ${used} de ${limit}, pedido estimado ${requested}.`,
      'budget',
      false,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * IA desligada (AI_STATUS=off, ou AI_AGENT_STATUS=<agente>=off): nenhuma chamada ao LLM. É um
 * BudgetExceededError para os agentes tratarem como o orçamento esgotado (seguem com o determinístico).
 */
export class AiDisabledError extends BudgetExceededError {
  constructor(agent: string) {
    super(agent, 0, 0, 0, 'usd');
    this.message =
      agent === 'global'
        ? 'IA desligada (AI_STATUS=off): nenhuma chamada ao LLM; todos os agentes seguem só com o determinístico.'
        : `IA desligada para o agente ${agent} (AI_AGENT_STATUS=${agent}=off): nenhuma chamada ao LLM; o agente segue só com o determinístico.`;
    this.name = 'AiDisabledError';
  }
}
