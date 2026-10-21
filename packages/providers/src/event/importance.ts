/**
 * Score de importância do evento (docs/06 §3): tier da competição + fase + clássico × intensidade
 * + decisão (título, rebaixamento, eliminação, vaga). Usado para ordenar "Meu dia esportivo" e
 * priorizar o ao vivo. Função pura; a detecção de clássico vem de fora (base semântica).
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
  derby?: DerbyMatch | null;
  decisive?: readonly DecisiveFlag[];
}

export interface ImportanceBreakdown {
  tier: number;
  phase: number;
  derby: number;
  decisive: number;
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
  round_of_128: 3,
  other: 3,
  qualifying: 2,
  friendly: 0,
};

/** Bônus máximo da reta final em fases de pontos corridos. */
const LATE_SEASON_POINTS = 6;
const DERBY_POINTS_PER_INTENSITY = 6;

export const DECISIVE_POINTS: Readonly<Record<DecisiveFlag, number>> = {
  title: 15,
  relegation: 10,
  elimination: 8,
  qualification: 6,
};
const DECISIVE_CAP = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function importance(input: ImportanceInput): Importance {
  const tier = input.tier != null ? (TIER_POINTS[input.tier] ?? UNKNOWN_TIER_POINTS) : UNKNOWN_TIER_POINTS;

  let phase = input.stageKind ? PHASE_POINTS[input.stageKind] : PHASE_POINTS.other;
  if ((input.stageKind === 'regular' || input.stageKind === 'league_phase') && input.roundProgress != null)
    phase += Math.round(LATE_SEASON_POINTS * clamp(input.roundProgress, 0, 1));

  const derby = input.derby ? DERBY_POINTS_PER_INTENSITY * clamp(Math.round(input.derby.intensity), 1, 5) : 0;

  const decisive = Math.min(
    DECISIVE_CAP,
    [...new Set(input.decisive ?? [])].reduce((sum, flag) => sum + DECISIVE_POINTS[flag], 0),
  );

  return {
    score: clamp(tier + phase + derby + decisive, 0, 100),
    breakdown: { tier, phase, derby, decisive },
  };
}
