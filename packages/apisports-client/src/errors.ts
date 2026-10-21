import type { Outcome, Priority } from './types.js';

/** A chamada chegou ao fornecedor e voltou com erro (já registrada no ledger e no raw). */
export class ApiSportsError extends Error {
  constructor(
    readonly outcome: Outcome,
    readonly details: unknown,
    readonly requestHash: string,
  ) {
    super(`api-sports respondeu ${outcome}: ${JSON.stringify(details)}`);
    this.name = 'ApiSportsError';
  }
}

/** Bloqueada antes de sair: violaria uma restrição conhecida do plano (não gasta cota). */
export class PlanViolationError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlanViolationError';
  }
}

/** Negada pelo Quota Governor: o orçamento da prioridade (e o que ela pode emprestar) acabou. */
export class QuotaExceededError extends Error {
  constructor(
    readonly api: string,
    readonly priority: Priority,
    readonly reason: string,
  ) {
    super(`Cota negada para ${api}/${priority}: ${reason}`);
    this.name = 'QuotaExceededError';
  }
}
