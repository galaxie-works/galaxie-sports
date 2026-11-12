/**
 * Plataforma comercial (F1): o catálogo de módulos, features, planos, faixas de capacidade e add-ons, lido de
 * `config/catalog/`. Preço não mora aqui (a repo é pública): fica em `billing.price`, no banco.
 */
export * from './catalog/schema.js';
export * from './catalog/plans.js';
export * from './catalog/catalog.js';
export { defaultCatalogDir } from './catalog/paths.js';
export * from './entitlements/resolve.js';
export * from './entitlements/load.js';
