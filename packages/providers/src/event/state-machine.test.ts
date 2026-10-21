import { describe, expect, it } from 'vitest';
import {
  applyObservation,
  effectiveStatus,
  initialState,
  sameState,
  tick,
  type EventState,
  type FailureReason,
  type ValidObservation,
} from './state-machine.js';
import { EVENT_STATUSES, expectedEnd, type EventStatus } from './status.js';

const KICKOFF = new Date('2026-10-21T22:00:00Z');
const END = expectedEnd({ sport: 'football', startsAt: KICKOFF });
const at = (minutesFromKickoff: number) => new Date(KICKOFF.getTime() + minutesFromKickoff * 60_000);

function obs(
  status: EventStatus | null,
  minute: number,
  overrides: Partial<ValidObservation> = {},
): ValidObservation {
  return {
    kind: 'valid',
    observedAt: at(minute),
    status,
    statusDetail: status === 'finished' ? 'FT' : status === 'live' ? '2H' : status === 'break' ? 'HT' : 'NS',
    clock: { minute: minute > 0 ? Math.min(minute, 90) : null, extra: null, period: null },
    score: { home: 1, away: 0 },
    startsAt: KICKOFF,
    endsAtExpected: END,
    ...overrides,
  };
}

function state(status: EventStatus, overrides: Partial<EventState> = {}): EventState {
  return {
    status,
    statusDetail: null,
    statusSource: 'provider',
    clock: null,
    score: null,
    startsAt: KICKOFF,
    endsAtExpected: END,
    lastValidAt: at(-60),
    isStale: false,
    ...overrides,
  };
}

describe('expectedEnd', () => {
  it('futebol: início + 115 min; prorrogação estende; início real atrasado desloca', () => {
    expect(END.toISOString()).toBe('2026-10-21T23:55:00.000Z');
    expect(expectedEnd({ sport: 'football', startsAt: KICKOFF, extraTime: true }).toISOString()).toBe(
      '2026-10-22T00:40:00.000Z',
    );
    expect(expectedEnd({ sport: 'football', startsAt: KICKOFF, actualStartAt: at(20) }).toISOString()).toBe(
      '2026-10-22T00:15:00.000Z',
    );
    expect(expectedEnd({ sport: 'football', startsAt: KICKOFF, actualStartAt: at(-5) })).toEqual(END);
    expect(expectedEnd({ sport: 'curling', startsAt: KICKOFF }).getTime() - KICKOFF.getTime()).toBe(
      180 * 60_000,
    );
  });
});

describe('initialState', () => {
  it('pré-jogo vira scheduled antes de T-10 e starting a partir de T-10', () => {
    expect(initialState(obs('scheduled', -60)).state.status).toBe('scheduled');
    expect(initialState(obs('scheduled', -10)).state.status).toBe('starting');
    expect(initialState(obs('scheduled', 5)).state.status).toBe('starting');
  });

  it('registra a criação como transição do fornecedor e guarda last_valid_at', () => {
    const r = initialState(obs('live', 30));
    expect(r.state).toMatchObject({ status: 'live', statusSource: 'provider', isStale: false });
    expect(r.state.lastValidAt).toEqual(at(30));
    expect(r.transitions).toEqual([
      { from: null, to: 'live', reason: 'provider', at: at(30), statusDetail: '2H' },
    ]);
  });

  it('código desconhecido cria o evento pelo horário (fonte temporal)', () => {
    const r = initialState(obs(null, -120, { statusDetail: 'XYZ' }));
    expect(r.state).toMatchObject({ status: 'scheduled', statusSource: 'temporal' });
    expect(r.transitions[0]?.reason).toBe('temporal');
  });
});

describe('applyObservation — dado válido do fornecedor', () => {
  const cases: [EventStatus, ValidObservation, EventStatus, string][] = [
    ['scheduled', obs('live', 1), 'live', 'provider'],
    ['starting', obs('live', 1), 'live', 'provider'],
    ['live', obs('break', 46), 'break', 'provider'],
    ['break', obs('live', 47), 'live', 'provider'],
    ['live', obs('finished', 100), 'finished', 'provider'],
    ['live', obs('suspended', 60), 'suspended', 'provider'],
    ['suspended', obs('live', 70), 'live', 'provider'],
    ['suspended', obs('abandoned', 90), 'abandoned', 'provider'],
    ['scheduled', obs('postponed', -30), 'postponed', 'provider'],
    ['scheduled', obs('cancelled', -30), 'cancelled', 'provider'],
    ['finished', obs('live', 95), 'live', 'correction'],
    ['finished', obs('break', 95), 'break', 'correction'],
  ];
  it.each(cases)('%s → %s', (from, o, to, reason) => {
    const r = applyObservation(state(from), o);
    expect(r.ignored).toBeUndefined();
    expect(r.state.status).toBe(to);
    expect(r.transitions).toEqual([{ from, to, reason, at: o.observedAt, statusDetail: o.statusDetail }]);
    expect(r.state).toMatchObject({ statusSource: 'provider', isStale: false, lastValidAt: o.observedAt });
  });

  it('mesmo estado: atualiza placar/relógio sem registrar transição', () => {
    const r = applyObservation(state('live'), obs('live', 60, { score: { home: 2, away: 0 } }));
    expect(r.transitions).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.state.score).toEqual({ home: 2, away: 0 });
  });

  it('reaplicar a mesma observação é idempotente', () => {
    const first = applyObservation(state('scheduled'), obs('live', 10));
    const second = applyObservation(first.state, obs('live', 10));
    expect(second.changed).toBe(false);
    expect(second.transitions).toEqual([]);
    expect(sameState(first.state, second.state)).toBe(true);
  });

  it('reaplicar a observação antiga não desfaz a inferência temporal posterior', () => {
    const created = initialState(obs('scheduled', -120));
    const ticked = tick(created.state, at(200));
    expect(ticked.state.status).toBe('finished');
    const again = applyObservation(ticked.state, obs('scheduled', -120));
    expect(again).toMatchObject({ ignored: 'out_of_order', changed: false });
    expect(again.state.status).toBe('finished');
  });

  it('observação mais antiga que a última válida é descartada (out_of_order)', () => {
    const prev = state('live', { lastValidAt: at(50) });
    const r = applyObservation(prev, obs('scheduled', -30));
    expect(r).toMatchObject({ ignored: 'out_of_order', changed: false, transitions: [] });
    expect(r.state).toBe(prev);
  });

  it('código desconhecido é descartado sem mexer no estado', () => {
    const prev = state('live');
    expect(applyObservation(prev, obs(null, 30))).toMatchObject({
      ignored: 'unknown_status',
      changed: false,
    });
  });

  it.each(['live', 'break', 'suspended', 'finished'] as const)(
    'nunca regride %s (do fornecedor) ao pré-jogo com o mesmo horário',
    (from) => {
      const r = applyObservation(state(from), obs('scheduled', 30));
      expect(r).toMatchObject({ ignored: 'invalid_regression', changed: false });
      expect(r.state.status).toBe(from);
    },
  );

  it('remarcação (novo horário) permite voltar ao pré-jogo', () => {
    const newKickoff = new Date(KICKOFF.getTime() + 24 * 3_600_000);
    const r = applyObservation(
      state('suspended'),
      obs('scheduled', 60, {
        startsAt: newKickoff,
        endsAtExpected: expectedEnd({ sport: 'football', startsAt: newKickoff }),
      }),
    );
    expect(r.state.status).toBe('scheduled');
    expect(r.state.startsAt).toEqual(newKickoff);
    expect(r.transitions[0]?.reason).toBe('provider');
  });

  it('estado inferido pelo horário é corrigido pela fonte (atraso no início)', () => {
    const prev = state('live', { statusSource: 'temporal', isStale: true });
    const r = applyObservation(prev, obs('scheduled', 5));
    expect(r.state).toMatchObject({ status: 'starting', statusSource: 'provider', isStale: false });
    expect(r.transitions[0]).toMatchObject({ from: 'live', to: 'starting', reason: 'correction' });
  });

  it('finished por fallback temporal volta a live quando a fonte normaliza (prorrogação)', () => {
    const prev = state('finished', { statusSource: 'temporal', isStale: true });
    const r = applyObservation(prev, obs('live', 125, { statusDetail: 'ET' }));
    expect(r.state).toMatchObject({ status: 'live', statusDetail: 'ET', isStale: false });
    expect(r.transitions[0]).toMatchObject({ from: 'finished', to: 'live', reason: 'correction' });
  });

  it('starting segue em starting com NS fresco depois de T-10 (sem transição)', () => {
    const r = applyObservation(state('starting'), obs('scheduled', -2));
    expect(r.state.status).toBe('starting');
    expect(r.transitions).toEqual([]);
  });
});

describe('applyObservation — falha da fonte (last-known-good)', () => {
  const reasons: FailureReason[] = ['http_error', 'timeout', 'empty_payload', 'missing_event', 'quota'];

  it.each(reasons)('%s mantém o último estado válido e marca is_stale', (reason) => {
    const prev = state('live', { score: { home: 2, away: 1 }, lastValidAt: at(40) });
    const r = applyObservation(prev, { kind: 'failure', observedAt: at(42), reason });
    expect(r.state).toMatchObject({ status: 'live', score: { home: 2, away: 1 }, isStale: true });
    expect(r.state.lastValidAt).toEqual(at(40));
    expect(r.transitions).toEqual([]);
    expect(r.changed).toBe(true);
  });

  it('falha repetida não muda nada', () => {
    const prev = state('live', { isStale: true, lastValidAt: at(40) });
    const r = applyObservation(prev, { kind: 'failure', observedAt: at(41), reason: 'http_error' });
    expect(r.changed).toBe(false);
  });

  it('com a fonte fora, o ciclo temporal continua (falha 5xx no apito → live)', () => {
    const prev = state('starting', { lastValidAt: at(-30) });
    const r = applyObservation(prev, { kind: 'failure', observedAt: at(1), reason: 'http_error' });
    expect(r.state).toMatchObject({ status: 'live', statusSource: 'temporal', isStale: true });
    expect(r.transitions).toEqual([
      { from: 'starting', to: 'live', reason: 'temporal_fallback', at: KICKOFF, statusDetail: null },
    ]);
  });

  it('payload vazio depois do fim previsto → finished por fallback', () => {
    const prev = state('live', { lastValidAt: at(80) });
    const r = applyObservation(prev, { kind: 'failure', observedAt: at(130), reason: 'empty_payload' });
    expect(r.state).toMatchObject({ status: 'finished', statusSource: 'temporal', isStale: true });
    expect(r.transitions[0]).toMatchObject({
      from: 'live',
      to: 'finished',
      reason: 'temporal_fallback',
      at: END,
    });
  });
});

describe('tick — passagem do tempo', () => {
  it('scheduled → starting em T-10, mesmo com fonte fresca', () => {
    const r = tick(state('scheduled', { lastValidAt: at(-12) }), at(-9));
    expect(r.state).toMatchObject({ status: 'starting', statusSource: 'temporal', isStale: false });
    expect(r.transitions).toEqual([
      { from: 'scheduled', to: 'starting', reason: 'temporal', at: at(-10), statusDetail: null },
    ]);
  });

  it('antes de T-10 não muda nada', () => {
    expect(tick(state('scheduled'), at(-11)).changed).toBe(false);
  });

  it('starting com NS fresco segura o início (atraso)', () => {
    const r = tick(state('starting', { lastValidAt: at(-1) }), at(3));
    expect(r.state.status).toBe('starting');
    expect(r.changed).toBe(false);
  });

  it('starting sem dado fresco vira live no apito', () => {
    const r = tick(state('starting', { lastValidAt: at(-30) }), at(1));
    expect(r.state).toMatchObject({ status: 'live', isStale: true });
  });

  it('evento nunca observado ao vivo percorre scheduled → starting → live → finished', () => {
    const r = tick(state('scheduled', { lastValidAt: at(-24 * 60) }), at(200));
    expect(r.state).toMatchObject({ status: 'finished', statusSource: 'temporal', isStale: true });
    expect(r.transitions.map((t) => [t.from, t.to, t.reason, t.at.toISOString()])).toEqual([
      ['scheduled', 'starting', 'temporal', at(-10).toISOString()],
      ['starting', 'live', 'temporal_fallback', KICKOFF.toISOString()],
      ['live', 'finished', 'temporal_fallback', END.toISOString()],
    ]);
  });

  it('live com dado fresco não termina por fallback, mesmo após o fim previsto', () => {
    const r = tick(state('live', { lastValidAt: at(118) }), at(120));
    expect(r.state.status).toBe('live');
  });

  it('break sem fonte termina em ends_at_expected', () => {
    expect(tick(state('break', { lastValidAt: at(45) }), at(116)).state.status).toBe('finished');
  });

  it('live sem fonte antes do fim previsto continua live', () => {
    expect(tick(state('live', { lastValidAt: at(10) }), at(100)).changed).toBe(false);
  });

  it.each(['finished', 'postponed', 'cancelled', 'abandoned', 'suspended'] as const)(
    '%s não avança pelo tempo',
    (s) => {
      expect(tick(state(s, { lastValidAt: at(-500) }), at(1000)).changed).toBe(false);
    },
  );

  it('respeita freshnessMs configurável', () => {
    const prev = state('starting', { lastValidAt: at(-1) });
    expect(tick(prev, at(3), { freshnessMs: 60_000 }).state.status).toBe('live');
  });
});

describe('invariantes', () => {
  it('nenhuma observação válida leva um evento já iniciado de volta ao pré-jogo sem remarcação', () => {
    for (const from of EVENT_STATUSES) {
      for (const to of EVENT_STATUSES) {
        const r = applyObservation(state(from), obs(to, 30));
        const regressed =
          ['live', 'break', 'suspended', 'finished'].includes(from) &&
          ['scheduled', 'starting'].includes(r.state.status);
        expect(regressed, `${from} → ${to}`).toBe(false);
      }
    }
  });

  it('effectiveStatus só reinterpreta o pré-jogo', () => {
    expect(effectiveStatus(obs('finished', 100))).toBe('finished');
    expect(effectiveStatus(obs('scheduled', -5))).toBe('starting');
    expect(effectiveStatus(obs(null, 0))).toBeNull();
  });
});
