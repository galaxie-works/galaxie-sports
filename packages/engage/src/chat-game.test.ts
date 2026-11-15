import { describe, expect, it } from 'vitest';
import {
  desiredGameMessages,
  gameKindEnabled,
  gameText,
  statusSignal,
  type TimelineIncident,
} from './chat-game.js';

const HOME = 'home-team';
const AWAY = 'away-team';
const sides = new Map([
  [HOME, 'home' as const],
  [AWAY, 'away' as const],
]);
let seq = 0;
const inc = (over: Partial<TimelineIncident>): TimelineIncident => ({
  sequence: seq++,
  minute: 10,
  extra: null,
  type: 'goal',
  detail: 'Normal Goal',
  participantId: HOME,
  personId: 'p1',
  shootout: false,
  ...over,
});

describe('desiredGameMessages', () => {
  it('gol, gol contra e vermelho entram; amarelo, substituição, pênalti perdido e disputa de pênaltis não', () => {
    const out = desiredGameMessages(
      [
        inc({ minute: 10 }),
        inc({ minute: 20, type: 'own_goal', detail: 'Own Goal', participantId: AWAY, personId: 'p2' }),
        inc({ minute: 30, type: 'penalty_missed', detail: 'Missed Penalty' }),
        inc({ minute: 31, type: 'card', detail: 'Yellow Card' }),
        inc({ minute: 40, type: 'card', detail: 'Red Card', participantId: AWAY, personId: 'p3' }),
        inc({ minute: 41, type: 'subst', detail: 'Substitution 1' }),
        inc({ minute: 120, type: 'goal', detail: 'Penalty', shootout: true }),
      ],
      sides,
    );
    expect(out.map((m) => m.kind)).toEqual(['goal', 'goal', 'red_card']);
    expect(out[0]!.score).toEqual({ home: 1, away: 0 });
    expect(out[1]).toMatchObject({ detail: 'Own Goal', score: { home: 1, away: 1 } });
  });

  it('a chave não depende da posição: lance atrasado no meio da lista não muda as chaves', () => {
    const goal = inc({ minute: 60, sequence: 5 });
    const before = desiredGameMessages([inc({ minute: 10, sequence: 4, type: 'subst' }), goal], sides);
    const after = desiredGameMessages(
      [
        inc({ minute: 10, sequence: 4, type: 'subst' }),
        inc({ minute: 30, sequence: 5, type: 'card', detail: 'Yellow Card' }),
        { ...goal, sequence: 6 },
      ],
      sides,
    );
    expect(after.map((m) => m.key)).toEqual(before.map((m) => m.key));
  });

  it('gol repetido pelo fornecedor (mesmo time e jogador, minuto vizinho) vira uma mensagem só', () => {
    const out = desiredGameMessages([inc({ minute: 44 }), inc({ minute: 45 })], sides);
    expect(out).toHaveLength(1);
  });

  it('VAR anula o último gol do mesmo time até 5 min antes; VAR inferido mais o do fornecedor viram um só', () => {
    const out = desiredGameMessages(
      [
        inc({ minute: 10, personId: 'early' }),
        inc({ minute: 50, personId: 'late' }),
        inc({ minute: 52, type: 'var', detail: 'Goal cancelled', personId: null, sequence: 100_001 }),
        inc({ minute: 53, type: 'var', detail: 'Goal cancelled', personId: null }),
      ],
      sides,
    );
    const goals = out.filter((m) => m.kind === 'goal');
    expect(goals.map((g) => [g.personId, g.cancelled])).toEqual([
      ['early', false],
      ['late', true],
    ]);
    expect(goals[0]!.score).toEqual({ home: 1, away: 0 });
    expect(out.filter((m) => m.kind === 'var')).toHaveLength(1);
  });

  it('VAR de outro time não anula; gol que já saiu da linha do tempo é anulado pelo VAR que chegou', () => {
    const other = desiredGameMessages(
      [inc({ minute: 50 }), inc({ minute: 51, type: 'var', detail: 'Goal cancelled', participantId: AWAY })],
      sides,
    );
    expect(other.find((m) => m.kind === 'goal')!.cancelled).toBe(false);
    const ghost = desiredGameMessages(
      [inc({ minute: 51, type: 'var', detail: 'Goal cancelled', sequence: 100_000 })],
      sides,
      [{ key: 'goal:home-team:p1:50', participantId: HOME, minute: 50, extra: null, cancelled: false }],
    );
    expect(ghost.find((m) => m.kind === 'goal')).toMatchObject({
      key: 'goal:home-team:p1:50',
      cancelled: true,
    });
  });

  it('gol que volta (o VAR inferido some) deixa de estar anulado', () => {
    const back = desiredGameMessages([inc({ minute: 50 })], sides);
    expect(back[0]!.cancelled).toBe(false);
  });
});

describe('statusSignal', () => {
  it('início, cada intervalo e fim pela troca de estado', () => {
    expect(statusSignal('live', 'scheduled')).toEqual({ kind: 'kickoff', key: 'status:kickoff' });
    expect(statusSignal('live', 'break')).toBeNull();
    expect(statusSignal('break', 'live')).toEqual({ kind: 'half_time', key: 'status:break' });
    expect(statusSignal('finished', 'live')).toEqual({ kind: 'full_time', key: 'status:finished' });
    expect(statusSignal('live', 'live')).toBeNull();
  });
});

describe('gameText', () => {
  const goal = {
    kind: 'goal' as const,
    minute: 23,
    extra: null,
    detail: 'Normal Goal',
    team: { name: 'Chapecoense' },
    player: 'Estêvão',
    score: { home: 1, away: 0 },
  };

  it('gol nos três idiomas, com time, autor e placar (sem "do/da" antes do time)', () => {
    expect(gameText(goal)).toEqual({
      'pt-BR': "23' ⚽ Gol: Chapecoense (Estêvão). 1-0",
      es: "23' ⚽ Gol: Chapecoense (Estêvão). 1-0",
      en: "23' ⚽ Goal: Chapecoense (Estêvão). 1-0",
    });
  });

  it('gol contra só com o autor; anulado mostra a anulação', () => {
    expect(gameText({ ...goal, detail: 'Own Goal' })['pt-BR']).toBe("23' ⚽ Gol contra (Estêvão). 1-0");
    expect(gameText({ ...goal, cancelled: true })['pt-BR']).toMatch(/Anulado pelo VAR\.$/);
  });

  it('VAR com a decisão do fornecedor; segundo amarelo explicado', () => {
    expect(gameText({ ...goal, kind: 'var', detail: 'Goal cancelled', player: null }).es).toBe(
      "23' 📺 VAR: gol anulado (Chapecoense).",
    );
    expect(gameText({ ...goal, kind: 'var', detail: 'Penalty confirmed', player: null }).en).toBe(
      "23' 📺 VAR: penalty confirmed (Chapecoense).",
    );
    expect(gameText({ ...goal, kind: 'red_card', secondYellow: true }).es).toBe(
      "23' 🟥 Segunda amarilla, expulsado (Estêvão).",
    );
  });

  it('espanhol neutro no intervalo; fim com placar', () => {
    expect(gameText({ ...goal, kind: 'half_time', minute: null }).es).toBe('Descanso. 1-0');
    expect(gameText({ ...goal, kind: 'full_time', minute: null, score: { home: 2, away: 1 } }).en).toBe(
      'Full time. 2-1',
    );
  });

  it('tipos ligados pelo cliente', () => {
    expect(gameKindEnabled(null, 'red_card')).toBe(true);
    expect(gameKindEnabled(['goal', 'var'], 'red_card')).toBe(false);
  });
});
