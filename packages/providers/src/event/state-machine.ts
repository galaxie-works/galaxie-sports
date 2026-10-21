/**
 * Máquina de estados do evento canônico e regras de *last-known-good* (docs/04 §3.1).
 *
 * Funções puras: recebem o estado atual e uma observação (dado válido do fornecedor, falha da fonte
 * ou apenas a passagem do tempo) e devolvem o novo estado e as transições a registrar em
 * `core.event_state_log`. Nada aqui lê relógio do sistema ou banco — o chamador informa os instantes.
 */
import { isInPlay, isPreMatch, preMatchStatus, STARTING_WINDOW_MS, type EventStatus } from './status.js';

export interface EventClock {
  minute: number | null;
  extra: number | null;
  period: string | null;
}

export interface ScorePair {
  home: number | null;
  away: number | null;
}

export interface EventScore {
  home: number | null;
  away: number | null;
  halftime?: ScorePair;
  extratime?: ScorePair | null;
  penalty?: ScorePair | null;
  aggregate?: { home: number; away: number } | null;
}

/** De onde veio o estado atual: dado do fornecedor ou inferência pelo horário. */
export type StatusSource = 'provider' | 'temporal';

export interface EventState {
  status: EventStatus;
  /** Último código recebido do fornecedor (NS, 1H, HT, FT, PST...). */
  statusDetail: string | null;
  statusSource: StatusSource;
  clock: EventClock | null;
  score: EventScore | null;
  startsAt: Date;
  endsAtExpected: Date;
  /** Instante da última observação válida aplicada. */
  lastValidAt: Date | null;
  /** `true` quando servimos o último estado válido porque a fonte falhou ou ficou sem dados frescos. */
  isStale: boolean;
}

/** Dado válido do fornecedor sobre o evento, já traduzido para o modelo canônico. */
export interface ValidObservation {
  kind: 'valid';
  /** Quando o fornecedor nos entregou o dado (ex.: `fetched_at` do raw). */
  observedAt: Date;
  /** Estado canônico; `null` quando o código do fornecedor é desconhecido. */
  status: EventStatus | null;
  statusDetail: string | null;
  clock: EventClock | null;
  score: EventScore | null;
  startsAt: Date;
  endsAtExpected: Date;
}

export type FailureReason =
  | 'http_error'
  | 'timeout'
  | 'empty_payload'
  | 'missing_event'
  | 'plan'
  | 'quota'
  | 'rate_limited'
  | 'auth'
  | 'unknown';

/** A fonte falhou (4xx/5xx), veio vazia ou não trouxe o evento pedido. */
export interface FailureObservation {
  kind: 'failure';
  observedAt: Date;
  reason: FailureReason;
}

export type Observation = ValidObservation | FailureObservation;

/**
 * Motivo gravado em `core.event_state_log.reason`:
 * - `provider`: o fornecedor confirmou o estado;
 * - `temporal`: avanço pelo horário que não depende de falha (scheduled → starting em T-10);
 * - `temporal_fallback`: avanço pelo horário porque a fonte está indisponível/sem dados frescos;
 * - `correction`: a fonte corrigiu um estado anterior (finished → live, estado inferido desfeito...).
 */
export type TransitionReason = 'provider' | 'temporal' | 'temporal_fallback' | 'correction';

export interface Transition {
  from: EventStatus | null;
  to: EventStatus;
  reason: TransitionReason;
  at: Date;
  statusDetail: string | null;
}

export type IgnoredReason = 'out_of_order' | 'unknown_status' | 'invalid_regression';

export interface StepResult {
  state: EventState;
  transitions: Transition[];
  /** Algum campo do estado mudou (o chamador só precisa gravar quando `true`). */
  changed: boolean;
  /** Observação descartada sem alterar o estado. */
  ignored?: IgnoredReason;
}

export interface MachineOptions {
  /**
   * Por quanto tempo um dado válido é considerado fresco. Sem dado fresco, o ciclo temporal
   * assume (starting → live no apito, live → finished em `ends_at_expected`). Padrão: 10 min.
   */
  freshnessMs?: number;
}

export const DEFAULT_FRESHNESS_MS = 10 * 60_000;

// ─── utilidades ──────────────────────────────────────────────────────────────────────────────────

/** Estado efetivo de uma observação: os códigos pré-jogo viram `scheduled`/`starting` pelo horário. */
export function effectiveStatus(obs: ValidObservation): EventStatus | null {
  if (obs.status == null) return null;
  return isPreMatch(obs.status) ? preMatchStatus(obs.startsAt, obs.observedAt) : obs.status;
}

/** Fase grosseira do ciclo de vida, para detectar retrocessos. */
function phase(s: EventStatus): number {
  if (s === 'scheduled') return 0;
  if (s === 'starting' || s === 'postponed') return 1;
  if (isInPlay(s)) return 2;
  return 3; // finished, cancelled, abandoned
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Compara dois estados campo a campo (datas por instante, objetos por conteúdo). */
export function sameState(a: EventState, b: EventState): boolean {
  return (
    a.status === b.status &&
    a.statusDetail === b.statusDetail &&
    a.statusSource === b.statusSource &&
    a.isStale === b.isStale &&
    a.startsAt.getTime() === b.startsAt.getTime() &&
    a.endsAtExpected.getTime() === b.endsAtExpected.getTime() &&
    (a.lastValidAt?.getTime() ?? null) === (b.lastValidAt?.getTime() ?? null) &&
    json(a.clock) === json(b.clock) &&
    json(a.score) === json(b.score)
  );
}

function isFresh(state: EventState, now: Date, freshnessMs: number): boolean {
  return (
    !state.isStale && state.lastValidAt != null && now.getTime() - state.lastValidAt.getTime() <= freshnessMs
  );
}

// ─── criação ─────────────────────────────────────────────────────────────────────────────────────

/** Primeiro registro do evento a partir de uma observação válida. */
export function initialState(obs: ValidObservation): StepResult {
  const status = effectiveStatus(obs);
  const state: EventState = {
    status: status ?? preMatchStatus(obs.startsAt, obs.observedAt),
    statusDetail: obs.statusDetail,
    statusSource: status ? 'provider' : 'temporal',
    clock: obs.clock,
    score: obs.score,
    startsAt: obs.startsAt,
    endsAtExpected: obs.endsAtExpected,
    lastValidAt: obs.observedAt,
    isStale: false,
  };
  return {
    state,
    transitions: [
      {
        from: null,
        to: state.status,
        reason: status ? 'provider' : 'temporal',
        at: obs.observedAt,
        statusDetail: obs.statusDetail,
      },
    ],
    changed: true,
  };
}

// ─── observações ─────────────────────────────────────────────────────────────────────────────────

/**
 * Aplica uma observação ao estado atual.
 *
 * Válida: substitui o estado (o fornecedor é a verdade), exceto quando não é mais nova que a última
 * aplicada (`out_of_order`), traz código desconhecido (`unknown_status`) ou faria um evento já em
 * andamento/encerrado pelo fornecedor voltar ao pré-jogo sem mudança de horário (`invalid_regression`).
 *
 * Falha: mantém o último estado válido, marca `is_stale` e deixa o relógio avançar (`tick`).
 */
export function applyObservation(
  prev: EventState,
  obs: Observation,
  options: MachineOptions = {},
): StepResult {
  if (obs.kind === 'failure') {
    const stale: EventState = { ...prev, isStale: true };
    const ticked = tick(stale, obs.observedAt, options);
    return { ...ticked, changed: !sameState(prev, ticked.state) };
  }

  const unchanged = (ignored: IgnoredReason): StepResult => ({
    state: prev,
    transitions: [],
    changed: false,
    ignored,
  });

  // Só observações mais novas que a última aplicada contam: reprocessar o mesmo raw (ou um mais
  // antigo) nunca desfaz o que veio depois — inclusive a inferência temporal.
  if (prev.lastValidAt && obs.observedAt.getTime() <= prev.lastValidAt.getTime())
    return unchanged('out_of_order');
  const target = effectiveStatus(obs);
  if (target == null) return unchanged('unknown_status');

  const rescheduled = obs.startsAt.getTime() !== prev.startsAt.getTime();
  const providerHadStarted =
    prev.statusSource === 'provider' && (isInPlay(prev.status) || prev.status === 'finished');
  if (providerHadStarted && isPreMatch(target) && !rescheduled) return unchanged('invalid_regression');

  const next: EventState = {
    status: target,
    statusDetail: obs.statusDetail,
    statusSource: 'provider',
    clock: obs.clock,
    score: obs.score,
    startsAt: obs.startsAt,
    endsAtExpected: obs.endsAtExpected,
    lastValidAt: obs.observedAt,
    isStale: false,
  };

  const transitions: Transition[] = [];
  if (target !== prev.status) {
    const correction =
      (prev.status === 'finished' && target !== 'finished') ||
      (prev.statusSource === 'temporal' && phase(target) < phase(prev.status));
    transitions.push({
      from: prev.status,
      to: target,
      reason: correction ? 'correction' : 'provider',
      at: obs.observedAt,
      statusDetail: obs.statusDetail,
    });
  }
  return { state: next, transitions, changed: !sameState(prev, next) };
}

/**
 * Passagem do tempo sem dado novo (docs/04 §3.1, regras 2 e 3):
 * - `scheduled → starting` em T-10 (sempre; o fornecedor não tem esse estado);
 * - `starting → live` no horário oficial, se não houver dado fresco do fornecedor;
 * - `live`/`break → finished` em `ends_at_expected`, se não houver dado fresco.
 * Com dado fresco dizendo "não começou", o evento fica em `starting` (atraso no início).
 */
export function tick(prev: EventState, now: Date, options: MachineOptions = {}): StepResult {
  const freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  const fresh = isFresh(prev, now, freshnessMs);
  let state = prev;
  const transitions: Transition[] = [];
  const move = (to: EventStatus, reason: TransitionReason, at: Date) => {
    transitions.push({ from: state.status, to, reason, at, statusDetail: state.statusDetail });
    state = {
      ...state,
      status: to,
      statusSource: 'temporal',
      isStale: reason === 'temporal_fallback' ? true : state.isStale,
    };
  };

  const t = now.getTime();
  for (;;) {
    const startingAt = new Date(state.startsAt.getTime() - STARTING_WINDOW_MS);
    if (state.status === 'scheduled' && t >= startingAt.getTime()) move('starting', 'temporal', startingAt);
    else if (state.status === 'starting' && !fresh && t >= state.startsAt.getTime())
      move('live', 'temporal_fallback', state.startsAt);
    else if (
      (state.status === 'live' || state.status === 'break') &&
      !fresh &&
      t >= state.endsAtExpected.getTime()
    )
      move('finished', 'temporal_fallback', state.endsAtExpected);
    else break;
  }
  return { state, transitions, changed: !sameState(prev, state) };
}
