/**
 * Cosmos AI (#989): carteira de créditos por tenant, extrato e cobrança por função. Toda função da Cosmos
 * passa por aqui: `reserve` antes de chamar o modelo, `settle` com o valor real ou `release` se falhar.
 * Fica fora do `TokenBudget`/`ops.llm_usage` dos agentes internos (arquitetura 06).
 */
export * from './credits.js';
export * from './errors.js';
export * from './settings.js';
export * from './statement.js';
export * from './wallet.js';
