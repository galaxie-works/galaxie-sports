/**
 * Modelos de plano comercial: moram no catálogo (`config/catalog/plans.yaml`, pacote @galaxie/billing).
 * Reexportados aqui para as rotas de admin e a CLI continuarem importando do mesmo lugar.
 */
export {
  defaultPlansPath,
  loadPlans,
  parsePlans,
  PlanTemplate,
  PlansConfigError,
  type PlanCatalog,
} from '@galaxie/billing';
