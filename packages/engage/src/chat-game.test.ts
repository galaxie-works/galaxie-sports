import { describe, expect, it } from 'vitest';
import { gameKindEnabled, gameSignals, gameText } from './chat-game.js';

const incident = (type: string, detail: string | null, id = 'i1') => ({
  topic: 'event.incident_added',
  data: {
    incidents: [
      { id, type, detail, minute: 23, extra: null, participant_id: 'p1', person_id: 'x1', sequence: 4 },
    ],
  },
});

describe('gameSignals', () => {
  it('gol, vermelho e VAR viram mensagem; amarelo, substituição e pênalti perdido não', () => {
    expect(gameSignals(incident('Goal', 'Normal Goal'))).toMatchObject([
      { kind: 'goal', sourceKey: 'incident:i1' },
    ]);
    expect(gameSignals(incident('Goal', 'Missed Penalty'))).toEqual([]);
    expect(gameSignals(incident('Card', 'Red Card'))).toMatchObject([{ kind: 'red_card' }]);
    expect(gameSignals(incident('Card', 'Second Yellow card'))).toMatchObject([{ kind: 'red_card' }]);
    expect(gameSignals(incident('Card', 'Yellow Card'))).toEqual([]);
    expect(gameSignals(incident('subst', 'Substitution 1'))).toEqual([]);
    expect(gameSignals(incident('Var', 'Goal cancelled'))).toMatchObject([
      { kind: 'var', cancelsGoal: true },
    ]);
    expect(gameSignals(incident('Var', 'Penalty confirmed'))).toMatchObject([
      { kind: 'var', cancelsGoal: false },
    ]);
  });

  it('início, intervalo e fim pelo status', () => {
    const status = (status: string, previous: string, detail?: string) => ({
      topic: 'event.status_changed',
      data: { status, status_detail: detail ?? null },
      previous: { status: previous },
    });
    expect(gameSignals(status('live', 'scheduled'))).toEqual([
      { kind: 'kickoff', sourceKey: 'status:kickoff' },
    ]);
    expect(gameSignals(status('live', 'break'))).toEqual([]);
    expect(gameSignals(status('break', 'live', 'HT'))).toEqual([
      { kind: 'half_time', sourceKey: 'status:break:HT' },
    ]);
    expect(gameSignals(status('finished', 'live'))).toEqual([
      { kind: 'full_time', sourceKey: 'status:finished' },
    ]);
    expect(gameSignals({ topic: 'event.score_changed', data: {} })).toEqual([]);
  });
});

describe('gameText', () => {
  const goal = {
    kind: 'goal' as const,
    minute: 23,
    extra: null,
    detail: 'Normal Goal',
    team: { name: 'Palmeiras' },
    player: 'Estêvão',
    score: { home: 1, away: 0 },
  };

  it('gol nos três idiomas, com autor e placar', () => {
    expect(gameText(goal)).toEqual({
      'pt-BR': "23' ⚽ Gol do Palmeiras (Estêvão). 1-0",
      es: "23' ⚽ Gol de Palmeiras (Estêvão). 1-0",
      en: "23' ⚽ Goal for Palmeiras (Estêvão). 1-0",
    });
  });

  it('gol anulado continua e mostra a anulação', () => {
    expect(gameText({ ...goal, cancelled: true })['pt-BR']).toMatch(/Anulado pelo VAR\.$/);
    expect(gameText({ ...goal, kind: 'var', detail: 'Goal cancelled', player: null }).es).toBe(
      "23' 📺 VAR: gol anulado (Palmeiras).",
    );
  });

  it('fim de jogo com placar', () => {
    expect(gameText({ ...goal, kind: 'full_time', minute: null, score: { home: 2, away: 1 } }).en).toBe(
      'Full time. 2-1',
    );
  });

  it('tipos ligados pelo cliente', () => {
    expect(gameKindEnabled(null, 'red_card')).toBe(true);
    expect(gameKindEnabled(['goal', 'var'], 'red_card')).toBe(false);
  });
});
