/**
 * Minuto a minuto (docs/05 §3.2.1): a partir dos lances do fornecedor (`core.event_incident`), do estado
 * do evento e do log de estados (`core.event_state_log`), monta lances com tipo canônico, relógio de jogo,
 * instante UTC, peso de momento-chave e placar parcial; os marcos do jogo; e a disputa de pênaltis
 * cobrança a cobrança. Lógica pura (sem banco), testada em timeline.test.ts.
 */
import type {
  EventStatus,
  EventTimeline,
  MatchClock,
  MatchPeriod,
  OccurredAtSource,
  PenaltyShootout,
  TimelineFlag,
  TimelineIncident,
  TimelineKind,
  TimelineMarker,
  TimelineMarkerKind,
  TimelinePerson,
} from '@galaxie/contracts';

type Side = 'home' | 'away';
export type TeamRef = { id: string | null; name: string | null; side: string | null; logo: string | null };

export interface RawIncident {
  sequence: number;
  minute: number | null;
  extra: number | null;
  type: string;
  detail: string | null;
  comments: string | null;
  team: TeamRef | null;
  player: TimelinePerson | null;
  assist: TimelinePerson | null;
  /** Primeira gravação do lance pela Galaxie (do UUIDv7 da linha); null se desconhecida. */
  observedAt: Date | null;
}

export interface StateLogEntry {
  from: EventStatus | null;
  to: EventStatus;
  reason: string;
  statusDetail: string | null;
  at: Date;
}

export interface TimelineInput {
  eventId: string;
  status: EventStatus;
  statusDetail: string | null;
  clock: { minute: number | null; extra: number | null } | null;
  score: {
    home: number | null;
    away: number | null;
    extratime?: { home: number | null; away: number | null } | null;
    penalty?: { home: number | null; away: number | null } | null;
  };
  incidents: RawIncident[];
  /** `fixture.periods` do fornecedor (início do 1º e do 2º tempo). */
  periods: { first: Date | null; second: Date | null };
  /** Horário marcado (o 1º tempo observado só vale perto dele). */
  startsAt?: Date | null;
  stateLog: StateLogEntry[];
  /** Papel na escalação (para acertar quem entra e quem sai na substituição). */
  lineupRole?: (personId: string | null) => 'starter' | 'sub' | null;
  venueTimezone: string | null;
  lastValidAt: Date | null;
  isStale: boolean;
  now: Date;
}

const SHOOTOUT_COMMENT = 'penalty shootout';
const IN_PLAY: readonly EventStatus[] = ['starting', 'live', 'break', 'suspended'];
const PERIOD_BASE: Record<Exclude<MatchPeriod, 'penalty_shootout'>, number> = {
  first_half: 0,
  second_half: 45,
  extra_time_first: 90,
  extra_time_second: 105,
};
const PERIOD_RANK: Record<MatchPeriod, number> = {
  first_half: 1,
  second_half: 2,
  extra_time_first: 3,
  extra_time_second: 4,
  penalty_shootout: 5,
};

/** Peso de cada tipo (o decisivo vira 100). */
export const KIND_WEIGHT: Record<TimelineKind, number> = {
  penalty_goal: 80,
  penalty_missed: 80,
  red_card: 70,
  second_yellow: 70,
  goal: 60,
  own_goal: 60,
  shootout_scored: 45,
  shootout_missed: 45,
  var: 40,
  yellow_card: 30,
  other: 20,
  substitution: 10,
};
/** VAR sobre gol, pênalti ou vermelho pesa mais que os demais. */
const VAR_KEY_WEIGHT = 65;
const DECISIVE_WEIGHT = 100;
/** Atraso máximo do apito para aceitar o "1H" observado como início do jogo. */
const FIRST_HALF_GRACE_MS = 30 * 60_000;
export const KEY_MOMENT_MIN_WEIGHT = 60;

/** Instante UTC com sufixo Z, sem milissegundos (precisão de minuto nos derivados). */
export const utc = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function isShootout(i: Pick<RawIncident, 'comments'>): boolean {
  return (i.comments ?? '').trim().toLowerCase() === SHOOTOUT_COMMENT;
}

/** Período do lance pelo minuto do fornecedor (45+x ainda é 1º tempo; 90+x, 2º). */
export function periodOf(i: Pick<RawIncident, 'minute' | 'comments'>): MatchPeriod | null {
  if (isShootout(i)) return 'penalty_shootout';
  const m = i.minute;
  if (m == null) return null;
  if (m <= 45) return 'first_half';
  if (m <= 90) return 'second_half';
  if (m <= 105) return 'extra_time_first';
  return 'extra_time_second';
}

export function clockDisplay(minute: number | null, extra: number | null): string | null {
  if (minute == null) return null;
  return extra ? `${minute}+${extra}'` : `${minute}'`;
}

function kindOf(i: RawIncident): TimelineKind {
  const type = i.type.toLowerCase();
  const detail = (i.detail ?? '').toLowerCase();
  const shootout = isShootout(i);
  if (type === 'goal') {
    if (shootout) return 'shootout_scored';
    return detail === 'penalty' ? 'penalty_goal' : 'goal';
  }
  if (type === 'own_goal') return 'own_goal';
  if (type === 'penalty_missed') return shootout ? 'shootout_missed' : 'penalty_missed';
  if (type === 'card') {
    if (detail.includes('second yellow')) return 'second_yellow';
    if (detail.includes('red')) return 'red_card';
    return 'yellow_card';
  }
  if (type === 'subst') return 'substitution';
  if (type === 'var') return 'var';
  return 'other';
}

const personKey = (p: TimelinePerson | null) => (p ? (p.id ?? `name:${p.name.toLowerCase()}`) : null);

/** Início de cada período em UTC: do fornecedor (`fixture.periods`) ou observado no log de estados. */
export function periodAnchors(input: Pick<TimelineInput, 'periods' | 'stateLog' | 'startsAt'>) {
  /**
   * Só vale a transição que é de fato a fronteira do período: o 2º tempo e a prorrogação saindo de um
   * intervalo observado, os intervalos saindo de bola rolando e o 1º tempo perto do horário marcado. Se o
   * Live Poller pegou o jogo já no meio (ingestor reiniciado), a primeira observação não é o início.
   */
  const observed = (detail: string, from: (EventStatus | null)[], nth = 0) =>
    input.stateLog.filter(
      (l) =>
        (l.to === 'live' || l.to === 'break') &&
        l.reason !== 'temporal' &&
        l.reason !== 'temporal_fallback' &&
        (l.statusDetail ?? '').toUpperCase() === detail &&
        from.includes(l.from) &&
        (detail !== '1H' ||
          !input.startsAt ||
          l.at.getTime() <= input.startsAt.getTime() + FIRST_HALF_GRACE_MS),
    )[nth]?.at ?? null;
  const anchor = (provider: Date | null, seen: Date | null) =>
    provider
      ? { at: provider, source: 'provider' as const }
      : seen
        ? { at: seen, source: 'observed' as const }
        : null;
  return {
    first_half: anchor(input.periods.first, observed('1H', [null, 'scheduled', 'starting'])),
    second_half: anchor(input.periods.second, observed('2H', ['break'])),
    extra_time_first: anchor(null, observed('ET', ['break'], 0)),
    extra_time_second: anchor(null, observed('ET', ['break'], 1)),
    penalty_shootout: anchor(null, observed('P', ['break'])),
    halftime: anchor(null, observed('HT', ['live'])),
    end_of_regulation: anchor(null, observed('BT', ['live'], 0)),
  };
}

/** A Galaxie acompanhou o jogo ao vivo (o fornecedor confirmou um estado em andamento)? */
function watchedLive(log: StateLogEntry[]): boolean {
  return log.some(
    (l) => (l.to === 'live' || l.to === 'break') && (l.reason === 'provider' || l.reason === 'correction'),
  );
}

function finishedAt(log: StateLogEntry[]): Date | null {
  const end = [...log]
    .reverse()
    .find(
      (l) =>
        l.to === 'finished' &&
        (l.from === 'live' || l.from === 'break' || l.from === 'suspended') &&
        l.reason !== 'temporal_fallback',
    );
  return end?.at ?? null;
}

const STATUS_PHASE: Record<string, number> = {
  '1H': 1,
  HT: 2,
  '2H': 3,
  BT: 4,
  ET: 4,
  P: 5,
  FT: 3,
  AET: 4,
  PEN: 5,
};

/** Relógio atual do evento a partir do código do fornecedor. */
export function currentClock(
  status: EventStatus,
  statusDetail: string | null,
  clock: TimelineInput['clock'],
): MatchClock | null {
  const code = (statusDetail ?? '').toUpperCase();
  if (!(code in STATUS_PHASE) && !['live', 'break', 'finished', 'suspended'].includes(status)) return null;
  const minute = clock?.minute ?? null;
  const extra = clock?.extra ?? null;
  let period: MatchPeriod | null = null;
  if (code === '1H' || code === 'HT') period = 'first_half';
  else if (code === '2H') period = 'second_half';
  else if (code === 'P' || code === 'PEN') period = 'penalty_shootout';
  else if (minute != null) period = periodOf({ minute, comments: null });
  if (code in STATUS_PHASE || minute != null)
    return { period, minute, extra_minute: extra, display: clockDisplay(minute, extra) };
  return null;
}

export function buildTimelineDto(input: TimelineInput): EventTimeline {
  const anchors = periodAnchors(input);
  const watched = watchedLive(input.stateLog);
  const endAt = finishedAt(input.stateLog);
  const finished = input.status === 'finished';

  const occurred = (
    period: MatchPeriod | null,
    minute: number | null,
    extra: number | null,
    observedAt: Date | null,
  ): { occurred_at: string | null; occurred_at_source: OccurredAtSource | null } => {
    const anchor = period ? anchors[period] : null;
    if (anchor && period && period !== 'penalty_shootout' && minute != null) {
      const offset = Math.max(0, minute - PERIOD_BASE[period] - 1 + (extra ?? 0));
      return {
        occurred_at: utc(new Date(anchor.at.getTime() + offset * 60_000)),
        occurred_at_source: 'clock',
      };
    }
    // sem início de período: a primeira observação só vale se acompanhamos o jogo ao vivo
    if (observedAt && watched && (!endAt || observedAt.getTime() <= endAt.getTime() + 5 * 60_000))
      return { occurred_at: utc(observedAt), occurred_at_source: 'observed' };
    return { occurred_at: null, occurred_at_source: null };
  };

  // ─ lances: tipo, relógio, instante, placar parcial e bandeiras ─
  const yellows = new Set<string>();
  let home = 0;
  let away = 0;
  let goals = 0;
  let scoreKnown = true;
  const incidents: TimelineIncident[] = input.incidents.map((raw) => {
    let kind = kindOf(raw);
    const key = personKey(raw.player);
    if (kind === 'yellow_card' && key) yellows.add(key);
    else if (kind === 'red_card' && key && yellows.has(key)) kind = 'second_yellow';

    const period = periodOf(raw);
    const shootout = period === 'penalty_shootout';
    const clock: MatchClock = shootout
      ? { period, minute: null, extra_minute: null, display: null }
      : { period, minute: raw.minute, extra_minute: raw.extra, display: clockDisplay(raw.minute, raw.extra) };

    let weight = KIND_WEIGHT[kind];
    if (kind === 'var' && /goal|penalty|red/i.test(raw.detail ?? '')) weight = VAR_KEY_WEIGHT;

    const flags: TimelineFlag[] = [];
    let scoreAfter: { home: number; away: number } | null = null;
    if (kind === 'goal' || kind === 'own_goal' || kind === 'penalty_goal') {
      const side = raw.team?.side;
      if (side === 'home' || side === 'away') {
        const tiedBefore = home === away;
        if (side === 'home') home += 1;
        else away += 1;
        goals += 1;
        scoreAfter = { home, away };
        if (goals === 1) flags.push('opener');
        if (home === away) flags.push('equalizer');
        else if (tiedBefore) flags.push('go_ahead');
      } else scoreKnown = false;
    }

    // substituição: o fornecedor manda quem sai em `player` e quem entra em `assist`; a escalação desempata
    let playerIn: TimelinePerson | null = null;
    let playerOut: TimelinePerson | null = null;
    if (kind === 'substitution') {
      playerOut = raw.player;
      playerIn = raw.assist;
      const role = input.lineupRole;
      if (role && role(raw.player?.id ?? null) === 'sub' && role(raw.assist?.id ?? null) === 'starter') {
        playerOut = raw.assist;
        playerIn = raw.player;
      }
    }

    return {
      sequence: raw.sequence,
      minute: raw.minute,
      extra: raw.extra,
      type: raw.type,
      detail: raw.detail,
      comments: raw.comments,
      team: raw.team,
      player: raw.player,
      assist: raw.assist,
      kind,
      clock,
      ...occurred(period, raw.minute, raw.extra, raw.observedAt),
      weight,
      key_moment: weight >= KEY_MOMENT_MIN_WEIGHT,
      flags,
      score_after: scoreAfter,
      player_in: playerIn,
      player_out: playerOut,
    };
  });

  // gol decisivo: com o jogo encerrado no tempo de jogo, o gol do vencedor que o pôs à frente de vez
  const { score } = input;
  const penaltyDecided = score.penalty?.home != null && score.penalty?.away != null;
  if (
    finished &&
    !penaltyDecided &&
    scoreKnown &&
    score.home != null &&
    score.away != null &&
    score.home !== score.away &&
    home === score.home &&
    away === score.away
  ) {
    const winner: Side = score.home > score.away ? 'home' : 'away';
    const loserGoals = Math.min(score.home, score.away);
    const decisive = incidents.find(
      (i) => i.score_after && i.team?.side === winner && i.score_after[winner] === loserGoals + 1,
    );
    if (decisive) {
      decisive.flags.push('decisive');
      decisive.weight = DECISIVE_WEIGHT;
      decisive.key_moment = true;
    }
  }

  // ─ disputa de pênaltis ─
  const kicks = incidents.filter((i) => i.clock.period === 'penalty_shootout');
  let shootout: PenaltyShootout | null = null;
  if (kicks.length) {
    let ph = 0;
    let pa = 0;
    const perTeam = new Map<string, number>();
    const out = kicks.map((k, idx) => {
      const scored = k.kind === 'shootout_scored';
      const side = k.team?.side;
      if (scored && side === 'home') ph += 1;
      if (scored && side === 'away') pa += 1;
      const teamKey = side ?? k.team?.name ?? '?';
      const round = (perTeam.get(teamKey) ?? 0) + 1;
      perTeam.set(teamKey, round);
      k.score_after = { home: ph, away: pa };
      return {
        order: idx + 1,
        round,
        sequence: k.sequence,
        team: k.team,
        player: k.player,
        scored,
        score_after: { home: ph, away: pa },
        decisive: false,
      };
    });
    const final =
      score.penalty?.home != null && score.penalty?.away != null
        ? { home: score.penalty.home, away: score.penalty.away }
        : { home: ph, away: pa };
    const winner: Side | null =
      finished && final.home !== final.away ? (final.home > final.away ? 'home' : 'away') : null;
    if (winner) {
      const last = out.at(-1)!;
      last.decisive = true;
      const inc = kicks.at(-1)!;
      inc.flags.push('decisive');
      inc.weight = DECISIVE_WEIGHT;
      inc.key_moment = true;
    }
    shootout = { first_kicker: kicks[0]!.team, score: final, winner_side: winner, kicks: out };
  }

  // ─ marcos ─
  const code = (input.statusDetail ?? '').toUpperCase();
  const started =
    input.status === 'finished' ||
    input.status === 'abandoned' ||
    (input.status !== 'scheduled' && input.status !== 'starting' && code in STATUS_PHASE) ||
    input.incidents.length > 0;
  let phase = STATUS_PHASE[code] ?? (started ? 1 : 0);
  let maxRank = 0;
  for (const i of incidents) maxRank = Math.max(maxRank, i.clock.period ? PERIOD_RANK[i.clock.period] : 0);
  // lances numa fase posterior provam que o jogo chegou lá
  const rankToPhase = [0, 1, 3, 4, 4, 5];
  phase = Math.max(phase, rankToPhase[maxRank] ?? 0);
  // BT sozinho é o intervalo antes da prorrogação: ela ainda não começou
  const extraTimeStarted =
    ['ET', 'AET'].includes(code) ||
    incidents.some((i) => i.clock.period === 'extra_time_first' || i.clock.period === 'extra_time_second') ||
    ((code === 'P' || code === 'PEN') &&
      ((score.extratime?.home ?? 0) > 0 || (score.extratime?.away ?? 0) > 0)) ||
    anchors.extra_time_first != null;

  const maxExtra = (period: MatchPeriod) =>
    incidents.reduce((m, i) => (i.clock.period === period ? Math.max(m, i.extra ?? 0) : m), 0) || null;
  const marker = (
    kind: TimelineMarkerKind,
    clock: MatchClock,
    anchor: { at: Date; source: OccurredAtSource } | null,
  ): TimelineMarker => ({
    kind,
    clock,
    occurred_at: anchor ? utc(anchor.at) : null,
    occurred_at_source: anchor?.source ?? null,
  });
  const c = (period: MatchPeriod | null, minute: number | null, extra: number | null = null): MatchClock => ({
    period,
    minute,
    extra_minute: extra,
    display: clockDisplay(minute, extra),
  });

  const markers: TimelineMarker[] = [];
  if (started && phase >= 1) markers.push(marker('kickoff', c('first_half', 0), anchors.first_half));
  if (phase >= 2)
    markers.push(marker('halftime', c('first_half', 45, maxExtra('first_half')), anchors.halftime));
  if (phase >= 3) markers.push(marker('second_half', c('second_half', 46), anchors.second_half));
  const goesBeyond90 = extraTimeStarted || phase >= 5 || code === 'BT';
  if (goesBeyond90)
    markers.push(
      marker('end_of_regulation', c('second_half', 90, maxExtra('second_half')), anchors.end_of_regulation),
    );
  if (extraTimeStarted && phase >= 4)
    markers.push(marker('extra_time', c('extra_time_first', 91), anchors.extra_time_first));
  if (phase >= 5 || kicks.length)
    markers.push(marker('penalty_shootout', c('penalty_shootout', null), anchors.penalty_shootout));
  if (finished) {
    const lastPeriod: MatchPeriod = kicks.length
      ? 'penalty_shootout'
      : extraTimeStarted
        ? 'extra_time_second'
        : 'second_half';
    const lastMinute = lastPeriod === 'penalty_shootout' ? null : lastPeriod === 'second_half' ? 90 : 120;
    markers.push(
      marker(
        'full_time',
        c(lastPeriod, lastMinute, lastPeriod === 'second_half' ? maxExtra('second_half') : null),
        endAt ? { at: endAt, source: 'observed' } : null,
      ),
    );
  }

  return {
    event_id: input.eventId,
    status: input.status,
    status_detail: input.statusDetail,
    live: IN_PLAY.includes(input.status),
    clock: started ? currentClock(input.status, input.statusDetail, input.clock) : null,
    score: { home: score.home ?? null, away: score.away ?? null },
    incidents,
    markers,
    shootout,
    venue_timezone: input.venueTimezone,
    data_freshness: {
      last_valid_at: input.lastValidAt ? utc(input.lastValidAt) : null,
      is_stale: input.isStale,
    },
    generated_at: utc(input.now),
  };
}

/** Instante embutido num UUIDv7 (48 bits de ms); null para outras versões. */
export function uuidv7Time(id: string): Date | null {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32 || hex[12] !== '7') return null;
  const ms = Number.parseInt(hex.slice(0, 12), 16);
  return Number.isFinite(ms) ? new Date(ms) : null;
}
