/**
 * Pontuação do Palpite individual (#942, arquitetura 03 "Do Palpite ao Ranking"). Função pura: o servidor usa para o
 * provisório e o definitivo, e o widget usa para a tela pessoal durante o jogo, sem pedir nada ao servidor.
 *
 * - **Placar exato** (`exact_score`): só o placar certo pontua, e é Acerto em cheio.
 * - **Vencedor** (`winner`): mandante, empate ou visitante.
 * - **Quantidade** (`quantity`): "pelo menos N" de um evento da partida (gols, escanteios, cestas de 3...). Acerta se
 *   o jogo chegou a N; quanto mais perto do total, mais Pontos. Só o número exato é Acerto em cheio. N começa no Piso
 *   do Catálogo para o esporte e o assunto.
 *
 * O relógio é sempre o do servidor: `lock_at` sai do horário do jogo, e o Palpite que chega depois é recusado.
 */
import { DEFAULT_POINTS_SCALE, type PointsScale } from './points.js';

export const PREDICTION_KINDS = ['exact_score', 'winner', 'quantity'] as const;
export type PredictionKind = (typeof PREDICTION_KINDS)[number];

export const WINNER_PICKS = ['home', 'draw', 'away'] as const;
export type WinnerPick = (typeof WINNER_PICKS)[number];

export type PredictionValue =
  | { kind: 'exact_score'; home: number; away: number }
  | { kind: 'winner'; pick: WinnerPick }
  | { kind: 'quantity'; subject: string; atLeast: number };

/** O que o jogo mostra agora (provisório) ou no fim (definitivo). */
export interface MatchOutcome {
  home: number;
  away: number;
  /** Totais por assunto do Palpite de quantidade (`goals`, `corners`...). Assunto ausente = sem dado ainda. */
  totals?: Readonly<Record<string, number>>;
}

export interface PredictionScore {
  /** Pontos que o Palpite vale com este resultado. */
  points: number;
  /** O Palpite acertou (pontua). */
  correct: boolean;
  /** Acerto em cheio: placar exato, ou o total exato no Palpite de quantidade. Desempata o Ranking. */
  fullHit: boolean;
}

const MISS: PredictionScore = Object.freeze({ points: 0, correct: false, fullHit: false });

export function winnerOf(outcome: Pick<MatchOutcome, 'home' | 'away'>): WinnerPick {
  if (outcome.home > outcome.away) return 'home';
  if (outcome.home < outcome.away) return 'away';
  return 'draw';
}

/**
 * Pontos do Palpite de quantidade. Abaixo de N, zero. Em N ou acima, de `quantityMin` a `quantityMax` conforme N
 * chega perto do total: N igual ao total vale o máximo (Acerto em cheio), N muito abaixo do total vale o mínimo.
 */
export function quantityPoints(
  atLeast: number,
  total: number,
  scale: PointsScale = DEFAULT_POINTS_SCALE,
): PredictionScore {
  if (!(total >= atLeast) || atLeast <= 0) return MISS;
  if (total === atLeast) return { points: scale.quantityMax, correct: true, fullHit: true };
  const closeness = atLeast / total; // 0 < closeness < 1
  const span = scale.quantityMax - scale.quantityMin;
  // o exato fica sozinho no topo: quem não acertou em cheio leva no máximo um ponto a menos
  const points = Math.min(scale.quantityMax - 1, Math.round(scale.quantityMin + span * closeness));
  return { points: Math.max(scale.quantityMin, points), correct: true, fullHit: false };
}

export function scorePrediction(
  value: PredictionValue,
  outcome: MatchOutcome,
  scale: PointsScale = DEFAULT_POINTS_SCALE,
): PredictionScore {
  switch (value.kind) {
    case 'exact_score':
      return value.home === outcome.home && value.away === outcome.away
        ? { points: scale.exactScore, correct: true, fullHit: true }
        : MISS;
    case 'winner':
      return value.pick === winnerOf(outcome)
        ? { points: scale.winner, correct: true, fullHit: false }
        : MISS;
    case 'quantity': {
      const total = outcome.totals?.[value.subject];
      return total === undefined ? MISS : quantityPoints(value.atLeast, total, scale);
    }
  }
}

/** Assunto do Palpite, para a chave única (um Palpite por Perfil, jogo, tipo e assunto). */
export function predictionSubject(value: PredictionValue): string {
  return value.kind === 'quantity' ? value.subject : '';
}

export type PredictionRejection = 'locked' | 'below_floor' | 'unknown_subject' | 'invalid_value';

/**
 * Confere o Palpite antes de gravar. `now` e `lockAt` vêm do servidor. `floors` = Piso do Catálogo por assunto do
 * Palpite de quantidade, para o esporte do jogo (assunto sem Piso não é aceito).
 */
export function validatePrediction(
  value: PredictionValue,
  ctx: { now: Date; lockAt: Date; floors?: Readonly<Record<string, number>> },
): PredictionRejection | null {
  if (ctx.now.getTime() >= ctx.lockAt.getTime()) return 'locked';
  const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 999;
  switch (value.kind) {
    case 'exact_score':
      return isCount(value.home) && isCount(value.away) ? null : 'invalid_value';
    case 'winner':
      return (WINNER_PICKS as readonly string[]).includes(value.pick) ? null : 'invalid_value';
    case 'quantity': {
      if (!isCount(value.atLeast) || value.atLeast < 1) return 'invalid_value';
      const floor = ctx.floors?.[value.subject];
      if (floor === undefined) return 'unknown_subject';
      return value.atLeast < floor ? 'below_floor' : null;
    }
  }
}
