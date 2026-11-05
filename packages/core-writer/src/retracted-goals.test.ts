import { describe, expect, it } from 'vitest';
import {
  RETRACTED_GOAL_DETAIL,
  RETRACTED_GOAL_MARK,
  RETRACTED_GOAL_SEQUENCE_BASE,
  retractedGoals,
  type IncidentRow,
} from './retracted-goals.js';

const SAO = 'sao-paulo';
const COR = 'corinthians';

let seq = 0;
const inc = (p: Partial<IncidentRow> & Pick<IncidentRow, 'type'>): IncidentRow => ({
  sequence: seq++,
  minute: null,
  extra: null,
  detail: null,
  participantId: null,
  personId: null,
  assistPersonId: null,
  data: null,
  ...p,
});

/** São Paulo × Corinthians (04/11/2026): gol do Bidu aos 62' que a api-sports apagou sem mandar o VAR. */
function scenario() {
  seq = 0;
  const yellow = inc({
    type: 'card',
    detail: 'Yellow Card',
    minute: 61,
    participantId: SAO,
    personId: 'newton',
  });
  const goal = inc({
    type: 'goal',
    detail: 'Normal Goal',
    minute: 62,
    participantId: COR,
    personId: 'bidu',
    assistPersonId: 'yuri',
    data: { type: 'Goal', detail: 'Normal Goal', comments: null, player: { id: 1, name: 'Matheus Bidu' } },
  });
  const sub = inc({ type: 'subst', detail: 'Substitution 1', minute: 62, participantId: COR });
  return { yellow, goal, sub };
}

describe('retractedGoals', () => {
  it('gol apagado pela fonte vira VAR de gol anulado com minuto, time e jogador', () => {
    const { yellow, goal, sub } = scenario();
    const before = [yellow, goal, sub];
    const after = [yellow, { ...sub, sequence: 1 }];
    const out = retractedGoals(before, after);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sequence: RETRACTED_GOAL_SEQUENCE_BASE,
      type: 'var',
      detail: RETRACTED_GOAL_DETAIL,
      minute: 62,
      participantId: COR,
      personId: 'bidu',
      assistPersonId: null,
    });
    expect(out[0]!.data).toMatchObject({
      type: 'Var',
      detail: RETRACTED_GOAL_DETAIL,
      player: { name: 'Matheus Bidu' },
      galaxie: { inferred: RETRACTED_GOAL_MARK, goal: { type: 'goal', detail: 'Normal Goal' } },
    });
  });

  it('o inferido continua nas trocas seguintes e não duplica', () => {
    const { yellow, goal, sub } = scenario();
    const after = [yellow, { ...sub, sequence: 1 }];
    const first = retractedGoals([yellow, goal, sub], after);
    const stored = [...after, ...first];
    expect(retractedGoals(stored, after)).toEqual(first);
    const later = [...after, inc({ type: 'card', detail: 'Yellow Card', minute: 70, participantId: COR })];
    expect(retractedGoals([...stored], later)).toEqual(first);
  });

  it('o VAR do próprio fornecedor substitui o inferido', () => {
    const { yellow, goal, sub } = scenario();
    const after = [yellow, { ...sub, sequence: 1 }];
    const first = retractedGoals([yellow, goal, sub], after);
    const withVar = [
      ...after,
      inc({ type: 'var', detail: 'Goal Disallowed - offside', minute: 64, participantId: COR }),
    ];
    expect(retractedGoals([...after, ...first], withVar)).toEqual([]);
    // e se o VAR do fornecedor já vem junto com a remoção, nada é inferido
    expect(retractedGoals([yellow, goal, sub], withVar)).toEqual([]);
  });

  it('gol que volta para a timeline tira o inferido', () => {
    const { yellow, goal, sub } = scenario();
    const after = [yellow, { ...sub, sequence: 1 }];
    const first = retractedGoals([yellow, goal, sub], after);
    expect(retractedGoals([...after, ...first], [yellow, goal, sub])).toEqual([]);
  });

  it('autor trocado, gol virando gol contra ou timeline reordenada não inventam anulação', () => {
    const { yellow, goal, sub } = scenario();
    expect(retractedGoals([yellow, goal, sub], [yellow, { ...goal, personId: 'yuri' }, sub])).toEqual([]);
    expect(
      retractedGoals([yellow, goal, sub], [yellow, { ...goal, type: 'own_goal', participantId: SAO }, sub]),
    ).toEqual([]);
    expect(
      retractedGoals([yellow, goal, sub], [{ ...goal, sequence: 0 }, { ...yellow, sequence: 1 }, sub]),
    ).toEqual([]);
  });

  it('com dois gols do mesmo time, anula o que sumiu', () => {
    const { yellow, goal } = scenario();
    const second = inc({
      type: 'goal',
      detail: 'Normal Goal',
      minute: 80,
      participantId: COR,
      personId: 'depay',
    });
    const out = retractedGoals([yellow, goal, second], [yellow, { ...second, sequence: 1 }]);
    expect(out.map((i) => [i.minute, i.personId])).toEqual([[62, 'bidu']]);
  });

  it('cobrança da disputa de pênaltis não conta', () => {
    seq = 0;
    const kick = inc({
      type: 'goal',
      detail: 'Penalty',
      minute: 120,
      participantId: COR,
      data: { comments: 'Penalty Shootout' },
    });
    expect(retractedGoals([kick], [])).toEqual([]);
  });
});
