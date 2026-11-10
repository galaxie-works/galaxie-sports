/**
 * Conversão do custo real em créditos (arquitetura 06, "Reserva"): créditos = maior entre
 * (custo real × multiplicador ÷ valor do crédito) e o mínimo da função. O valor do crédito e o
 * multiplicador são da Galaxie e nunca aparecem para o cliente.
 */

/** Casas decimais dos créditos (`numeric(14,3)` no banco). */
export const CREDIT_DECIMALS = 3;
const SCALE = 10 ** CREDIT_DECIMALS;

/** Arredonda para cima na terceira casa: fração de milésimo nunca sai de graça. */
export function ceilCredits(value: number): number {
  // a folga absorve o erro de ponto flutuante (0.1 + 0.2 não vira 0.301)
  return Math.ceil(value * SCALE - 1e-6) / SCALE;
}

/** Arredonda para a casa mais próxima (somas e diferenças de valores que já vêm do banco). */
export function roundCredits(value: number): number {
  return Math.round(value * SCALE) / SCALE;
}

export interface CreditsInput {
  /** Custo real no provedor, em US$; null = sem custo informado (cobra o mínimo). */
  costUsd: number | null;
  /** Multiplicador da carteira do tenant (padrão 1). */
  multiplier: number;
  /** US$ de custo que valem 1 crédito (COSMOS_CREDIT_USD); null = não configurado (cobra o mínimo). */
  creditUsd: number | null;
  /** Mínimo da função (cosmos.function_def.min_credits). */
  minCredits: number;
}

/** Créditos de uma chamada: o custo convertido, nunca abaixo do mínimo da função. */
export function creditsFor({ costUsd, multiplier, creditUsd, minCredits }: CreditsInput): number {
  const min = ceilCredits(minCredits);
  if (costUsd === null || creditUsd === null || costUsd <= 0) return min;
  return Math.max(ceilCredits((costUsd * multiplier) / creditUsd), min);
}
