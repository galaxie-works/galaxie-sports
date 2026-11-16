/**
 * Calculadora de capacidade do cadastro (doc 02 §Cadastro, PL7): pela audiência declarada (visualizações de widget
 * por mês, pessoas ao mesmo tempo no pico, pessoas escrevendo no chat no pico), a menor faixa de
 * `config/catalog/capacity.yaml` que cobre as três. C1 e C2 seguem sozinhas; C3 e C4 (`selfService: false`) viram
 * "fale conosco". No trial a faixa gravada é sempre C1 (PL3): a calculadora só informa a que o uso pediria. Puro e sem
 * banco: o assistente de cadastro (componente de cliente) importa daqui; o catálogo chega como dado, pela página.
 */
import type { CapacityDef, CapacityTier } from '@galaxie/billing';

import { CAPACITY_TIERS } from '@/lib/client/organizations-shared';

export interface DeclaredUsage {
  viewsPerMonth: number;
  peakConcurrent: number;
  chatWriters: number;
}

export interface CapacityRecommendation {
  tier: CapacityTier;
  /** O cliente contrata sozinho (C1 e C2); false = por proposta (C3 e C4). */
  selfService: boolean;
}

/** Teto da faixa cobre o declarado? (null no catálogo = sem teto) */
const covers = (limit: number | null, declared: number) => limit === null || declared <= limit;

/** Número declarado: inteiro não negativo; o que não for número conta como zero. */
export function normalizeUsage(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.replace(/[.,\s]/g, '')) : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function recommendCapacityTier(
  tiers: Record<CapacityTier, CapacityDef>,
  usage: DeclaredUsage,
): CapacityRecommendation {
  for (const tier of CAPACITY_TIERS) {
    const def = tiers[tier];
    if (
      covers(def.viewsPerMonth, usage.viewsPerMonth) &&
      covers(def.peakConcurrent, usage.peakConcurrent) &&
      covers(def.chatWriters, usage.chatWriters)
    )
      return { tier, selfService: def.selfService };
  }
  // sem faixa que cubra (o catálogo sempre tem a C4 sem teto; fica como garantia)
  const last = CAPACITY_TIERS[CAPACITY_TIERS.length - 1]!;
  return { tier: last, selfService: tiers[last].selfService };
}
