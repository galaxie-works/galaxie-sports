import { describe, expect, it } from 'vitest';
import {
  buildTimelineDto,
  INFERRED_SEQUENCE_BASE,
  periodOf,
  uuidv7Time,
  type RawIncident,
  type TimelineInput,
} from './timeline.js';
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

  describe('gol contra', () => {
    /** Fixture 1492407 do fornecedor: Palmeiras 4 × 1, com gol contra do zagueiro visitante aos 45+2. */
    const derby = (ownGoalTeam: typeof PAL, score: TimelineInput['score']) => {
      seq = 0;
      return input({
        score,
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 12, team: PAL }),
          inc({ type: 'own_goal', detail: 'Own Goal', minute: 45, extra: 2, team: ownGoalTeam }),
          inc({ type: 'goal', detail: 'Penalty', minute: 77, team: PAL }),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 81, team: FLU }),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 90, extra: 4, team: PAL }),
        ],
      });
    };
    const scores = (t: ReturnType<typeof buildTimelineDto>) =>
      t.incidents.map((i) => [i.kind, i.score_after?.home, i.score_after?.away]);
    const expected = [
      ['goal', 1, 0],
      ['own_goal', 2, 0],
      ['penalty_goal', 3, 0],
      ['goal', 3, 1],
      ['goal', 4, 1],
    ];

    it('time do jogador no incidente (fixture sintético 1492407): soma para o adversário, pelo placar final', () => {
      const t = buildTimelineDto(derby(FLU, { home: 4, away: 1 }));
      expect(scores(t)).toEqual(expected);
      // `team` continua o do lance; o gol contra amplia (não empata), é do Palmeiras e, 2º gol do vencedor
      // num 4–1, o decisivo
      expect(t.incidents[1]).toMatchObject({
        team: { side: 'away' },
        scoring_team: { id: 'pal', side: 'home' },
        flags: ['decisive'],
      });
      expect(t.incidents[0]?.flags).toEqual(['opener', 'go_ahead']);
      expect(t.incidents.map((i) => i.scoring_team?.side)).toEqual(['home', 'home', 'home', 'away', 'home']);
    });

    it('time beneficiado no incidente (docs/05) quando é ele que fecha o placar', () => {
      const t = buildTimelineDto(derby(PAL, { home: 4, away: 1 }));
      expect(scores(t)).toEqual(expected);
      expect(t.incidents[1]).toMatchObject({ team: { side: 'home' }, scoring_team: { side: 'home' } });
    });

    it('encerrado com lance faltando, nas duas convenções: a que não passa do placar', () => {
      expect(scores(buildTimelineDto(derby(FLU, { home: 5, away: 1 })))).toEqual(expected);
      expect(scores(buildTimelineDto(derby(PAL, { home: 5, away: 1 })))).toEqual(expected);
    });

    it('no ao vivo o lado do gol contra não troca entre leituras: vale o padrão até o placar final', () => {
      const sideAt = (incidents: RawIncident[], score: { home: number; away: number }, status = 'live') =>
        buildTimelineDto(
          input({
            status: status as TimelineInput['status'],
            statusDetail: status === 'live' ? '2H' : 'FT',
            score,
            incidents,
          }),
        ).incidents[0]?.scoring_team?.side;
      // jogador no incidente (gol contra do zagueiro do Fluminense): 1–0; o Fluminense empata e o placar
      // chega a 1–1 antes do lance; depois o lance chega. O 1–0 parcial "provaria" a convenção do jogador,
      // mas o 1–1 sem o lance a desfaria: no ao vivo fica o padrão nas três leituras
      seq = 0;
      const og = inc({ type: 'own_goal', detail: 'Own Goal', minute: 20, team: FLU });
      const equalizer = inc({ type: 'goal', detail: 'Normal Goal', minute: 60, team: FLU });
      expect([
        sideAt([og], { home: 1, away: 0 }),
        sideAt([og], { home: 1, away: 1 }),
        sideAt([og, equalizer], { home: 1, away: 1 }),
      ]).toEqual(['away', 'away', 'away']);
      // encerrado, o placar final decide uma vez: 1–1 só fecha com o gol contra para o Palmeiras
      expect(sideAt([og, equalizer], { home: 1, away: 1 }, 'finished')).toBe('home');
      // beneficiado no incidente: 1–0, 2–0 com o lance do 2º ainda por chegar, depois ele chega
      seq = 0;
      const og2 = inc({ type: 'own_goal', detail: 'Own Goal', minute: 20, team: PAL });
      const second = inc({ type: 'goal', detail: 'Normal Goal', minute: 50, team: PAL });
      expect([
        sideAt([og2], { home: 1, away: 0 }),
        sideAt([og2], { home: 2, away: 0 }),
        sideAt([og2, second], { home: 2, away: 0 }),
        sideAt([og2, second], { home: 2, away: 0 }, 'finished'),
      ]).toEqual(['home', 'home', 'home', 'home']);
    });

    it('sem como decidir, vale o time do incidente como beneficiado (padrão de docs/05 e do main)', () => {
      seq = 0;
      // encerrado 1–1 com só o gol contra listado: as duas convenções ficam abaixo do placar
      const t = buildTimelineDto(
        input({
          score: { home: 1, away: 1 },
          incidents: [inc({ type: 'own_goal', detail: 'Own Goal', minute: 30, team: FLU })],
        }),
      );
      expect(t.incidents[0]).toMatchObject({
        score_after: { home: 0, away: 1 },
        scoring_team: { side: 'away' },
      });
      // placar desconhecido: idem
      const unknown = input({
        score: { home: null, away: null },
        incidents: [inc({ type: 'own_goal', team: FLU })],
      });
      expect(buildTimelineDto(unknown).incidents[0]?.scoring_team?.side).toBe('away');
    });

    it('gol contra decisivo leva a bandeira do lado beneficiado; a cobrança convertida, de quem bateu', () => {
      seq = 0;
      const t = buildTimelineDto(
        input({
          score: { home: 0, away: 1 },
          incidents: [inc({ type: 'own_goal', detail: 'Own Goal', minute: 70, team: PAL })],
          teams: [PAL, FLU],
        }),
      );
      expect(t.incidents[0]).toMatchObject({
        score_after: { home: 0, away: 1 },
        scoring_team: FLU,
        flags: ['opener', 'go_ahead', 'decisive'],
        weight: 100,
      });
      const shootout = buildTimelineDto(semifinal()).incidents.filter(
        (i) => i.clock.period === 'penalty_shootout',
      );
      expect(shootout.map((i) => i.scoring_team?.side ?? null)).toEqual([
        'home',
        'away',
        'home',
        'away',
        'home',
        'away',
        'home',
        null,
        'home',
      ]);
    });
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

  it('handebol decidido nos pênaltis (AP, jogo 175399): fim do tempo regulamentar e pênaltis, sem prorrogação', () => {
    const t = buildTimelineDto(
      input({
        sport: 'handball',
        statusDetail: 'AP',
        clock: null,
        score: { home: 24, away: 26, extratime: null },
        incidents: [],
      }),
    );
    expect(t.markers.map((m) => [m.kind, m.clock.minute])).toEqual([
      ['kickoff', 0],
      ['halftime', 30],
      ['second_half', 31],
      ['end_of_regulation', 60],
      ['penalty_shootout', null],
      ['full_time', 60],
    ]);
    expect(t.clock?.period).toBe('penalty_shootout');
    // disputa em andamento (PT), observada a partir do intervalo
    const live = buildTimelineDto(
      input({
        sport: 'handball',
        status: 'live',
        statusDetail: 'PT',
        clock: null,
        score: { home: 24, away: 24, extratime: null },
        stateLog: [
          {
            from: 'break',
            to: 'live',
            reason: 'provider',
            statusDetail: 'PT',
            at: new Date('2024-05-12T18:40:00Z'),
          },
        ],
      }),
    );
    expect(live.clock?.period).toBe('penalty_shootout');
    expect(live.markers.map((m) => m.kind)).toEqual([
      'kickoff',
      'halftime',
      'second_half',
      'end_of_regulation',
      'penalty_shootout',
    ]);
    expect(live.markers.at(-1)?.occurred_at).toBe('2024-05-12T18:40:00Z');
  });

  it('fora do futebol não inventa apito, intervalo e 90 minutos', () => {
    const basketball = { statusDetail: 'FT', score: { home: 86, away: 73 } };
    expect(buildTimelineDto(input(basketball)).markers.map((m) => m.kind)).toContain('full_time');
    const t = buildTimelineDto(input({ ...basketball, sport: 'basketball' }));
    expect(t.markers).toEqual([]);
    expect(t.score).toEqual({ home: 86, away: 73 });
    expect(buildTimelineDto(input({ ...basketball, sport: 'american-football' })).markers).toEqual([]);
  });

  it('rúgbi: tempos de 40 minutos e prorrogação de 2 × 10', () => {
    const t = buildTimelineDto(
      input({
        sport: 'rugby',
        statusDetail: 'AET',
        score: { home: 25, away: 19, extratime: { home: 6, away: 0 } },
        incidents: [],
      }),
    );
    expect(t.markers.map((m) => [m.kind, m.clock.minute])).toEqual([
      ['kickoff', 0],
      ['halftime', 40],
      ['second_half', 41],
      ['end_of_regulation', 80],
      ['extra_time', 81],
      ['full_time', 100],
    ]);
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

describe('gol anulado inferido (a fonte apagou o gol sem mandar o VAR)', () => {
  it('fica no minuto do gol, como VAR de gol anulado e momento-chave, sem mexer no placar', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        status: 'live',
        statusDetail: '2H',
        clock: { minute: 66, extra: null },
        score: { home: 0, away: 0 },
        incidents: [
          inc({ type: 'card', detail: 'Yellow Card', minute: 61, team: PAL, player: person('newton') }),
          inc({ type: 'subst', detail: 'Substitution 1', minute: 62, team: FLU, player: person('a') }),
          inc({ type: 'subst', detail: 'Substitution 2', minute: 62, team: FLU, player: person('b') }),
          inc({ type: 'card', detail: 'Yellow Card', minute: 70, team: PAL, player: person('x') }),
          inc({
            sequence: INFERRED_SEQUENCE_BASE,
            type: 'var',
            detail: 'Goal cancelled',
            minute: 62,
            team: FLU,
            player: person('bidu', 'Matheus Bidu'),
          }),
        ],
      }),
    );
    expect(t.incidents.map((i) => [i.clock.display, i.kind])).toEqual([
      ["61'", 'yellow_card'],
      ["62'", 'substitution'],
      ["62'", 'substitution'],
      ["62'", 'var'],
      ["70'", 'yellow_card'],
    ]);
    const cancelled = t.incidents[3]!;
    expect(cancelled).toMatchObject({ detail: 'Goal cancelled', key_moment: true, score_after: null });
    expect(cancelled.player?.name).toBe('Matheus Bidu');
  });
});

describe('gol anulado que fica na timeline junto com o VAR (#639)', () => {
  /** Formato da api-sports: o `Goal` continua e entra um `Var` do mesmo time com o veredito em `detail`. */
  const game = (
    score: TimelineInput['score'],
    extra: RawIncident[] = [],
    status: Partial<TimelineInput> = {},
  ) => {
    seq = 0;
    return input({
      score,
      incidents: [
        inc({ type: 'goal', detail: 'Normal Goal', minute: 20, team: PAL, player: person('vitor') }),
        inc({ type: 'goal', detail: 'Normal Goal', minute: 62, team: FLU, player: person('bidu') }),
        inc({ type: 'subst', detail: 'Substitution 1', minute: 63, team: PAL, player: person('a') }),
        inc({
          type: 'var',
          detail: 'Goal Disallowed - offside',
          minute: 64,
          team: FLU,
          player: person('bidu'),
        }),
        ...extra,
      ],
      ...status,
    });
  };

  it('o gol anulado não soma, perde as bandeiras e aponta o VAR; o último placar bate com o do jogo', () => {
    const t = buildTimelineDto(
      game({ home: 2, away: 0 }, [
        inc({ type: 'goal', detail: 'Normal Goal', minute: 80, team: PAL, player: person('vitor') }),
      ]),
    );
    const [g1, cancelled, , varCall, g2] = t.incidents;
    expect(g1).toMatchObject({
      score_after: { home: 1, away: 0 },
      flags: ['opener', 'go_ahead', 'decisive'],
    });
    expect(cancelled).toMatchObject({
      kind: 'goal',
      score_after: null,
      scoring_team: null,
      flags: [],
      disallowed: true,
      cancelled_by: varCall!.sequence,
      key_moment: false,
    });
    expect(varCall).toMatchObject({
      kind: 'var',
      weight: 65,
      key_moment: true,
      disallowed: false,
      cancelled_by: null,
    });
    // sem o gol anulado, o placar parcial fecha no do jogo (e o 1º gol segue como o decisivo)
    expect(g2).toMatchObject({ score_after: { home: 2, away: 0 }, flags: [] });
    expect(t.incidents.filter((i) => i.score_after).at(-1)?.score_after).toEqual(t.score);
  });

  it('aceita "Goal cancelled" e o VAR antes do gol, e pareia pelo jogador quando o time marcou duas vezes', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        score: { home: 1, away: 0 },
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 30, team: PAL, player: person('a') }),
          inc({ type: 'var', detail: 'Goal cancelled', minute: 33, team: PAL, player: person('b') }),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 33, team: PAL, player: person('b') }),
        ],
      }),
    );
    expect(t.incidents.map((i) => [i.player?.id, i.score_after, i.cancelled_by])).toEqual([
      ['a', { home: 1, away: 0 }, null],
      ['b', null, null],
      ['b', null, 1],
    ]);
  });

  it('VAR de gol que já saiu da timeline não derruba o gol válido de minutos antes', () => {
    // o gol dos 62' foi apagado pela fonte; ficou o VAR, e o gol dos 60' segue valendo no placar 1 x 1
    seq = 0;
    const t = buildTimelineDto(
      input({
        score: { home: 1, away: 1 },
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 20, team: PAL }),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 60, team: FLU, player: person('x') }),
          inc({ type: 'var', detail: 'Goal cancelled', minute: 63, team: FLU, player: person('y') }),
        ],
      }),
    );
    expect(t.incidents[1]).toMatchObject({ score_after: { home: 1, away: 1 }, flags: ['equalizer'] });
    expect(t.incidents[1]?.cancelled_by).toBeNull();
  });

  it('no ao vivo, espera o placar cair para anular; "Goal confirmed" e VAR de outro time não anulam', () => {
    const live = { status: 'live' as const, statusDetail: '2H', clock: { minute: 65, extra: null } };
    // o placar ainda tem o gol: o gol segue valendo nesta leitura
    expect(buildTimelineDto(game({ home: 1, away: 1 }, [], live)).incidents[1]?.cancelled_by).toBeNull();
    // o placar caiu: o gol cai junto
    expect(buildTimelineDto(game({ home: 1, away: 0 }, [], live)).incidents[1]?.cancelled_by).toBe(3);

    seq = 0;
    const t = buildTimelineDto(
      input({
        score: { home: 1, away: 0 },
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 50, team: PAL }),
          inc({ type: 'var', detail: 'Goal confirmed', minute: 51, team: PAL }),
          inc({ type: 'var', detail: 'Goal cancelled', minute: 51, team: FLU }),
        ],
      }),
    );
    expect(t.incidents[0]).toMatchObject({ score_after: { home: 1, away: 0 }, cancelled_by: null });
  });

  it('sem placar conhecido, o par basta', () => {
    const t = buildTimelineDto(game({ home: null, away: null }));
    expect(t.incidents[1]).toMatchObject({ cancelled_by: 3, score_after: null });
  });

  it('gol contra no time do jogador: a convenção sai do placar sem o gol anulado', () => {
    seq = 0;
    // 1 x 0: gol contra de jogador do visitante (time do lance = visitante) e gol do mandante anulado
    const og = (team: typeof PAL) =>
      inc({ type: 'own_goal', detail: 'Own Goal', minute: 20, team, player: person('z') });
    const t = buildTimelineDto(
      input({
        score: { home: 1, away: 0 },
        incidents: [
          og(FLU),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 50, team: PAL, player: person('p') }),
          inc({ type: 'var', detail: 'Goal cancelled', minute: 52, team: PAL, player: person('p') }),
        ],
      }),
    );
    expect(t.incidents.map((i) => [i.scoring_team?.side ?? null, i.score_after, i.disallowed])).toEqual([
      ['home', { home: 1, away: 0 }, false],
      [null, null, true],
      [null, null, false],
    ]);
  });

  it('VAR com autor que não marcou na janela não derruba o gol de outro jogador', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        status: 'live',
        statusDetail: '2H',
        score: { home: 1, away: 0 },
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 30, team: PAL, player: person('valido') }),
          inc({ type: 'var', detail: 'Goal cancelled', minute: 33, team: PAL, player: person('anulado') }),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 35, team: PAL, player: person('novo') }),
        ],
      }),
    );
    expect(t.incidents.map((i) => i.disallowed)).toEqual([false, false, false]);
    expect(t.incidents[0]?.flags).toEqual(['opener', 'go_ahead']);
  });
});

describe('vereditos do VAR (#641)', () => {
  it('cada detail visto no raw tem veredito canônico e peso; texto novo vira other', () => {
    const details: [string | null, string, number][] = [
      ['Goal cancelled', 'goal_cancelled', 65],
      ['Goal Disallowed', 'goal_cancelled', 65],
      ['Goal Disallowed - video review', 'goal_cancelled', 65],
      ['Goal Disallowed - offside', 'goal_disallowed_offside', 65],
      ['Goal Disallowed - Foul', 'goal_disallowed_foul', 65],
      ['Goal Disallowed - handball', 'goal_disallowed_handball', 65],
      ['Goal confirmed', 'goal_confirmed', 65],
      ['Goal Under Review - offside', 'goal_under_review', 50],
      ['Penalty awarded', 'penalty_awarded', 65],
      ['Penalty confirmed', 'penalty_confirmed', 65],
      ['Penalty cancelled', 'penalty_cancelled', 65],
      ['Card upgrade', 'card_upgrade', 65],
      ['Card upgrade confirmed', 'card_upgrade_confirmed', 65],
      ['Card upgrade cancelled', 'card_upgrade_cancelled', 40],
      ['Card reviewed', 'card_reviewed', 40],
      ['Red card confirmed', 'red_card_confirmed', 45],
      ['Red card cancelled', 'red_card_cancelled', 65],
      ['Original decision changed', 'decision_changed', 50],
      [null, 'other', 40],
      ['Something new', 'other', 40],
    ];
    seq = 0;
    const t = buildTimelineDto(
      input({ incidents: details.map(([detail]) => inc({ type: 'var', detail, minute: 10, team: PAL })) }),
    );
    expect(t.incidents.map((i) => [i.detail, i.var_outcome, i.weight])).toEqual(details);
    expect(t.incidents.filter((i) => i.key_moment)).toHaveLength(13);
  });

  it('lances fora do VAR ficam sem veredito', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({ incidents: [inc({ type: 'goal', detail: 'Normal Goal', minute: 5, team: PAL })] }),
    );
    expect(t.incidents[0]?.var_outcome).toBeNull();
  });
});

describe('VAR inferido e VAR do fornecedor no mesmo jogo (#639, revisão)', () => {
  it('o VAR inferido não derruba gol que ficou; o do fornecedor derruba o gol certo', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        score: { home: 0, away: 1 },
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 60, team: FLU, player: person('a') }),
          inc({ type: 'goal', detail: 'Normal Goal', minute: 64, team: FLU, player: person('b') }),
          inc({ type: 'var', detail: 'Goal cancelled', minute: 65, team: FLU, player: person('b') }),
          inc({
            sequence: INFERRED_SEQUENCE_BASE,
            type: 'var',
            detail: 'Goal cancelled',
            minute: 62,
            team: FLU,
          }),
        ],
      }),
    );
    const byPlayer = Object.fromEntries(
      t.incidents.filter((i) => i.kind === 'goal').map((i) => [i.player?.id, i.disallowed]),
    );
    expect(byPlayer).toEqual({ a: false, b: true });
  });
});

describe('VAR de gol anulado com texto novo (#641, revisão)', () => {
  it('texto ainda sem veredito próprio derruba o gol pela regra de prefixo', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        score: { home: 0, away: 0 },
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 70, team: PAL, player: person('x') }),
          inc({
            type: 'var',
            detail: 'Goal Disallowed - Unknown reason',
            minute: 71,
            team: PAL,
            player: person('x'),
          }),
        ],
      }),
    );
    expect(t.incidents[0]).toMatchObject({ disallowed: true, score_after: null });
    expect(t.incidents[1]).toMatchObject({ var_outcome: 'other' });
  });
});
