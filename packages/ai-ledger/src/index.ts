/**
 * Ledger diário de IA (`ops.llm_usage`) compartilhado pelos agentes (@galaxie/ai-agents) e pelo ingestor
 * (ordem das fotos): tabela de preços, estado literal (AI_STATUS), tetos do dia em tokens e US$ e a
 * reserva antes de cada chamada. Sem dependência de provedor: quem chama o LLM estima, reserva e grava.
 */
export * from './errors.js';
export * from './pricing.js';
export * from './state.js';
export * from './ledger.js';
