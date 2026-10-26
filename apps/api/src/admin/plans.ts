import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import * as z from 'zod';
import { API_MODULES, API_PLANS, type ApiModule, type ApiPlan } from '@galaxie/db';

/** Modelo de plano comercial (config/plans.yaml). */
export const PlanTemplate = z.object({
  name: z.string().min(1),
  modules: z.array(z.enum(API_MODULES)).min(1),
  markets: z.array(z.string().regex(/^[A-Za-z]{2}$/, 'país ISO2')).default([]),
  sports: z.array(z.string().regex(/^[a-z0-9-]+$/, 'slug de esporte')).default([]),
  rateLimitPerMinute: z.number().int().positive(),
  dailyRequestQuota: z.number().int().positive().nullable().default(null),
  defaultKeyEnv: z.enum(['live', 'test']).default('live'),
  /** Plano com prazo (trial): dias a partir do onboarding; null = sem prazo. */
  trialDays: z.number().int().positive().nullable().default(null),
});
export type PlanTemplate = z.output<typeof PlanTemplate>;

export type PlanCatalog = Record<ApiPlan, PlanTemplate>;

const PlansFile = z.object({
  plans: z.partialRecord(z.enum(API_PLANS), PlanTemplate),
});

export class PlansConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlansConfigError';
  }
}

/** `config/plans.yaml` na raiz do monorepo (mesma profundidade em src/ e dist/). */
export function defaultPlansPath(): string {
  return fileURLToPath(new URL('../../../../config/plans.yaml', import.meta.url));
}

/** Valida o conteúdo já interpretado do YAML; exige um modelo para cada plano de API_PLANS. */
export function parsePlans(raw: unknown): PlanCatalog {
  const r = PlansFile.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
    throw new PlansConfigError(`config/plans.yaml inválido — ${issues}`);
  }
  const missing = API_PLANS.filter((p) => !r.data.plans[p]);
  if (missing.length)
    throw new PlansConfigError(`config/plans.yaml sem o(s) plano(s): ${missing.join(', ')}`);
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

/** Lê e valida os modelos de plano (padrão: config/plans.yaml; `PLANS_CONFIG_PATH` sobrescreve). */
export function loadPlans(path = process.env.PLANS_CONFIG_PATH ?? defaultPlansPath()): PlanCatalog {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new PlansConfigError(`Não foi possível ler ${path}: ${(err as Error).message}`);
  }
  return parsePlans(parse(text));
}
