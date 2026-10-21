/**
 * Estados canônicos do evento (espelham o enum `core.event_status` do banco — docs/04 §3).
 * Mantidos aqui, sem depender do pacote do banco, para que esta lógica seja pura e reutilizável
 * pela API, pelo ingestor e por qualquer provedor.
 */
export const EVENT_STATUSES = [
  'scheduled',
  'starting',
  'live',
  'break',
  'finished',
  'postponed',
  'cancelled',
  'suspended',
  'abandoned',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Antes do apito: `scheduled` e `starting` (T-10 até a confirmação do início). */
export const PRE_MATCH_STATUSES: readonly EventStatus[] = ['scheduled', 'starting'];
/** Em andamento (inclui intervalo e interrupção). */
export const IN_PLAY_STATUSES: readonly EventStatus[] = ['live', 'break', 'suspended'];
/** Desfechos sem jogo realizado até o fim. */
export const TERMINAL_STATUSES: readonly EventStatus[] = ['finished', 'postponed', 'cancelled', 'abandoned'];

export function isPreMatch(s: EventStatus): boolean {
  return PRE_MATCH_STATUSES.includes(s);
}

export function isInPlay(s: EventStatus): boolean {
  return IN_PLAY_STATUSES.includes(s);
}

/** Janela antes do horário oficial em que o evento passa de `scheduled` a `starting`. */
export const STARTING_WINDOW_MS = 10 * 60_000;

/**
 * Duração esperada (minutos, do apito ao fim) por esporte — base do *fallback* temporal (docs/04 §3).
 * Futebol: 90 + intervalo 15 + acréscimos ≈ 115 min. Demais (issue #25): basquete/NBA ~2h15, vôlei ~2h,
 * handebol ~1h45, hóquei ~2h30, beisebol ~3h, futebol americano ~3h30, rúgbi ~1h50, AFL ~2h45 e
 * F1 ~2h (a corrida; treinos e classificação informam a própria duração). No MMA o card é variável:
 * a duração de cada luta é calculada pelo normalizador a partir do bloco do card (`durationMin`).
 */
export const EXPECTED_DURATION_MIN: Readonly<Record<string, number>> = {
  football: 115,
  basketball: 135,
  nba: 135,
  volleyball: 120,
  handball: 105,
  hockey: 150,
  rugby: 110,
  afl: 165,
  'american-football': 210,
  baseball: 180,
  mma: 30,
  'formula-1': 120,
};

/** Minutos extras quando a partida vai para prorrogação/pênaltis (futebol: 2×15 + intervalos + pênaltis). */
export const EXTRA_TIME_MIN: Readonly<Record<string, number>> = {
  football: 45,
  basketball: 20,
  nba: 20,
  hockey: 30,
  handball: 25,
  rugby: 25,
  afl: 15,
  'american-football': 20,
  baseball: 40,
};

const DEFAULT_DURATION_MIN = 180;

export interface ExpectedEndInput {
  sport: string;
  /** Horário oficial do início. */
  startsAt: Date;
  /** Início real (ex.: `fixture.periods.first`), quando o fornecedor informa. */
  actualStartAt?: Date | null | undefined;
  /** A partida já está (ou esteve) em prorrogação/pênaltis. */
  extraTime?: boolean | undefined;
  /** Duração própria do evento (ex.: sessão de treino da F1, bloco do card de MMA); substitui a do esporte. */
  durationMin?: number | null | undefined;
}

/** `ends_at_expected`: início (real, se conhecido e posterior ao oficial) + duração do esporte (+ prorrogação). */
export function expectedEnd(input: ExpectedEndInput): Date {
  const base =
    input.actualStartAt && input.actualStartAt.getTime() > input.startsAt.getTime()
      ? input.actualStartAt
      : input.startsAt;
  const minutes =
    (input.durationMin ?? EXPECTED_DURATION_MIN[input.sport] ?? DEFAULT_DURATION_MIN) +
    (input.extraTime ? (EXTRA_TIME_MIN[input.sport] ?? 0) : 0);
  return new Date(base.getTime() + minutes * 60_000);
}

/** Estado pré-jogo efetivo num instante: `starting` a partir de T-10, `scheduled` antes. */
export function preMatchStatus(startsAt: Date, at: Date): 'scheduled' | 'starting' {
  return at.getTime() >= startsAt.getTime() - STARTING_WINDOW_MS ? 'starting' : 'scheduled';
}
