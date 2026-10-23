/**
 * Live Scheduler (docs/07 §2.1) — algoritmo base, determinístico e auditável:
 *
 * 1. janelas ao vivo por jogo relevante (futebol: apito − 5 → + 130 min; prorrogação/pênaltis estendem);
 * 2. janelas sobrepostas são unidas → minutos ao vivo do dia;
 * 3. intervalo = minutos de janela ÷ orçamento LIVE (mínimo 15 s, a frequência do fornecedor);
 * 4. cada tick é **uma** chamada `fixtures?live=<ligas com jogo na janela>`;
 * 5. ajustes: reta final, prorrogação e pênaltis com intervalo menor (peso 2); intervalo de jogo pulado
 *    (peso 0); parada quando todos os jogos acabam.
 *
 * O orçamento é distribuído por **minutos ponderados**: um minuto de peso `w` recebe `w` vezes mais ticks
 * que um de peso 1, e a soma nunca passa do orçamento. Funções puras: o relógio, o uso de cota e os
 * candidatos vêm de fora.
 */
import type { Priority, UsageReport } from '@galaxie/apisports-client';
import {
  EXPECTED_DURATION_MIN,
  EXTRA_TIME_MIN,
  isInPlay,
  TERMINAL_STATUSES,
  type EventStatus,
} from '@galaxie/providers';
import type {
  ExcludedMatch,
  LiveBudget,
  LiveCandidate,
  LiveDayPlan,
  LivePriority,
  MatchWindow,
  PlannedMatch,
  RuntimeHints,
  TickDecision,
  WindowSegment,
} from './types.js';

const MIN = 60_000;
const DAY = 86_400_000;

// ─── perfis de janela por esporte ────────────────────────────────────────────────────────────────

export interface PhaseSpec {
  /** Minutos relativos ao apito. */
  from: number;
  to: number;
  weight: number;
}

export interface LiveWindowProfile {
  /** Minutos antes do apito (escalações, atraso, confirmação do início). */
  beforeMin: number;
  /** Minutos depois do apito em que a janela fecha (tempo normal + acréscimos + margem). */
  afterMin: number;
  /** Prorrogação e pênaltis (0 = o esporte não tem). */
  extensionMin: number;
  /** Peso de cada trecho da janela (relativo ao apito). */
  phases: PhaseSpec[];
  /** Peso do trecho de prorrogação/pênaltis. */
  extensionWeight: number;
  /** Futebol: alinha a janela pelo relógio de jogo e usa os códigos 1H/HT/2H/ET/P. */
  footballClock: boolean;
}

/**
 * Futebol: 45 + 2 de acréscimo, intervalo de 15 min (peso 0: pular), 2º tempo, reta final a partir do
 * minuto ~75 (peso 2) e margem até + 130 min. Prorrogação + pênaltis: + 45 min com peso 2.
 */
export const FOOTBALL_PROFILE: LiveWindowProfile = {
  beforeMin: 5,
  afterMin: 130,
  extensionMin: 45,
  phases: [
    { from: -5, to: 47, weight: 1 },
    { from: 47, to: 62, weight: 0 },
    { from: 62, to: 92, weight: 1 },
    { from: 92, to: 130, weight: 2 },
  ],
  extensionWeight: 2,
  footballClock: true,
};

/** Demais esportes: duração esperada (docs/04 §3) + 15 min de margem, peso 1 em toda a janela. */
export function profileFor(sport: string): LiveWindowProfile {
  if (sport === 'football') return FOOTBALL_PROFILE;
  const after = (EXPECTED_DURATION_MIN[sport] ?? 180) + 15;
  return {
    beforeMin: 5,
    afterMin: after,
    extensionMin: EXTRA_TIME_MIN[sport] ?? 0,
    phases: [{ from: -5, to: after, weight: 1 }],
    extensionWeight: 1,
    footballClock: false,
  };
}

// ─── opções ──────────────────────────────────────────────────────────────────────────────────────

export interface LiveSchedulerOptions {
  /** Menor intervalo entre ticks (a fonte atualiza a cada ~15 s). */
  minIntervalMs: number;
  /**
   * Teto desejado para o intervalo: quando incluir mais um jogo faria o intervalo passar disso, o jogo
   * (menos prioritário) fica de fora — melhor cobrir bem os principais do que mal todos.
   */
  maxIntervalMs: number;
  /** Saldo do DAILY protegido (padrão: o orçamento DAILY do dia na política/plano). */
  protectDaily?: number | undefined;
  /** Reserva 1 chamada por jogo para confirmar o placar final quando ele sai do `live`. */
  finalize: boolean;
  /** Detalhe (`fixtures?id=`) do jogo mais importante a cada tick: off, on ou auto (se o orçamento permitir). */
  featured: 'off' | 'auto' | 'on';
  /** No modo auto, o detalhe só entra se o intervalo resultante ficar até este valor. */
  featuredMaxIntervalMs: number;
  /** Quanto tempo pular depois de ver um jogo no intervalo (HT). */
  halftimeSkipMs: number;
  /** Um jogo ainda em andamento no core mantém a janela aberta por pelo menos isto. */
  graceMs: number;
  /** Teto absoluto da janela (minutos depois do horário oficial), contra jogos "presos" em andamento. */
  hardCapMin: number;
  /**
   * Menor `live_priority` acompanhada (padrão: medium). Com cota folgada, `low` põe no ao vivo as ligas
   * menores que o relógio já marca como em andamento — sem isso elas ficam "ao vivo" sem placar.
   */
  minPriority: Exclude<LivePriority, 'none'>;
}

export const DEFAULT_LIVE_OPTIONS: LiveSchedulerOptions = {
  minIntervalMs: 15_000,
  maxIntervalMs: 15 * MIN,
  finalize: true,
  featured: 'off',
  featuredMaxIntervalMs: 3 * MIN,
  halftimeSkipMs: 10 * MIN,
  graceMs: 10 * MIN,
  hardCapMin: 240,
  minPriority: 'medium',
};

export function liveOptions(partial: Partial<LiveSchedulerOptions> = {}): LiveSchedulerOptions {
  const out = { ...DEFAULT_LIVE_OPTIONS };
  for (const [k, v] of Object.entries(partial)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

// ─── relevância e prioridade ─────────────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<LivePriority, number> = { high: 3, medium: 2, low: 1, none: 0 };

/** `live_priority` a partir de `minPriority` (padrão: alta/média), ou clássico em qualquer competição. */
export function isRelevant(
  c: LiveCandidate,
  minPriority: LiveSchedulerOptions['minPriority'] = 'medium',
): boolean {
  return PRIORITY_RANK[c.livePriority] >= PRIORITY_RANK[minPriority] || c.derby;
}

export function isTerminal(status: EventStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

const PRIORITY_POINTS: Record<LivePriority, number> = { high: 300, medium: 200, low: 100, none: 0 };
const TIER_BONUS: Record<number, number> = { 1: 30, 2: 15 };
/** Jogo já em andamento nunca perde a vaga para um que ainda vai começar (estabilidade). */
const IN_PLAY_BONUS = 1_000;

/** Pontuação determinística: prioridade ao vivo + tier + clássico + importância (+ em andamento). */
export function priorityScore(c: LiveCandidate): number {
  return (
    PRIORITY_POINTS[c.livePriority] +
    (c.tier != null ? (TIER_BONUS[c.tier] ?? 0) : 0) +
    (c.derby ? 50 : 0) +
    Math.max(0, Math.min(100, c.importance)) +
    (isInPlay(c.status) ? IN_PLAY_BONUS : 0)
  );
}

function deterministicOrder(a: LiveCandidate, b: LiveCandidate): number {
  return (
    priorityScore(b) - priorityScore(a) ||
    a.startsAt.getTime() - b.startsAt.getTime() ||
    (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
  );
}

/**
 * Ordena por prioridade. Com `order` (ex.: do LLM), os jogos em andamento continuam primeiro, depois a
 * ordem sugerida (IDs desconhecidos/repetidos ignorados) e por fim os que faltaram, na ordem determinística.
 */
export function rankCandidates(
  candidates: readonly LiveCandidate[],
  order?: readonly string[],
): LiveCandidate[] {
  const base = [...candidates].sort(deterministicOrder);
  if (!order?.length) return base;
  const byId = new Map(base.map((c) => [c.eventId, c]));
  const out: LiveCandidate[] = base.filter((c) => isInPlay(c.status));
  const seen = new Set(out.map((c) => c.eventId));
  for (const id of order) {
    const c = byId.get(id);
    if (c && !seen.has(id)) {
      out.push(c);
      seen.add(id);
    }
  }
  for (const c of base) if (!seen.has(c.eventId)) out.push(c);
  return out;
}

// ─── janelas ─────────────────────────────────────────────────────────────────────────────────────

const KNOCKOUT_STAGES = new Set([
  'knockout_round',
  'round_of_128',
  'round_of_64',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
  'playoff',
]);
/** Códigos de prorrogação/pênaltis da api-sports (a extensão deixa de ser contingente). */
const EXTRA_TIME_CODES = new Set(['ET', 'BT', 'P']);

function minutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * MIN);
}

/**
 * Apito "efetivo": o horário oficial, ou — com o jogo em andamento — o instante deduzido do relógio de
 * jogo na última observação (atrasos no início deslocam a janela inteira).
 */
export function alignedKickoff(c: LiveCandidate, profile: LiveWindowProfile, hints: RuntimeHints = {}): Date {
  if (!profile.footballClock || !isInPlay(c.status)) return c.startsAt;
  const minute = c.clock?.minute;
  const at = c.lastValidAt;
  let kickoff: Date | null = null;
  if (c.statusDetail === 'HT') {
    const seen = hints.halftimeSeenAt?.get(c.eventId) ?? at;
    if (seen) kickoff = minutes(seen, -47);
  } else if (at && minute != null) {
    if (c.statusDetail === '1H') kickoff = minutes(at, -minute);
    else if (c.statusDetail === '2H') kickoff = minutes(at, -(minute + 17));
    else if (c.statusDetail === 'ET') kickoff = minutes(at, -(minute + 22));
  }
  if (!kickoff) return c.startsAt;
  // limites de sanidade: relógio do fornecedor errado não leva a janela para longe do horário oficial
  const lo = minutes(c.startsAt, -15).getTime();
  const hi = minutes(c.startsAt, 180).getTime();
  return new Date(Math.min(hi, Math.max(lo, kickoff.getTime())));
}

/** Janela de um jogo no instante `now`, já ajustada ao estado atual. */
export function matchWindow(
  c: LiveCandidate,
  now: Date,
  options: LiveSchedulerOptions = DEFAULT_LIVE_OPTIONS,
  hints: RuntimeHints = {},
  profile: LiveWindowProfile = profileFor(c.sport),
): MatchWindow {
  const kickoff = alignedKickoff(c, profile, hints);
  const start = minutes(kickoff, -profile.beforeMin);
  const confirmedExtension =
    profile.extensionMin > 0 &&
    isInPlay(c.status) &&
    (EXTRA_TIME_CODES.has(c.statusDetail ?? '') || c.score?.extratime?.home != null);
  const canExtend = profile.extensionMin > 0 && KNOCKOUT_STAGES.has(c.stageKind ?? '');

  let end = minutes(kickoff, profile.afterMin + (confirmedExtension ? profile.extensionMin : 0));
  if (isInPlay(c.status)) {
    // em andamento no core: a janela segue aberta até o jogo sair do live (com teto de sanidade)
    const keepOpen = Math.min(
      now.getTime() + options.graceMs,
      minutes(c.startsAt, options.hardCapMin).getTime(),
    );
    if (keepOpen > end.getTime()) end = new Date(keepOpen);
  }
  const contingentEnd =
    canExtend && !confirmedExtension ? minutes(kickoff, profile.afterMin + profile.extensionMin) : null;

  const phases = profile.phases.map((p) => ({
    start: minutes(kickoff, p.from),
    end: minutes(kickoff, p.to),
    weight: p.weight,
  }));
  const extensionTo = Math.max(end.getTime(), contingentEnd?.getTime() ?? 0);
  const regularEnd = minutes(kickoff, profile.afterMin);
  if (extensionTo > regularEnd.getTime()) {
    phases.push({
      start: regularEnd,
      end: new Date(extensionTo),
      weight: confirmedExtension || contingentEnd ? profile.extensionWeight : 1,
    });
  }
  return { eventId: c.eventId, start, end, contingentEnd, phases };
}

/** Fim efetivo da janela (inclui a extensão contingente). */
export function windowEnd(w: MatchWindow): Date {
  return w.contingentEnd && w.contingentEnd > w.end ? w.contingentEnd : w.end;
}

/** Une janelas sobrepostas (ou encostadas) em trechos contínuos, recortados a [from, to). */
export function mergeWindows(
  items: readonly { window: MatchWindow; candidate: LiveCandidate }[],
  from: Date,
  to: Date,
): WindowSegment[] {
  const spans = items
    .map((i) => ({
      start: Math.max(i.window.start.getTime(), from.getTime()),
      end: Math.min(windowEnd(i.window).getTime(), to.getTime()),
      league: i.candidate.providerCompetitionId,
      eventId: i.candidate.eventId,
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || (a.eventId < b.eventId ? -1 : 1));
  const out: { start: number; end: number; leagues: Set<string>; eventIds: string[] }[] = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      if (s.league) last.leagues.add(s.league);
      last.eventIds.push(s.eventId);
    } else {
      out.push({
        start: s.start,
        end: s.end,
        leagues: new Set(s.league ? [s.league] : []),
        eventIds: [s.eventId],
      });
    }
  }
  return out.map((s) => ({
    start: new Date(s.start),
    end: new Date(s.end),
    leagues: sortIds([...s.leagues]),
    eventIds: s.eventIds,
  }));
}

/** IDs numéricos em ordem numérica; os demais em ordem lexicográfica. */
export function sortIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// ─── linha do tempo ponderada ────────────────────────────────────────────────────────────────────

/** Minutos [from, to) com peso (máximo entre os jogos) e cobertura de janela. */
export class WeightTimeline {
  readonly weights: Uint8Array;
  readonly covered: Uint8Array;

  constructor(
    readonly from: Date,
    readonly to: Date,
    weights?: Uint8Array,
    covered?: Uint8Array,
  ) {
    const n = Math.max(0, Math.ceil((to.getTime() - from.getTime()) / MIN));
    this.weights = weights ? new Uint8Array(weights) : new Uint8Array(n);
    this.covered = covered ? new Uint8Array(covered) : new Uint8Array(n);
  }

  clone(): WeightTimeline {
    return new WeightTimeline(this.from, this.to, this.weights, this.covered);
  }

  private range(start: Date, end: Date): [number, number] {
    const base = this.from.getTime();
    const n = this.weights.length;
    const i0 = Math.max(0, Math.ceil((start.getTime() - base) / MIN));
    const i1 = Math.min(n, Math.ceil((end.getTime() - base) / MIN));
    return [i0, i1];
  }

  add(w: MatchWindow): void {
    const [c0, c1] = this.range(w.start, windowEnd(w));
    for (let i = c0; i < c1; i++) this.covered[i] = 1;
    for (const p of w.phases) {
      // as fases nunca passam do fim efetivo da janela
      const end = p.end < windowEnd(w) ? p.end : windowEnd(w);
      const [i0, i1] = this.range(p.start, end);
      for (let i = i0; i < i1; i++) if (p.weight > this.weights[i]!) this.weights[i] = p.weight;
    }
  }

  get totals(): { windowMinutes: number; weightedMinutes: number; activeMinutes: number } {
    let windowMinutes = 0;
    let weightedMinutes = 0;
    let activeMinutes = 0;
    for (let i = 0; i < this.weights.length; i++) {
      if (!this.covered[i]) continue;
      windowMinutes += 1;
      weightedMinutes += this.weights[i]!;
      if (this.weights[i]! > 0) activeMinutes += 1;
    }
    return { windowMinutes, weightedMinutes, activeMinutes };
  }
}

// ─── orçamento ───────────────────────────────────────────────────────────────────────────────────

export type UsageLike = Pick<UsageReport, 'dailyLimit' | 'reserve' | 'used' | 'budget' | 'totalUsed'> & {
  providerUsed?: number | undefined;
};

/**
 * Chamadas LIVE que ainda podem sair hoje: limite − reserva − tudo o que já foi usado − o saldo protegido
 * do DAILY (o sync diário nunca fica sem cota por causa do ao vivo).
 */
export function availableForLive(
  usage: UsageLike,
  protectDaily?: number,
): { available: number; protectedDaily: number } {
  const cap = usage.dailyLimit - usage.reserve;
  const total = Math.max(usage.totalUsed, usage.providerUsed ?? 0);
  const protectedDaily = Math.max(usage.used.DAILY, protectDaily ?? usage.budget.DAILY);
  const dailyLeft = Math.max(0, protectedDaily - usage.used.DAILY);
  return { available: Math.max(0, cap - total - dailyLeft), protectedDaily };
}

/** Uso vazio (pré-visualização de um dia que ainda não começou). */
export function emptyUsageReport(
  dailyLimit: number,
  reserve: number,
  budget: Record<Priority, number>,
): UsageLike {
  return { dailyLimit, reserve, used: { BOOTSTRAP: 0, DAILY: 0, LIVE: 0, ADHOC: 0 }, budget, totalUsed: 0 };
}

// ─── plano do dia ────────────────────────────────────────────────────────────────────────────────

export function utcDayBounds(at: Date): { day: string; start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return { day: start.toISOString().slice(0, 10), start, end: new Date(start.getTime() + DAY) };
}

export interface PlanInput {
  sport: string;
  now: Date;
  candidates: readonly LiveCandidate[];
  usage: UsageLike;
  options?: Partial<LiveSchedulerOptions> | undefined;
  /** Ordem sugerida pelo priorizador (IDs de evento). */
  order?: readonly string[] | undefined;
  hints?: RuntimeHints | undefined;
}

/** Fração máxima do orçamento LIVE reservada para confirmar placares finais. */
export const MAX_FINALIZE_SHARE = 0.25;

interface Evaluation {
  timeline: WeightTimeline;
  windowMinutes: number;
  weightedMinutes: number;
  activeMinutes: number;
  ticks: number;
  /** Intervalo médio (minutos de janela ÷ ticks) — o critério de inclusão, como em docs/07 §2.1. */
  intervalMs: number;
}

function evaluate(
  timeline: WeightTimeline,
  available: number,
  finalize: number,
  tickCost: number,
): Evaluation {
  const t = timeline.totals;
  const ticks = Math.max(0, Math.floor((available - finalize) / tickCost));
  return {
    timeline,
    ...t,
    ticks,
    intervalMs: ticks > 0 ? (t.windowMinutes * MIN) / ticks : t.windowMinutes > 0 ? Infinity : 0,
  };
}

/**
 * Plano do dia de cota (UTC) a partir de `now`: quais jogos entram, as janelas unidas, o orçamento LIVE e
 * o intervalo base. Determinístico para a mesma entrada.
 */
export function planLiveDay(input: PlanInput): LiveDayPlan {
  const options = liveOptions(input.options);
  const hints = input.hints ?? {};
  const { day, start: dayStart, end: dayEnd } = utcDayBounds(input.now);
  const now = input.now;

  const excluded: ExcludedMatch[] = [];
  const eligible: { candidate: LiveCandidate; window: MatchWindow }[] = [];
  let relevant = 0;
  for (const c of input.candidates) {
    const exclude = (reason: ExcludedMatch['reason']) =>
      excluded.push({ eventId: c.eventId, label: c.label, reason });
    if (!isRelevant(c, options.minPriority)) {
      exclude('not_relevant');
      continue;
    }
    relevant += 1;
    if (isTerminal(c.status)) {
      exclude('terminal');
      continue;
    }
    if (!c.providerCompetitionId) {
      exclude('no_provider_ids');
      continue;
    }
    const window = matchWindow(c, now, options, hints);
    if (windowEnd(window) <= now || window.start >= dayEnd) {
      exclude('outside_day');
      continue;
    }
    eligible.push({ candidate: c, window });
  }

  const ranked = rankCandidates(
    eligible.map((e) => e.candidate),
    input.order,
  );
  const windows = new Map(eligible.map((e) => [e.candidate.eventId, e.window]));
  const { available, protectedDaily } = availableForLive(input.usage, options.protectDaily);

  // confirmação do placar final: 1 chamada por jogo, mas no máximo 1/4 do orçamento (os ticks vêm antes)
  const finalizeFor = (matches: number) =>
    options.finalize ? Math.min(matches, Math.floor(available * MAX_FINALIZE_SHARE)) : 0;

  // inclusão gulosa pela prioridade: cada jogo entra se o intervalo continuar dentro do teto
  let current = evaluate(new WeightTimeline(now, dayEnd), available, 0, 1);
  const included: PlannedMatch[] = [];
  for (const c of ranked) {
    const window = windows.get(c.eventId)!;
    const timeline = current.timeline.clone();
    timeline.add(window);
    const next = evaluate(timeline, available, finalizeFor(included.length + 1), 1);
    if (included.length === 0 || isInPlay(c.status) || next.intervalMs <= options.maxIntervalMs) {
      included.push({ candidate: c, window, rank: included.length });
      current = next;
    } else {
      excluded.push({ eventId: c.eventId, label: c.label, reason: 'budget' });
    }
  }

  const finalizeReserve = finalizeFor(included.length);
  let featured = options.featured === 'on';
  if (options.featured === 'auto' && included.length > 0) {
    const withDetail = evaluate(current.timeline, available, finalizeReserve, 2);
    featured =
      withDetail.ticks > 0 &&
      (withDetail.windowMinutes * MIN) / withDetail.ticks <= options.featuredMaxIntervalMs;
  }
  const tickCost = featured ? 2 : 1;

  // nunca reservar mais do que o útil: com todos os minutos ativos a 15 s, o resto fica para o BOOTSTRAP
  const maxUseful =
    Math.ceil((current.activeMinutes * MIN) / options.minIntervalMs) * tickCost + finalizeReserve;
  const liveRemaining = included.length ? Math.min(available, maxUseful) : 0;
  const ticksLeft = Math.max(0, Math.floor((liveRemaining - finalizeReserve) / tickCost));
  // orçamento para todos os minutos ativos no intervalo mínimo: saturado (15 s em qualquer peso)
  const saturated = ticksLeft > 0 && ticksLeft >= (current.activeMinutes * MIN) / options.minIntervalMs;
  const baseIntervalMs = saturated
    ? options.minIntervalMs
    : ticksLeft > 0
      ? (current.weightedMinutes * MIN) / ticksLeft
      : Infinity;
  const nominalIntervalMs =
    ticksLeft > 0 ? Math.max(options.minIntervalMs, (current.windowMinutes * MIN) / ticksLeft) : Infinity;

  const budget: LiveBudget = {
    dailyLimit: input.usage.dailyLimit,
    reserve: input.usage.reserve,
    protectedDaily,
    liveTotal: input.usage.used.LIVE + liveRemaining,
    liveUsed: input.usage.used.LIVE,
    finalizeReserve,
    tickCost,
    ticksLeft,
  };

  return {
    sport: input.sport,
    day,
    generatedAt: now,
    dayStart,
    dayEnd,
    relevant,
    included,
    excluded,
    segments: mergeWindows(
      included.map((i) => ({ window: i.window, candidate: i.candidate })),
      dayStart,
      dayEnd,
    ),
    windowMinutes: current.windowMinutes,
    weightedMinutes: current.weightedMinutes,
    activeMinutes: current.activeMinutes,
    budget,
    featured,
    baseIntervalMs,
    nominalIntervalMs,
    quotaPlan: { LIVE: budget.liveTotal, DAILY: protectedDaily },
  };
}

// ─── decisão do tick ─────────────────────────────────────────────────────────────────────────────

/**
 * Peso do minuto atual para um jogo, pelo estado real (não pelo previsto): intervalo de jogo pula
 * (até `halftimeSkipMs` depois de visto), reta final (≥ 75'), prorrogação e pênaltis pesam 2.
 */
export function runtimeWeight(
  c: LiveCandidate,
  now: Date,
  options: LiveSchedulerOptions = DEFAULT_LIVE_OPTIONS,
  hints: RuntimeHints = {},
): number {
  if (isTerminal(c.status)) return 0;
  if (!profileFor(c.sport).footballClock || !isInPlay(c.status)) return 1;
  switch (c.statusDetail) {
    case 'HT': {
      const seen = hints.halftimeSeenAt?.get(c.eventId) ?? c.lastValidAt;
      return seen && now.getTime() < seen.getTime() + options.halftimeSkipMs ? 0 : 1;
    }
    case 'ET':
    case 'P':
      return 2;
    case '2H':
      return (c.clock?.minute ?? 0) >= 75 ? 2 : 1;
    default:
      return 1;
  }
}

/**
 * O que fazer em `now`: chamar (`tick`), esperar (intervalo, buraco entre janelas, intervalo de jogo ou
 * orçamento esgotado) ou parar (nenhuma janela restante no dia).
 */
export function decideTick(
  plan: LiveDayPlan,
  now: Date,
  lastTickAt: Date | null,
  options: Partial<LiveSchedulerOptions> = {},
  hints: RuntimeHints = {},
): TickDecision {
  const opts = liveOptions(options);
  if (now >= plan.dayEnd) return { kind: 'done', reason: 'day_over' };
  const active = plan.included.filter((m) => m.window.start <= now && now < windowEnd(m.window));
  const upcoming = plan.included
    .map((m) => m.window.start)
    .filter((s) => s > now && s < plan.dayEnd)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  if (!active.length) {
    if (upcoming) return { kind: 'wait', until: upcoming, reason: 'gap', active: false };
    return { kind: 'done', reason: 'no_windows' };
  }
  if (plan.budget.ticksLeft <= 0) return { kind: 'wait', until: plan.dayEnd, reason: 'budget', active: true };

  const weight = Math.max(...active.map((m) => runtimeWeight(m.candidate, now, opts, hints)));
  if (weight === 0) {
    const resumes = active
      .map((m) => {
        const seen = hints.halftimeSeenAt?.get(m.candidate.eventId) ?? m.candidate.lastValidAt ?? now;
        return new Date(seen.getTime() + opts.halftimeSkipMs);
      })
      .concat(upcoming ? [upcoming] : [])
      .sort((a, b) => a.getTime() - b.getTime());
    const until = resumes.find((d) => d > now) ?? new Date(now.getTime() + opts.minIntervalMs);
    return { kind: 'wait', until, reason: 'halftime', active: true };
  }

  const intervalMs = Math.max(opts.minIntervalMs, plan.baseIntervalMs / weight);
  const due = lastTickAt ? lastTickAt.getTime() + intervalMs : now.getTime();
  if (due > now.getTime()) return { kind: 'wait', until: new Date(due), reason: 'interval', active: true };
  return {
    kind: 'tick',
    leagues: sortIds(
      active.flatMap((m) => (m.candidate.providerCompetitionId ? [m.candidate.providerCompetitionId] : [])),
    ),
    eventIds: active.map((m) => m.candidate.eventId),
    weight,
    intervalMs,
  };
}
