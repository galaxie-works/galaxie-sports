import { describe, expect, it } from 'vitest';
import { buildTimelineDto, periodOf, uuidv7Time, type RawIncident, type TimelineInput } from './timeline.js';
import { timezoneOf, venueTimezone } from './timezone.js';

const PAL = { id: 'pal', name: 'Palmeiras', side: 'home', logo: null };
const FLU = { id: 'flu', name: 'Fluminense', side: 'away', logo: null };
const person = (id: string, name = id) => ({ id, name, photo: null, number: null, position: null });

let seq = 0;
function inc(partial: Partial<RawIncident> & Pick<RawIncident, 'type'>): RawIncident {
  return {
    sequence: seq++,
    minute: null,
    extra: null,
    detail: null,
    comments: null,
    team: null,
    player: null,
    assist: null,
    observedAt: null,
    ...partial,
  };
}

function input(partial: Partial<TimelineInput>): TimelineInput {
  return {
    eventId: '01a163b8-7ca2-71e8-a92e-8dc201d5d83a',
    status: 'finished',
    statusDetail: 'FT',
    clock: { minute: 90, extra: null },
    score: { home: null, away: null },
    incidents: [],
    periods: { first: null, second: null },
    stateLog: [],
    venueTimezone: 'America/Sao_Paulo',
    lastValidAt: new Date('2026-10-22T12:48:50Z'),
    isStale: false,
    now: new Date('2026-10-22T17:00:00.123Z'),
    ...partial,
  };
}

/** Volta da semifinal: Fluminense 1 x 0 no tempo normal e Palmeiras 5 x 3 nos pênaltis (sem prorrogação). */
function semifinal(): TimelineInput {
  seq = 0;
  const kick = (team: typeof PAL, who: string, scored: boolean, minute: number) =>
    inc({
      type: scored ? 'goal' : 'penalty_missed',
      detail: scored ? 'Penalty' : 'Missed Penalty',
      comments: 'Penalty Shootout',
      minute,
      team,
      player: person(who),
    });
  return input({
    statusDetail: 'PEN',
    clock: { minute: 120, extra: null },
    score: {
      home: 0,
      away: 1,
      extratime: { home: 0, away: 0 },
      penalty: { home: 5, away: 3 },
    },
    incidents: [
      inc({
        type: 'subst',
        detail: 'Substitution 1',
        minute: 62,
        team: PAL,
        player: person('lopez'),
        assist: person('sosa'),
      }),
      inc({ type: 'card', detail: 'Yellow Card', minute: 76, team: PAL, player: person('arias') }),
      inc({
        type: 'goal',
        detail: 'Normal Goal',
        minute: 82,
        team: FLU,
        player: person('hercules'),
        assist: person('wesley'),
      }),
      kick(PAL, 'mauricio', true, 91),
      kick(FLU, 'thiago', true, 92),
      kick(PAL, 'gomez', true, 93),
      kick(FLU, 'hercules', true, 94),
      kick(PAL, 'sosa', true, 95),
      kick(FLU, 'arana', true, 96),
      kick(PAL, 'piquerez', true, 96),
      kick(FLU, 'nonato', false, 97),
      kick(PAL, 'marlon', true, 98),
    ],
    lineupRole: (id) => (id === 'lopez' ? 'starter' : id === 'sosa' ? 'sub' : null),
  });
}

describe('buildTimelineDto', () => {
  it('monta a disputa de pênaltis cobrança a cobrança, com quem bateu primeiro e a decisiva', () => {
    const t = buildTimelineDto(semifinal());
    expect(t.shootout?.first_kicker?.name).toBe('Palmeiras');
    expect(t.shootout?.score).toEqual({ home: 5, away: 3 });
    expect(t.shootout?.winner_side).toBe('home');
    expect(
      t.shootout?.kicks.map((k) => [
        k.order,
        k.round,
        k.team?.side,
        k.scored,
        k.score_after.home,
        k.score_after.away,
      ]),
    ).toEqual([
      [1, 1, 'home', true, 1, 0],
      [2, 1, 'away', true, 1, 1],
      [3, 2, 'home', true, 2, 1],
      [4, 2, 'away', true, 2, 2],
      [5, 3, 'home', true, 3, 2],
      [6, 3, 'away', true, 3, 3],
      [7, 4, 'home', true, 4, 3],
      [8, 4, 'away', false, 4, 3],
      [9, 5, 'home', true, 5, 3],
    ]);
    expect(t.shootout?.kicks.filter((k) => k.decisive).map((k) => k.order)).toEqual([9]);
    const last = t.incidents.at(-1)!;
    expect(last).toMatchObject({
      kind: 'shootout_scored',
      weight: 100,
      key_moment: true,
      flags: ['decisive'],
    });
    expect(last.clock).toEqual({
      period: 'penalty_shootout',
      minute: null,
      extra_minute: null,
      display: null,
    });
    expect(t.incidents.find((i) => i.kind === 'shootout_missed')?.weight).toBe(45);
  });

  it('classifica os lances, pesa os momentos e calcula o placar parcial', () => {
    const t = buildTimelineDto(semifinal());
    const [sub, card, goal] = t.incidents;
    expect(sub).toMatchObject({ kind: 'substitution', weight: 10, key_moment: false });
    expect(sub?.player_out?.id).toBe('lopez');
    expect(sub?.player_in?.id).toBe('sosa');
    expect(card).toMatchObject({ kind: 'yellow_card', weight: 30 });
    // a vitória saiu nos pênaltis: o gol do tempo normal não é o decisivo
    expect(goal).toMatchObject({
      kind: 'goal',
      weight: 60,
      key_moment: true,
      flags: ['opener', 'go_ahead'],
      score_after: { home: 0, away: 1 },
      clock: { period: 'second_half', minute: 82, extra_minute: null, display: "82'" },
    });
  });

  it('marca os momentos do jogo sem inventar prorrogação', () => {
    const t = buildTimelineDto(semifinal());
    expect(t.markers.map((m) => m.kind)).toEqual([
      'kickoff',
      'halftime',
      'second_half',
      'end_of_regulation',
      'penalty_shootout',
      'full_time',
    ]);
    // jogo importado depois de encerrado: sem instante de início de período, nada de horário inventado
    expect(t.markers.every((m) => m.occurred_at === null)).toBe(true);
    expect(t.incidents.every((i) => i.occurred_at === null)).toBe(true);
    expect(t.live).toBe(false);
    expect(t.generated_at).toBe('2026-10-22T17:00:00Z');
  });

  it('acerta quem entra e quem sai pela escalação quando o fornecedor inverte', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        incidents: [
          inc({ type: 'subst', minute: 60, team: PAL, player: person('in'), assist: person('out') }),
        ],
        lineupRole: (id) => (id === 'in' ? 'sub' : id === 'out' ? 'starter' : null),
      }),
    );
    expect(t.incidents[0]?.player_in?.id).toBe('in');
    expect(t.incidents[0]?.player_out?.id).toBe('out');
  });

  it('marca o gol da vitória como decisivo e o vermelho depois do amarelo como segundo amarelo', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        score: { home: 2, away: 1 },
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 10, team: PAL }),
          inc({ type: 'card', detail: 'Yellow Card', minute: 20, team: FLU, player: person('x') }),
          inc({ type: 'goal', detail: 'Penalty', minute: 30, team: FLU }),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 45, extra: 2, team: PAL }),
          inc({ type: 'card', detail: 'Red Card', minute: 70, team: FLU, player: person('x') }),
          inc({ type: 'var', detail: 'Goal cancelled', minute: 80, team: FLU }),
        ],
      }),
    );
    const [g1, , pen, g2, red, varCall] = t.incidents;
    expect(g1?.flags).toEqual(['opener', 'go_ahead']);
    expect(pen).toMatchObject({ kind: 'penalty_goal', weight: 80, flags: ['equalizer'] });
    expect(g2).toMatchObject({
      weight: 100,
      flags: ['go_ahead', 'decisive'],
      score_after: { home: 2, away: 1 },
    });
    expect(g2?.clock.display).toBe("45+2'");
    expect(red?.kind).toBe('second_yellow');
    expect(varCall?.weight).toBe(65);
  });

  it('deriva o instante UTC do início do período (fornecedor ou observado) mais o relógio', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        status: 'live',
        statusDetail: '2H',
        clock: { minute: 67, extra: null },
        score: { home: 1, away: 0 },
        periods: { first: new Date('2026-10-22T00:31:10Z'), second: null },
        stateLog: [
          {
            from: 'starting',
            to: 'live',
            reason: 'provider',
            statusDetail: '1H',
            at: new Date('2026-10-22T00:31:40Z'),
          },
          {
            from: 'live',
            to: 'break',
            reason: 'provider',
            statusDetail: 'HT',
            at: new Date('2026-10-22T01:18:05Z'),
          },
          {
            from: 'break',
            to: 'live',
            reason: 'provider',
            statusDetail: '2H',
            at: new Date('2026-10-22T01:33:20Z'),
          },
        ],
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 23, team: PAL }),
          inc({ type: 'card', detail: 'Yellow Card', minute: 45, extra: 3, team: FLU }),
          inc({ type: 'subst', minute: 46, team: FLU }),
          inc({ type: 'card', detail: 'Yellow Card', minute: 60, team: PAL }),
        ],
      }),
    );
    expect(t.live).toBe(true);
    expect(t.clock).toEqual({ period: 'second_half', minute: 67, extra_minute: null, display: "67'" });
    expect(t.incidents.map((i) => [i.occurred_at, i.occurred_at_source])).toEqual([
      ['2026-10-22T00:53:10Z', 'clock'], // 22 min depois do apito informado pelo fornecedor
      ['2026-10-22T01:18:10Z', 'clock'], // 45+3 → 47 min
      ['2026-10-22T01:33:20Z', 'clock'], // primeiro minuto do 2º tempo (observado no log)
      ['2026-10-22T01:47:20Z', 'clock'],
    ]);
    expect(t.markers.map((m) => [m.kind, m.occurred_at, m.occurred_at_source])).toEqual([
      ['kickoff', '2026-10-22T00:31:10Z', 'provider'],
      ['halftime', '2026-10-22T01:18:05Z', 'observed'],
      ['second_half', '2026-10-22T01:33:20Z', 'observed'],
    ]);
  });

  it('não toma a primeira observação no meio do jogo como início do período', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        status: 'live',
        statusDetail: '2H',
        clock: { minute: 70, extra: null },
        startsAt: new Date('2026-10-22T00:30:00Z'),
        // o poller só começou no 2º tempo: starting → 2H não é o início do 2º tempo
        stateLog: [
          {
            from: 'starting',
            to: 'live',
            reason: 'provider',
            statusDetail: '2H',
            at: new Date('2026-10-22T01:55:00Z'),
          },
        ],
        incidents: [
          inc({
            type: 'card',
            detail: 'Yellow Card',
            minute: 72,
            team: PAL,
            observedAt: new Date('2026-10-22T01:58:30Z'),
          }),
        ],
      }),
    );
    expect(t.incidents[0]).toMatchObject({
      occurred_at: '2026-10-22T01:58:30Z',
      occurred_at_source: 'observed',
    });
    expect(t.markers.find((m) => m.kind === 'second_half')?.occurred_at).toBeNull();
  });

  it('não mostra marcos nem relógio para o "ao vivo" inferido pelo horário, sem dado do fornecedor', () => {
    const t = buildTimelineDto(
      input({
        status: 'live',
        statusDetail: 'NS',
        clock: { minute: null, extra: null },
        isStale: true,
        stateLog: [
          { from: 'starting', to: 'live', reason: 'temporal_fallback', statusDetail: 'NS', at: new Date() },
        ],
      }),
    );
    expect(t.markers).toEqual([]);
    expect(t.clock).toBeNull();
    expect(t.live).toBe(true);
    expect(t.data_freshness.is_stale).toBe(true);
  });

  it('handebol: marcos com tempos de 30 minutos e prorrogação de 2 × 5', () => {
    const t = buildTimelineDto(
      input({
        sport: 'handball',
        statusDetail: 'AET',
        score: { home: 33, away: 31, extratime: { home: 6, away: 4 } },
        incidents: [],
      }),
    );
    expect(t.markers.map((m) => [m.kind, m.clock.minute])).toEqual([
      ['kickoff', 0],
      ['halftime', 30],
      ['second_half', 31],
      ['end_of_regulation', 60],
      ['extra_time', 61],
      ['full_time', 70],
    ]);
  });

  it('fora do futebol não inventa apito, intervalo e 90 minutos', () => {
    const basketball = { statusDetail: 'FT', score: { home: 86, away: 73 } };
    expect(buildTimelineDto(input(basketball)).markers.map((m) => m.kind)).toContain('full_time');
    const t = buildTimelineDto(input({ ...basketball, sport: 'basketball' }));
    expect(t.markers).toEqual([]);
    expect(t.score).toEqual({ home: 86, away: 73 });
  });

  it('conta a prorrogação quando há lance nela', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        statusDetail: 'AET',
        score: { home: 1, away: 0 },
        incidents: [inc({ type: 'goal', detail: 'Normal Goal', minute: 112, team: PAL })],
      }),
    );
    expect(t.incidents[0]?.clock.period).toBe('extra_time_second');
    expect(t.incidents[0]?.flags).toContain('decisive');
    expect(t.markers.map((m) => m.kind)).toEqual([
      'kickoff',
      'halftime',
      'second_half',
      'end_of_regulation',
      'extra_time',
      'full_time',
    ]);
  });
});

describe('periodOf e uuidv7Time', () => {
  it('usa o minuto do fornecedor e o comentário da disputa', () => {
    expect(periodOf({ minute: 45, comments: null })).toBe('first_half');
    expect(periodOf({ minute: 90, comments: null })).toBe('second_half');
    expect(periodOf({ minute: 101, comments: null })).toBe('extra_time_first');
    expect(periodOf({ minute: 91, comments: 'Penalty Shootout' })).toBe('penalty_shootout');
  });

  it('lê o instante do UUIDv7', () => {
    expect(uuidv7Time('01a163b8-7ca2-71e8-a92e-8dc201d5d83a')?.toISOString()).toBe(
      '2026-10-22T13:06:37.346Z',
    );
    expect(uuidv7Time('3b241101-e2bb-4255-8caf-4136c566a962')).toBeNull();
  });
});

describe('timezoneOf', () => {
  it('resolve o fuso pelo país e, nos países com vários fusos, pela cidade', () => {
    expect(timezoneOf('BR', 'Sao Paulo')).toBe('America/Sao_Paulo');
    expect(timezoneOf('BR', 'Manaus')).toBe('America/Manaus');
    expect(timezoneOf('BR', 'Cuiabá')).toBe('America/Cuiaba');
    expect(timezoneOf('MX', 'Tijuana')).toBe('America/Tijuana');
    expect(timezoneOf('GB-ENG', 'London')).toBe('Europe/London');
    expect(timezoneOf('US', 'Somewhere')).toBeNull();
    expect(timezoneOf(null)).toBeNull();
  });

  it('usa o primeiro país conhecido e ignora WORLD', () => {
    expect(venueTimezone([null, 'AR', 'WORLD'], 'Avellaneda')).toBe('America/Argentina/Buenos_Aires');
    expect(venueTimezone([null, null, 'WORLD'], 'X')).toBeNull();
  });
});
