/**
 * Escala de Pontos da Gamificação (arquitetura 03, "Escala de Pontos", decidida em 08/11/2026). É da Galaxie e igual
 * para todos os clientes: o cliente não configura. Os números ficam em Ajustes, versionados (`game.rule_version`), e
 * esta é a versão padrão. Mudança vale só para o que vem depois: o que já foi ganho guarda a versão da época.
 */

/** Ações de participação: valem pouco, somam no teto diário. */
export const PARTICIPATION_ACTIONS = ['poll', 'trivia', 'watched', 'consumption'] as const;
export type ParticipationAction = (typeof PARTICIPATION_ACTIONS)[number];

export interface PointsScale {
  /** Voto em enquete. */
  poll: number;
  /** Trivia certa. */
  trivia: number;
  /** Jogo assistido (presença verificada). */
  watched: number;
  /** Conquista de consumo (ex.: conferir o resumo): conta uma vez por partida e vale menos que um acerto. */
  consumption: number;
  /** Palpite de vencedor certo. */
  winner: number;
  /** Palpite de quantidade certo: de `quantityMin` (bem abaixo do total) a `quantityMax` (o total exato). */
  quantityMin: number;
  quantityMax: number;
  /** Placar exato (Acerto em cheio). */
  exactScore: number;
  /** Teto diário da soma das ações de participação. */
  dailyParticipationCap: number;
}

export const DEFAULT_POINTS_SCALE: Readonly<PointsScale> = Object.freeze({
  poll: 5,
  trivia: 10,
  watched: 20,
  consumption: 5,
  winner: 40,
  quantityMin: 40,
  quantityMax: 120,
  exactScore: 120,
  dailyParticipationCap: 40,
});

/**
 * Problemas da escala, em português (vazio = válida). A regra que não pode quebrar: o Palpite de vencedor vale
 * sempre pelo menos 3 vezes a média das ações de participação (voto, trivia e jogo assistido). Acertar precisa valer
 * mais que clicar.
 */
export function validatePointsScale(scale: PointsScale): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(scale)) {
    if (!Number.isInteger(value) || value < 0)
      problems.push(`${key} precisa ser um inteiro maior ou igual a zero`);
  }
  const participationAvg = (scale.poll + scale.trivia + scale.watched) / 3;
  if (scale.winner < 3 * participationAvg) {
    problems.push(
      `o Palpite de vencedor (${scale.winner}) precisa valer pelo menos 3 vezes a média da participação (${participationAvg.toFixed(1)})`,
    );
  }
  if (scale.consumption > scale.winner)
    problems.push('a Conquista de consumo não pode valer mais que um acerto');
  if (scale.quantityMin > scale.quantityMax) problems.push('quantityMin não pode passar de quantityMax');
  if (scale.exactScore < scale.winner) problems.push('o placar exato não pode valer menos que o vencedor');
  if (scale.dailyParticipationCap < Math.max(scale.poll, scale.trivia, scale.watched, scale.consumption)) {
    problems.push('o teto diário precisa caber ao menos uma ação de participação');
  }
  return problems;
}

/** Pontos de uma ação de participação. */
export function participationPoints(
  action: ParticipationAction,
  scale: PointsScale = DEFAULT_POINTS_SCALE,
): number {
  return scale[action];
}

/**
 * Quanto de uma ação de participação ainda entra hoje, dado o que o Perfil já somou no dia. Passou do teto, a ação
 * conta para Conquista (o progresso sobe) mas não dá Pontos.
 */
export function cappedParticipationPoints(
  action: ParticipationAction,
  earnedToday: number,
  scale: PointsScale = DEFAULT_POINTS_SCALE,
): number {
  const room = Math.max(0, scale.dailyParticipationCap - Math.max(0, earnedToday));
  return Math.min(scale[action], room);
}
