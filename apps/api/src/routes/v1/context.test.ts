import { describe, expect, it } from 'vitest';
import type { StageMatch } from '../../events/builder.js';
import { tieOf, zonesFromDescriptions } from './context.js';

const parts = new Map([
  ['a', { id: 'a', name: 'A', short_name: null, logo: null }],
  ['b', { id: 'b', name: 'B', short_name: null, logo: null }],
]);
const leg = (o: Partial<StageMatch> & Pick<StageMatch, 'id'>): StageMatch => ({
  stageId: 's',
  startsAt: new Date('2026-10-14T00:30:00Z'),
  status: 'finished',
  score: null,
  homeId: 'a',
  awayId: 'b',
  ...o,
});

describe('contexto da competição', () => {
  it('zonas pela descrição do fornecedor (faixas contíguas)', () => {
    const zones = zonesFromDescriptions([
      { rank: 1, description: 'Promotion - CONMEBOL Libertadores' },
      { rank: 2, description: 'Promotion - CONMEBOL Libertadores' },
      { rank: 3, description: null },
      { rank: 19, description: 'Relegation - Serie B' },
      { rank: 20, description: 'Relegation - Serie B' },
    ]);
    expect(zones).toEqual([
      {
        id: 'promotion_conmebol_libertadores',
        kind: 'qualification',
        label: 'Promotion - CONMEBOL Libertadores',
        from: 1,
        to: 2,
      },
      { id: 'relegation_serie_b', kind: 'relegation', label: 'Relegation - Serie B', from: 19, to: 20 },
    ]);
  });

  it('confronto de ida e volta: agregado, decisão nos pênaltis e perna faltante', () => {
    const ida = leg({ id: 'ida', homeId: 'b', awayId: 'a', score: { home: 1, away: 2 } });
    const volta = leg({
      id: 'volta',
      startsAt: new Date('2026-10-22T00:30:00Z'),
      score: { home: 0, away: 1, penalty: { home: 4, away: 2 } },
    });
    const tie = tieOf([ida, volta], parts, new Map(), 'UTC', 2);
    expect(tie.status).toBe('decided');
    expect(tie.aggregate).toEqual([
      { participant_id: 'b', goals: 2 },
      { participant_id: 'a', goals: 2 },
    ]);
    expect(tie.winner_id).toBe('a');
    expect(tie.legs.map((l) => l.leg)).toEqual([1, 2]);

    const pending = tieOf([ida], parts, new Map([['ida', 'a']]), 'UTC', 2);
    expect(pending).toMatchObject({ status: 'in_progress', winner_id: null, aggregate: null });
    expect(pending.legs[0]!.leg).toBeNull();
  });

  it('jogo único sem regulamento: vencedor pelo resultado do fornecedor', () => {
    const final = leg({ id: 'f', score: { home: 1, away: 1 } });
    const tie = tieOf([final], parts, new Map([['f', 'b']]), 'UTC');
    expect(tie).toMatchObject({ status: 'decided', winner_id: 'b', aggregate: null });
    const scheduled = tieOf([leg({ id: 'g', status: 'scheduled' })], parts, new Map(), 'UTC');
    expect(scheduled.status).toBe('scheduled');
  });
});
