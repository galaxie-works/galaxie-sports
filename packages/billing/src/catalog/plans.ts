import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { API_PLANS, type ApiModule, type ApiPlan } from '@galaxie/db';
import { PlansFile, type PlanTemplate } from './schema.js';
import { defaultCatalogDir } from './paths.js';

export type PlanCatalog = Record<ApiPlan, PlanTemplate>;

export class PlansConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlansConfigError';
  }
}

/** `config/catalog/plans.yaml` (ou `CATALOG_DIR`/plans.yaml). */
export function defaultPlansPath(): string {
  return `${defaultCatalogDir()}/plans.yaml`;
}

/** Valida o conteúdo já interpretado do YAML; exige um modelo para cada plano de API_PLANS. */
export function parsePlans(raw: unknown): PlanCatalog {
  const r = PlansFile.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
    throw new PlansConfigError(`config/catalog/plans.yaml inválido — ${issues}`);
  }
  const missing = API_PLANS.filter((p) => !r.data.plans[p]);
  if (missing.length)
    throw new PlansConfigError(`config/catalog/plans.yaml sem o(s) plano(s): ${missing.join(', ')}`);
  const plans = {} as PlanCatalog;
  for (const p of API_PLANS) {
    const t = r.data.plans[p]!;
    plans[p] = {
      ...t,
      modules: [...new Set(t.modules)] as ApiModule[],
      markets: t.markets.map((m) => m.toUpperCase()),
    };
  }
  return plans;
}

/** Lê e valida os modelos de plano (padrão: config/catalog/plans.yaml; `PLANS_CONFIG_PATH` sobrescreve). */
export function loadPlans(path = process.env.PLANS_CONFIG_PATH ?? defaultPlansPath()): PlanCatalog {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new PlansConfigError(`Não foi possível ler ${path}: ${(err as Error).message}`);
  }
  return parsePlans(parse(text));
}
