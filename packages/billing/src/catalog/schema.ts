import * as z from 'zod';
import { API_MODULES, API_PLANS } from '@galaxie/db/schema';

/**
 * Formato dos arquivos de `config/catalog/` (plataforma comercial F1). Só estrutura: preço, moeda e ids do Stripe
 * ficam no banco (`billing.price`), porque esta repo é pública.
 */

const moduleId = z.enum(API_MODULES);
const planId = z.enum(API_PLANS);
/** Chave de faixa ou feature: `<modulo>.<nome>` em snake_case. */
const dottedKey = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'chave no formato modulo.nome');

/** O que o tenant precisa ter para contratar um módulo ou ligar uma feature. */
export const Requirement = z
  .object({
    /** Um destes planos de dados. */
    plans: z.array(planId).min(1).optional(),
    /** Todos estes módulos. */
    modules: z.array(moduleId).min(1).optional(),
    /** Pelo menos um destes módulos. */
    anyModule: z.array(moduleId).min(2).optional(),
  })
  .strict();
export type Requirement = z.output<typeof Requirement>;

export const TierDef = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    default: z.number().int().nonnegative(),
    /** Valores fixos aceitos (ex.: pico do chat); sem a lista, qualquer inteiro entre min e max. */
    values: z.array(z.number().int().nonnegative()).min(2).optional(),
  })
  .strict();
export type TierDef = z.output<typeof TierDef>;

export const FeatureDef = z
  .object({
    /** Só estes planos ligam a feature; sem a lista, ela vem com o módulo. */
    plans: z.array(planId).min(1).optional(),
    requires: Requirement.optional(),
  })
  .strict();
export type FeatureDef = z.output<typeof FeatureDef>;

export const MODULE_STATUSES = ['available', 'contract', 'soon', 'closed'] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export const ModuleDef = z
  .object({
    kind: z.enum(['data', 'engage']),
    name: z.string().min(1),
    status: z.enum(MODULE_STATUSES),
    trialDays: z.number().int().positive().nullable(),
    requires: Requirement.optional(),
    tiers: z.record(dottedKey, TierDef).default({}),
    features: z.record(
      dottedKey,
      FeatureDef.nullable().transform((f) => f ?? {}),
    ),
  })
  .strict();
export type ModuleDef = z.output<typeof ModuleDef>;

export const ModulesFile = z.object({ modules: z.partialRecord(moduleId, ModuleDef) }).strict();

/** Modelo de plano de dados (`config/catalog/plans.yaml`), copiado para o tenant no onboarding. */
export const PlanTemplate = z.object({
  name: z.string().min(1),
  modules: z.array(moduleId).min(1),
  markets: z.array(z.string().regex(/^[A-Za-z]{2}$/, 'país ISO2')).default([]),
  sports: z.array(z.string().regex(/^[a-z0-9-]+$/, 'slug de esporte')).default([]),
  rateLimitPerMinute: z.number().int().positive(),
  dailyRequestQuota: z.number().int().positive().nullable().default(null),
  defaultKeyEnv: z.enum(['live', 'test']).default('live'),
  /** Plano com prazo (trial): dias a partir do onboarding; null = sem prazo. */
  trialDays: z.number().int().positive().nullable().default(null),
  /** O cliente contrata sozinho, pela loja; false = só por contrato. */
  selfService: z.boolean().default(false),
  /** Faixas que o plano fixa para os módulos dele (`modulo.faixa` → valor). */
  tiers: z.record(dottedKey, z.number().int().nonnegative()).default({}),
});
export type PlanTemplate = z.output<typeof PlanTemplate>;

export const PlansFile = z.object({ plans: z.partialRecord(planId, PlanTemplate) });

export const CAPACITY_TIERS = ['C1', 'C2', 'C3', 'C4'] as const;
export type CapacityTier = (typeof CAPACITY_TIERS)[number];

export const CapacityDef = z
  .object({
    /** null = sem teto no catálogo (sob reserva, por contrato). */
    viewsPerMonth: z.number().int().positive().nullable(),
    peakConcurrent: z.number().int().positive().nullable(),
    chatWriters: z.number().int().positive().nullable(),
    selfService: z.boolean(),
  })
  .strict();
export type CapacityDef = z.output<typeof CapacityDef>;

export const CapacityFile = z
  .object({
    default: z.enum(CAPACITY_TIERS),
    tiers: z.partialRecord(z.enum(CAPACITY_TIERS), CapacityDef),
  })
  .strict();

export const AddonDef = z
  .object({
    module: moduleId,
    billing: z.enum(['recurring', 'metered']),
    unit: z.string().regex(/^[a-z_]+$/),
    tier: dottedKey,
    status: z.enum(['proposed', 'decided']),
  })
  .strict();
export type AddonDef = z.output<typeof AddonDef>;

export const AddonsFile = z.object({ addons: z.record(dottedKey, AddonDef) }).strict();
