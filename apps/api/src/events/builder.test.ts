import { describe, expect, it } from 'vitest';
import {
  eventsTtl,
  goalsOf,
  groupTies,
  pairKey,
  parseReferee,
  rulesStageKey,
  type StageMatch,
} from './builder.js';

const m = (o: Partial<StageMatch> & Pick<StageMatch, 'id' | 'startsAt'>): StageMatch => ({
  stageId: 's1',
  status: 'finished',
  score: null,
  homeId: 'a',
  awayId: 'b',
  ...o,
});

describe('builder', () => {
  it('árbitro: separa o país do sufixo ", País"', () => {
    expect(parseReferee('Wilton Pereira Sampaio, Brazil')).toEqual({
      name: 'Wilton Pereira Sampaio',
      country: 'Brazil',
    });
    expect(parseReferee('  Raphael  Claus ')).toEqual({ name: 'Raphael Claus', country: null });
    expect(parseReferee('A. Silva, Jr., Brazil')).toEqual({ name: 'A. Silva, Jr.', country: 'Brazil' });
    expect(parseReferee('Anderson Daronco,')).toEqual({ name: 'Anderson Daronco', country: null });
    expect(parseReferee('')).toBeNull();
    expect(parseReferee(null)).toBeNull();
  });

  it('chave da fase no regulamento (fases numeradas de copa por extenso)', () => {
    expect(rulesStageKey('knockout_round', '1st Round')).toBe('first_round');
    expect(rulesStageKey('knockout_round', '2nd Round')).toBe('second_round');
    expect(rulesStageKey('semi_final', 'Semi-finals')).toBe('semi_final');
    expect(rulesStageKey('knockout_round', null)).toBe('knockout_round');
  });

  it('agrupa confrontos por fase e par, em ordem cronológica', () => {
    const ida = m({ id: 'ida', startsAt: new Date('2026-10-14T00:30:00Z'), homeId: 'b', awayId: 'a' });
    const volta = m({ id: 'volta', startsAt: new Date('2026-10-22T00:30:00Z') });
    const outro = m({ id: 'x', startsAt: new Date('2026-10-15T00:30:00Z'), homeId: 'c', awayId: 'd' });
    const ties = groupTies([volta, outro, ida]);
    expect(ties.get(`s1|${pairKey('a', 'b')}`)!.map((t) => t.id)).toEqual(['ida', 'volta']);
    expect(ties.size).toBe(2);
    expect(pairKey(null, 'a')).toBeNull();
  });

  it('gols por participante', () => {
    expect(goalsOf(m({ id: 'x', startsAt: new Date(), score: { home: 2, away: 1 } }))).toEqual(
      new Map([
        ['a', 2],
        ['b', 1],
      ]),
    );
    expect(goalsOf(m({ id: 'x', startsAt: new Date(), score: { home: null, away: null } }))).toBeNull();
  });

  it('TTL: ao vivo/perto do início 10 s; agenda 5 min; só encerrados, o teto', () => {
    const now = new Date('2026-10-21T15:00:00Z');
    expect(eventsTtl([{ status: 'live', starts_at: '2026-10-21T14:00:00Z' }], now)).toBe(10);
    expect(eventsTtl([{ status: 'scheduled', starts_at: '2026-10-21T16:00:00Z' }], now)).toBe(10);
    expect(eventsTtl([{ status: 'scheduled', starts_at: '2026-10-25T16:00:00Z' }], now)).toBe(300);
    expect(eventsTtl([{ status: 'finished', starts_at: '2026-10-20T16:00:00Z' }], now)).toBe(3600);
    expect(eventsTtl([], now, 300)).toBe(300);
  });
});
