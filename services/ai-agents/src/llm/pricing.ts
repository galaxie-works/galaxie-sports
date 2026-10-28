/**
 * Tabela de preços: vive no ledger compartilhado (@galaxie/ai-ledger), que o ingestor também usa para
 * cobrar a ordem das fotos no mesmo teto do dia.
 */
export {
  GEMINI_GROUNDING_USD_PER_QUERY,
  MODEL_PRICES,
  PRICES_CHECKED_AT,
  WEB_SEARCH_USD_PER_CALL,
  budgetPriceFor,
  estimateCostUsd,
  priceFor,
  providerOfModel,
  searchUsdFor,
  type ModelPrice,
  type TokenUsage,
} from '@galaxie/ai-ledger';
