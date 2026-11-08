/**
 * Gravador do core: recebe o lote neutro dos provedores (`NormalizedBatch`) e o grava em `core.*` de forma
 * idempotente. Quem alimenta o core (ingestor) e quem precisa semear um cenário no banco (testes de integração dos
 * agentes e da API) usam o mesmo caminho.
 */
export * from './upsert-core.js';
export * from './upsert-markets.js';
export * from './event-state.js';
export * from './match.js';
export * from './importance-facts.js';
export * from './placeholder-logos.js';
export * from './name-case.js';
export * from './slug.js';
export * from './sql-helpers.js';
export { uuidv7 } from './uuid.js';
export * from './retracted-goals.js';
