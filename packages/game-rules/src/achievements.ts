/**
 * Motor de Conquistas, a parte pura (#908, #910, #912). O motor recebe só entradas permitidas: Palpite fechado
 * (#942) e participação real (jogo assistido pela presença verificada, enquete, trivia, consumo). Compra e clique do
 * Shopping não têm tipo de entrada: `parseAchievementInput` recusa qualquer outro tipo.
 *
 * A Conquista conta só o definitivo: o Palpite entra quando fecha, depois da janela de correção, então o gol anulado
 * pelo VAR nunca chegou a contar e não há concessão provisória para desfazer.
 */
import type { PredictionKind } from './prediction.js';

export type AchievementInput =
  | {
      type: 'prediction';
      kind: PredictionKind;
      correct: boolean;
      fullHit: boolean;
      sport: string;
    }
  | {
      type: 'participation';
      action: 'watched' | 'poll' | 'trivia' | 'consumption';
      sport: string | null;
    };

export type AchievementRule =
  | { input: 'prediction'; correct?: boolean; fullHit?: boolean; kind?: PredictionKind }
  | { input: 'participation'; action: 'watched' | 'poll' | 'trivia' | 'consumption' };

const PARTICIPATION = new Set(['watched', 'poll', 'trivia', 'consumption']);
const KINDS = new Set(['exact_score', 'winner', 'quantity']);

/** Só os tipos permitidos passam; `purchase`, `click` e qualquer outro voltam null. */
export function parseAchievementInput(raw: unknown): AchievementInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'prediction') {
    if (!KINDS.has(r.kind as string) || typeof r.correct !== 'boolean' || typeof r.fullHit !== 'boolean')
      return null;
    if (typeof r.sport !== 'string') return null;
    return {
      type: 'prediction',
      kind: r.kind as PredictionKind,
      correct: r.correct,
      fullHit: r.fullHit,
      sport: r.sport,
    };
  }
  if (r.type === 'participation') {
    if (!PARTICIPATION.has(r.action as string)) return null;
    return {
      type: 'participation',
      action: r.action as 'watched',
      sport: typeof r.sport === 'string' ? r.sport : null,
    };
  }
  return null;
}

/** A regra da Conquista conta esta entrada? */
export function ruleMatches(rule: AchievementRule, input: AchievementInput): boolean {
  if (rule.input === 'prediction') {
    if (input.type !== 'prediction') return false;
    if (rule.kind && rule.kind !== input.kind) return false;
    if (rule.correct !== undefined && rule.correct !== input.correct) return false;
    if (rule.fullHit !== undefined && rule.fullHit !== input.fullHit) return false;
    return true;
  }
  return input.type === 'participation' && input.action === rule.action;
}

export interface CatalogStep {
  step: number;
  threshold: number;
  bonusPoints: number;
  cardKey: string;
}

export interface CatalogEntry {
  id: string;
  sport: string | null;
  category: 'participation' | 'hit' | 'moment' | 'consumption';
  family: string;
  rule: AchievementRule;
  stepped: boolean;
  seasonal: boolean;
  /** false = falta o dado ou o sinal para contar; vai com o motivo. */
  active: boolean;
  inactiveReason?: string;
  name: { pt: string; es: string; en: string };
  description: { pt: string; es: string; en: string };
  steps: CatalogStep[];
}

/** Conquista conta para este esporte? `sport` null no Catálogo = todos. */
export const entryAppliesTo = (entry: Pick<CatalogEntry, 'sport'>, sport: string | null): boolean =>
  entry.sport === null || entry.sport === sport;

const steps = (id: string, thresholds: number[], bonus: number[]): CatalogStep[] =>
  thresholds.map((threshold, i) => ({
    step: i + 1,
    threshold,
    bonusPoints: bonus[i] ?? 0,
    cardKey: `${id}.${i + 1}`,
  }));

/** Bônus dos Degraus das Conquistas de acerto (as de participação não têm: já pontuaram em cada ação). */
const HIT_BONUS = [20, 40, 80, 150, 300];

/**
 * Catálogo inicial da Galaxie (seed da migration 0179). Comum a todos os esportes. As Conquistas de momento de cada
 * esporte (gol nos acréscimos, triple-double, virada no 4º quarto) entram depois, cada uma conferida contra um jogo
 * real da base.
 */
export const INITIAL_CATALOG: readonly CatalogEntry[] = Object.freeze([
  {
    id: 'predictions.correct',
    sport: null,
    category: 'hit',
    family: 'predictions',
    rule: { input: 'prediction', correct: true },
    stepped: true,
    seasonal: true,
    active: true,
    name: { pt: 'Palpiteiro', es: 'Pronosticador', en: 'Predictor' },
    description: {
      pt: 'Acerte Palpites de qualquer tipo.',
      es: 'Acierta pronósticos de cualquier tipo.',
      en: 'Get predictions of any kind right.',
    },
    steps: steps('predictions.correct', [3, 10, 30, 75, 200], HIT_BONUS),
  },
  {
    id: 'predictions.exact_score',
    sport: null,
    category: 'hit',
    family: 'predictions',
    rule: { input: 'prediction', kind: 'exact_score', correct: true },
    stepped: true,
    seasonal: true,
    active: true,
    name: { pt: 'Na mosca', es: 'En el blanco', en: 'Spot on' },
    description: {
      pt: 'Acerte o placar exato.',
      es: 'Acierta el marcador exacto.',
      en: 'Get the exact score right.',
    },
    steps: steps('predictions.exact_score', [1, 3, 10, 25, 60], HIT_BONUS),
  },
  {
    id: 'predictions.winner',
    sport: null,
    category: 'hit',
    family: 'predictions',
    rule: { input: 'prediction', kind: 'winner', correct: true },
    stepped: true,
    seasonal: true,
    active: true,
    name: { pt: 'Faro de vencedor', es: 'Olfato ganador', en: 'Winner instinct' },
    description: {
      pt: 'Acerte quem vence (ou o empate).',
      es: 'Acierta quién gana (o el empate).',
      en: 'Call the winner (or the draw).',
    },
    steps: steps('predictions.winner', [3, 10, 30, 75, 200], HIT_BONUS),
  },
  {
    id: 'predictions.quantity',
    sport: null,
    category: 'hit',
    family: 'predictions',
    rule: { input: 'prediction', kind: 'quantity', correct: true },
    stepped: true,
    seasonal: true,
    active: true,
    name: { pt: 'Conta certa', es: 'Cuenta justa', en: 'Right count' },
    description: {
      pt: 'Acerte o Palpite de quantidade ("pelo menos N").',
      es: 'Acierta el pronóstico de cantidad ("al menos N").',
      en: 'Get the quantity prediction ("at least N") right.',
    },
    steps: steps('predictions.quantity', [3, 10, 30, 75, 200], HIT_BONUS),
  },
  {
    id: 'predictions.placed',
    sport: null,
    category: 'participation',
    family: 'predictions',
    rule: { input: 'prediction' },
    stepped: true,
    seasonal: true,
    active: true,
    name: { pt: 'Sempre no jogo', es: 'Siempre en juego', en: 'Always in' },
    description: {
      pt: 'Palpite nos jogos, acertando ou não.',
      es: 'Pronostica en los partidos, aciertes o no.',
      en: 'Make predictions, right or wrong.',
    },
    steps: steps('predictions.placed', [5, 15, 40, 100, 250], []),
  },
  {
    id: 'loyalty.watched',
    sport: null,
    category: 'participation',
    family: 'loyalty',
    rule: { input: 'participation', action: 'watched' },
    stepped: true,
    seasonal: true,
    active: true,
    name: { pt: 'Fiel', es: 'Fiel', en: 'Loyal' },
    description: {
      pt: 'Acompanhe ao vivo pelo menos 2/3 de um jogo.',
      es: 'Sigue en vivo al menos 2/3 de un partido.',
      en: 'Watch at least 2/3 of a match live.',
    },
    steps: steps('loyalty.watched', [1, 5, 15, 38, 100], []),
  },
  {
    id: 'knowledge.trivia',
    sport: null,
    category: 'participation',
    family: 'knowledge',
    rule: { input: 'participation', action: 'trivia' },
    stepped: true,
    seasonal: false,
    active: false,
    inactiveReason: 'A trivia (#960) ainda não emite o sinal de resposta certa.',
    name: { pt: 'Conhecedor', es: 'Conocedor', en: 'Expert' },
    description: {
      pt: 'Acerte perguntas da trivia.',
      es: 'Acierta preguntas de trivia.',
      en: 'Answer trivia questions right.',
    },
    steps: steps('knowledge.trivia', [3, 10, 30, 75, 200], []),
  },
  {
    id: 'community.poll',
    sport: null,
    category: 'participation',
    family: 'community',
    rule: { input: 'participation', action: 'poll' },
    stepped: true,
    seasonal: false,
    // ligada na 0194: o voto passa a contar pelo GameScorer.sweepPolls (#947)
    active: true,
    name: { pt: 'Voz da torcida', es: 'Voz de la hinchada', en: 'Voice of the fans' },
    description: { pt: 'Vote nas enquetes.', es: 'Vota en las encuestas.', en: 'Vote in polls.' },
    steps: steps('community.poll', [3, 10, 30, 75, 200], []),
  },
  {
    id: 'consumption.recap',
    sport: null,
    category: 'consumption',
    family: 'consumption',
    rule: { input: 'participation', action: 'consumption' },
    stepped: true,
    seasonal: false,
    active: false,
    inactiveReason: 'Ainda não há sinal real de "conferiu o resumo".',
    name: { pt: 'Sempre por dentro', es: 'Siempre al día', en: 'In the know' },
    description: {
      pt: 'Confira o resumo das partidas.',
      es: 'Revisa el resumen de los partidos.',
      en: 'Check match recaps.',
    },
    steps: steps('consumption.recap', [10, 25, 50, 100, 250], []),
  },
]);

/** Níveis do torcedor por Pontos acumulados (da Galaxie, iguais para todos os clientes). */
export const LEVELS: readonly { level: number; minPoints: number }[] = Object.freeze(
  [0, 100, 300, 700, 1500, 3000, 6000, 10000, 16000, 25000].map((minPoints, i) => ({
    level: i + 1,
    minPoints,
  })),
);

export function levelFor(points: number): number {
  let level = 1;
  for (const l of LEVELS) if (points >= l.minPoints) level = l.level;
  return level;
}

/** Jogo assistido (decisão do Wagner, 16/11): presença verificada em pelo menos 2/3 do evento. */
export const WATCHED_MIN_FRACTION = 2 / 3;

/** A presença somada no jogo basta para contar como assistido? */
export function watchedEnough(presentMs: number, eventMs: number): boolean {
  return eventMs > 0 && presentMs >= WATCHED_MIN_FRACTION * eventMs;
}
