/**
 * Degraus das Conquistas (estudo de 07/11, "Níveis dentro de uma conquista"; o termo da revisão de 08/11 é **Degrau**,
 * e **Nível** ficou para o estágio do torcedor por Pontos). Cinco Degraus para Conquista de contagem, cada um pedindo
 * cerca de 2,5 a 3 vezes o anterior: o primeiro sai no primeiro dia e o Platina é sempre "uma temporada" do esporte.
 * Conquista de momento não tem Degrau (é única).
 */
export const STEP_NAMES = ['bronze', 'silver', 'gold', 'platinum', 'legendary'] as const;
export type StepName = (typeof STEP_NAMES)[number];

/** Degraus de referência: jogos do time acompanhados numa liga de 38 rodadas (o Platina é a temporada). */
export const REFERENCE_STEPS: readonly number[] = Object.freeze([1, 5, 15, 38, 100]);
const REFERENCE_SEASON = 38;

/**
 * Limites dos cinco Degraus calibrados pelo calendário da liga: o Platina é `seasonGames`; os outros mantêm a
 * proporção da referência. Sempre crescentes, e o Bronze é 1.
 */
export function seasonSteps(seasonGames: number): number[] {
  if (!Number.isInteger(seasonGames) || seasonGames < 4) {
    throw new Error(`temporada com ${seasonGames} jogos não comporta cinco Degraus`);
  }
  const steps = REFERENCE_STEPS.map((ref, i) =>
    i === 0 ? 1 : i === 3 ? seasonGames : Math.round((ref * seasonGames) / REFERENCE_SEASON),
  );
  for (let i = 1; i < steps.length; i++) steps[i] = Math.max(steps[i]!, steps[i - 1]! + 1);
  return steps;
}

/** Problemas de uma lista de limites (vazio = válida): de 1 a 5 Degraus, inteiros positivos e crescentes. */
export function validateSteps(thresholds: readonly number[]): string[] {
  const problems: string[] = [];
  if (thresholds.length < 1 || thresholds.length > STEP_NAMES.length) problems.push('de 1 a 5 Degraus');
  thresholds.forEach((t, i) => {
    if (!Number.isInteger(t) || t < 1) problems.push(`o Degrau ${i + 1} precisa ser um inteiro positivo`);
    if (i > 0 && t <= thresholds[i - 1]!) problems.push(`o Degrau ${i + 1} precisa ser maior que o anterior`);
  });
  return problems;
}

/** Quantos Degraus a contagem já alcançou (0 = nenhum). */
export function stepsReached(count: number, thresholds: readonly number[]): number {
  let reached = 0;
  for (const t of thresholds) {
    if (count >= t) reached++;
    else break;
  }
  return reached;
}

/** Degraus novos ao passar de `before` para `after` (números de 1 a 5). */
export function newSteps(before: number, after: number, thresholds: readonly number[]): number[] {
  const from = stepsReached(before, thresholds);
  const to = stepsReached(after, thresholds);
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i + 1);
}
