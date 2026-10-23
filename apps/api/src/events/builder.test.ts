import { describe, expect, it } from 'vitest';
import {
  eventsTtl,
  goalsOf,
  groupTies,
  pairKey,
  parseReferee,
  rulesStageKey,
  scorePeriods,
  tieLegs,
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

  it('parciais na ordem do jogo, sem períodos não disputados (o jsonb embaralha as chaves)', () => {
    // vôlei 3x1: o jsonb devolve as chaves ordenadas por tamanho e texto, o que já está certo para s1..s5
    expect(
      scorePeriods({
        s1: { home: 25, away: 21 },
        s2: { home: 23, away: 25 },
        s3: { home: 25, away: 19 },
        s4: { home: 25, away: 22 },
        s5: { home: null, away: null },
      }),
    ).toEqual([
      { code: 's1', home: 25, away: 21 },
      { code: 's2', home: 23, away: 25 },
      { code: 's3', home: 25, away: 19 },
      { code: 's4', home: 25, away: 22 },
    ]);
    // hóquei: `ot` e `so` vêm antes de `p1` no jsonb, mas são os últimos no jogo
    expect(
      scorePeriods({
        ot: { home: 1, away: 0 },
        p1: { home: 1, away: 1 },
        p2: { home: 0, away: 1 },
        p3: { home: 1, away: 0 },
        so: { home: null, away: null },
      })?.map((p) => p.code),
    ).toEqual(['p1', 'p2', 'p3', 'ot']);
    // futebol americano (Final/OT): quartos e a prorrogação no fim
    expect(
      scorePeriods({
        ot: { home: 6, away: 0 },
        q4: { home: 7, away: 10 },
        q1: { home: 3, away: 7 },
        q3: { home: 7, away: 0 },
        q2: { home: 0, away: 0 },
      })?.map((p) => p.code),
    ).toEqual(['q1', 'q2', 'q3', 'q4', 'ot']);
    expect(scorePeriods(null)).toBeNull();
    expect(scorePeriods({ s1: { home: null, away: null } })).toBeNull();
  });

  it('ida e volta só fora do vôlei (lá dois jogos do par são série, sem agregado de sets)', () => {
    expect(tieLegs('football', undefined, 2)).toBe(2);
    expect(tieLegs('football', 1, 2)).toBe(1);
    expect(tieLegs('basketball', undefined, 1)).toBe(1);
    expect(tieLegs('volleyball', undefined, 2)).toBe(1);
    expect(tieLegs('volleyball', 2, 2)).toBe(1);
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
