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
  /** Pacote inexistente, inativo ou de outro mercado. */
  | 'unknown_package'
  /** Compra ou estorno sem chave de idempotência. */
  | 'missing_idempotency_key'
  /** A mesma chave de idempotência chegou com outro tipo ou outro valor de lançamento. */
  | 'idempotency_conflict'
  /** Ligar a recarga automática sem o aceite da cobrança recorrente. */
  | 'consent_required'
  /** O cliente desligou a Cosmos (switch da Visão geral). */
  | 'cosmos_disabled'
  /** Ação da equipe sem motivo (pelo menos 5 caracteres). */
  | 'reason_required'
  /** Função nova com o nome de uma que já existe no catálogo. */
  | 'function_exists'
  /** Provedor ou modelo de IA fora da lista, de outro provedor, ou sem preço na tabela. */
  | 'invalid_model'
  /** Provedor que a função ainda não sabe chamar (ex.: o assistente fora dos provedores com chamador). */
  | 'provider_unavailable'
  /** Valor fora da faixa (créditos negativos, zero, NaN). */
  | 'invalid_amount'
  /** Configuração da moderação inválida ou acima do teto da Galaxie (#997). */
  | 'invalid_moderation_config'
  /** Outra pessoa salvou a configuração antes: recarregar e refazer. */
  | 'version_conflict'
  /** A pessoa já tem um pedido de créditos aberto (#996). */
  | 'request_open'
  /** Pedido de créditos inexistente, de outro tenant ou já fechado. */
  | 'request_closed';

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
