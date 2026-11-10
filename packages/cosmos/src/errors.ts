/**
 * Recusas da carteira. Quem chama trata todas do mesmo jeito na moderação (o caso fica para regras e
 * pessoas) e mostra a mensagem certa no assistente (recarregar, função indisponível).
 */
export type CosmosErrorCode =
  /** Saldo livre menor que o pedido. */
  | 'insufficient_credits'
  /** Carteira bloqueada (saldo zerado ou bloqueio da Galaxie). */
  | 'wallet_blocked'
  /** O tenant ainda não ligou a Cosmos (sem carteira). */
  | 'no_wallet'
  /** Função fora do catálogo ou desativada. */
  | 'unknown_function'
  /** Teto de segurança do dia (COSMOS_DAILY_USD_CEILING) alcançado. */
  | 'safety_ceiling'
  /** Reserva inexistente, de outro tenant ou já fechada. */
  | 'reservation_closed'
  /** Créditos de teste já concedidos (uma vez por tenant). */
  | 'trial_already_granted'
  /** Compra ou estorno sem chave de idempotência. */
  | 'missing_idempotency_key'
  /** Valor fora da faixa (créditos negativos, zero, NaN). */
  | 'invalid_amount';

export class CosmosError extends Error {
  readonly code: CosmosErrorCode;

  constructor(code: CosmosErrorCode, message: string) {
    super(message);
    this.name = 'CosmosError';
    this.code = code;
  }
}

export const isCosmosError = (e: unknown, code?: CosmosErrorCode): e is CosmosError =>
  e instanceof CosmosError && (code === undefined || e.code === code);
