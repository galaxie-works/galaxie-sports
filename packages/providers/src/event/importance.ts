/**
 * Score de importância do evento (docs/06 §3): tier da competição + fase (com desconto no jogo de ida)
 * + clássico × intensidade + decisão (título, rebaixamento, eliminação, vaga) + prestígio da competição
 * (continentais e torneios de seleções). Usado para ordenar "Meu dia esportivo" e priorizar o ao vivo.
 * Função pura e global (sem mercado): a relevância por país é calculada na API, por cima deste score.
 * A detecção de clássico, a perna do confronto e os stakes da tabela vêm de fora.
 */
import type { StageKind } from '../model.js';

/** Sinais de jogo decisivo calculados pelo cenário da competição (docs/06 `competition_context`). */
export const DECISIVE_FLAGS = ['title', 'relegation', 'elimination', 'qualification'] as const;
export type DecisiveFlag = (typeof DECISIVE_FLAGS)[number];

export interface DerbyMatch {
  derbyId: string;
  /** Intensidade 1–5 da base semântica. */
  intensity: number;
}

/**
 * Busca de clássico por par de participantes (IDs canônicos), em qualquer ordem.
 * Implementada pela base semântica; aqui só o contrato.
 */
export type DerbyLookup = (
  participantA: string,
  participantB: string,
) => DerbyMatch | null | undefined | Promise<DerbyMatch | null | undefined>;

export interface ImportanceInput {
  /** Tier da competição (1 = máxima cobertura); `null` quando desconhecida. */
  tier: number | null;
  stageKind: StageKind | null;
  /** Progresso da fase de pontos corridos (0 = 1ª rodada, 1 = última). */
  roundProgress?: number | null;
  /** Perna do confronto de ida e volta (1 = ida, 2 = volta); `null`/ausente em jogo único. */
  leg?: 1 | 2 | null;
  derby?: DerbyMatch | null;
  decisive?: readonly DecisiveFlag[];
  /** Prestígio da competição (0–10, do catálogo): continentais e torneios de seleções. */
  prestige?: number | null;
}

export interface ImportanceBreakdown {
  tier: number;
  phase: number;
  derby: number;
  decisive: number;
  prestige: number;
}

export interface Importance {
  /** 0–100. */
  score: number;
  breakdown: ImportanceBreakdown;
}

export const TIER_POINTS: Readonly<Record<number, number>> = { 1: 40, 2: 25, 3: 10 };
const UNKNOWN_TIER_POINTS = 5;

export const PHASE_POINTS: Readonly<Record<StageKind, number>> = {
  final: 30,
  semi_final: 22,
  quarter_final: 16,
  round_of_16: 12,
  playoff: 10,
  third_place: 8,
  round_of_32: 8,
  relegation: 8,
  knockout_round: 6,
  group: 6,
  league_phase: 6,
  round_of_64: 5,
  regular: 4,
  // um GP vale como uma rodada do campeonato
  race_weekend: 4,
  // uma noite de lutas (card de MMA) também
  fight_card: 4,
  round_of_128: 3,
  other: 3,
  qualifying: 2,
  friendly: 0,
};

/** Bônus máximo da reta final em fases de pontos corridos. */
const LATE_SEASON_POINTS = 6;
const DERBY_POINTS_PER_INTENSITY = 6;
/** Jogo de ida vale 75% dos pontos da fase: a decisão fica para a volta. */
export const FIRST_LEG_PHASE_FACTOR = 0.75;
/** Teto do prestígio da competição. */
export const MAX_PRESTIGE = 10;

export const DECISIVE_POINTS: Readonly<Record<DecisiveFlag, number>> = {
  title: 15,
  relegation: 10,
  elimination: 8,
  qualification: 6,
};
const DECISIVE_CAP = 20;

/**
 * Fases de mata-mata (o perdedor do confronto sai; a final dá o título). Só valem como mata-mata sem
 * número de rodada no rótulo: "Relegation - 3" e "1st Round - 10" são rodadas de pontos corridos.
 */
export const KNOCKOUT_STAGE_KINDS: ReadonlySet<StageKind> = new Set<StageKind>([
  'qualifying',
  'playoff',
  'relegation',
  'knockout_round',
  'round_of_128',
  'round_of_64',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
]);

/** Fases de pontos corridos em que o progresso da rodada vale a reta final. */
export const LEAGUE_PROGRESS_KINDS: ReadonlySet<StageKind> = new Set<StageKind>(['regular', 'league_phase']);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function importance(input: ImportanceInput): Importance {
  const tier = input.tier != null ? (TIER_POINTS[input.tier] ?? UNKNOWN_TIER_POINTS) : UNKNOWN_TIER_POINTS;

  let phase = input.stageKind ? PHASE_POINTS[input.stageKind] : PHASE_POINTS.other;
  if (input.stageKind && LEAGUE_PROGRESS_KINDS.has(input.stageKind) && input.roundProgress != null)
    phase += Math.round(LATE_SEASON_POINTS * clamp(input.roundProgress, 0, 1));
  if (input.leg === 1) phase = Math.round(phase * FIRST_LEG_PHASE_FACTOR);

  const derby = input.derby ? DERBY_POINTS_PER_INTENSITY * clamp(Math.round(input.derby.intensity), 1, 5) : 0;

  const decisive = Math.min(
    DECISIVE_CAP,
    [...new Set(input.decisive ?? [])].reduce((sum, flag) => sum + DECISIVE_POINTS[flag], 0),
  );

  const prestige = clamp(Math.round(input.prestige ?? 0), 0, MAX_PRESTIGE);

  return {
    score: clamp(tier + phase + derby + decisive + prestige, 0, 100),
    breakdown: { tier, phase, derby, decisive, prestige },
  };
}

/**
 * A fase é mata-mata? Exige o tipo de mata-mata e rótulo sem número de rodada (" - 3" indica rodada
 * de pontos corridos, mesmo com tipo de mata-mata: "Preliminary Round - 2", "Relegation - 5").
 */
export function isKnockoutStage(stageKind: StageKind | null, providerLabel?: string | null): boolean {
  if (!stageKind || !KNOCKOUT_STAGE_KINDS.has(stageKind)) return false;
  return !providerLabel || !/\s-\s+\d+$/.test(providerLabel.trim());
}

export interface KnockoutShape {
  /** Partidas do confronto: 1 = jogo único, 2 = ida e volta. */
  legs: 1 | 2;
  /** Perna desta partida (só em ida e volta); `null` quando a outra partida ainda não é conhecida. */
  leg: 1 | 2 | null;
}

/**
 * Decisão estrutural do mata-mata, sem tabela nem placar: o jogo único e a volta eliminam (`elimination`);
 * a final (jogo único ou volta) vale o título (`title`, que já implica a eliminação). A ida, a disputa de
 * 3º lugar e a perna desconhecida não decidem nada. O playoff de rebaixamento decide a queda.
 * Quem chama garante que a fase é mata-mata (`isKnockoutStage`).
 */
export function knockoutDecisive(stageKind: StageKind | null, shape: KnockoutShape): DecisiveFlag[] {
  if (!stageKind || !KNOCKOUT_STAGE_KINDS.has(stageKind) || stageKind === 'third_place') return [];
  if (shape.legs === 2 && shape.leg !== 2) return [];
  if (stageKind === 'final') return ['title'];
  if (stageKind === 'relegation') return ['relegation'];
  return ['elimination'];
}

/**
 * Progresso da rodada numa fase de pontos corridos: rodada 1 → 0, última → 1. `null` sem número de
 * rodada ou sem total conhecido.
 */
export function roundProgress(round: number | null, totalRounds: number | null): number | null {
  if (round == null || totalRounds == null || totalRounds < 2) return null;
  return clamp((round - 1) / (totalRounds - 1), 0, 1);
}
