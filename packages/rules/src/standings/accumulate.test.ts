import { describe, expect, it } from 'vitest';
import { match } from '../test-helpers.js';
import {
  accumulate,
  applyMatch,
  basePoints,
  chronological,
  formString,
  recordFromBaseline,
  StandingsInputError,
  totalPoints,
} from './accumulate.js';
import type { TeamRecord } from './types.js';

const P = { win: 3, draw: 1, loss: 0 };

describe('applyMatch', () => {
  it.each([
    ['vitória do mandante', 2, 1, { won: 1, drawn: 0, lost: 0 }, { won: 0, drawn: 0, lost: 1 }, 'W', 'L'],
    ['empate', 1, 1, { won: 0, drawn: 1, lost: 0 }, { won: 0, drawn: 1, lost: 0 }, 'D', 'D'],
    ['vitória do visitante', 0, 3, { won: 0, drawn: 0, lost: 1 }, { won: 1, drawn: 0, lost: 0 }, 'L', 'W'],
  ] as const)('%s (%i x %i)', (_n, hg, ag, home, away, hf, af) => {
    const recs = new Map<string, TeamRecord>();
    applyMatch(recs, match('A', 'B', hg, ag));
    expect(recs.get('A')).toMatchObject({ ...home, played: 1, goalsFor: hg, goalsAgainst: ag, form: [hf] });
    expect(recs.get('B')).toMatchObject({ ...away, played: 1, goalsFor: ag, goalsAgainst: hg, form: [af] });
    expect(recs.get('B')!.awayGoalsFor).toBe(ag);
    expect(recs.get('A')!.awayGoalsFor).toBe(0);
  });

  it('conta vitória fora e gols fora, exceto em campo neutro', () => {
    const recs = new Map<string, TeamRecord>();
    applyMatch(recs, match('A', 'B', 0, 2));
    applyMatch(recs, match('C', 'B', 0, 1, { neutral: true }));
    expect(recs.get('B')).toMatchObject({ won: 2, awayWon: 1, awayGoalsFor: 2, goalsFor: 3 });
  });

  it('soma cartões', () => {
    const recs = new Map<string, TeamRecord>();
    applyMatch(recs, match('A', 'B', 0, 0, { cards: { home: { yellow: 3, red: 1 }, away: { yellow: 2 } } }));
    applyMatch(recs, match('B', 'A', 0, 0, { cards: { home: { red: 1 }, away: { yellow: 1 } } }));
    expect(recs.get('A')).toMatchObject({ yellowCards: 4, redCards: 1 });
    expect(recs.get('B')).toMatchObject({ yellowCards: 2, redCards: 1 });
  });

  it.each([
    ['mesmo time', match('A', 'A', 1, 0), /contra si mesmo/],
    ['gols negativos', match('A', 'B', -1, 0), /homeGoals/],
    ['gols fracionários', match('A', 'B', 1, 0.5), /awayGoals/],
    ['sem mandante', match('', 'B', 1, 0), /obrigatórios/],
  ])('rejeita %s', (_n, m, msg) => {
    expect(() => applyMatch(new Map(), m)).toThrow(StandingsInputError);
    expect(() => applyMatch(new Map(), m)).toThrow(msg);
  });

  it('rejeita time em dois grupos', () => {
    const recs = new Map<string, TeamRecord>();
    applyMatch(recs, match('A', 'B', 1, 0, { group: 'A' }));
    expect(() => applyMatch(recs, match('A', 'C', 1, 0, { group: 'B' }))).toThrow(/um só grupo/);
  });

  it('jogo entre grupos conta no grupo de cada time', () => {
    const recs = accumulate({
      points: P,
      teams: [
        { teamId: 'A', group: 'Zona A' },
        { teamId: 'B', group: 'Zona B' },
      ],
      matches: [match('A', 'B', 2, 0, { crossGroup: true })],
    });
    expect(recs.get('A')).toMatchObject({ group: 'Zona A', played: 1, won: 1 });
    expect(recs.get('B')).toMatchObject({ group: 'Zona B', played: 1, lost: 1 });
    expect(() => applyMatch(new Map(), match('A', 'B', 1, 0, { crossGroup: true }))).toThrow(/sem grupo/);
  });
});

describe('recordFromBaseline', () => {
  it('converte a linha e infere ajuste de pontos', () => {
    const r = recordFromBaseline(
      {
        teamId: 'A',
        played: 10,
        won: 6,
        drawn: 2,
        lost: 2,
        goalsFor: 15,
        goalsAgainst: 8,
        points: 17,
        form: 'wdLxW',
      },
      P,
    );
    expect(basePoints(r, P)).toBe(20);
    expect(r.pointsAdjustment).toBe(-3);
    expect(totalPoints(r, P)).toBe(17);
    expect(r.form).toEqual(['W', 'D', 'L', 'W']);
  });

  it('sem pontos informados, não há ajuste', () => {
    const r = recordFromBaseline(
      { teamId: 'A', played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 1, goalsAgainst: 0 },
      P,
    );
    expect(r.pointsAdjustment).toBe(0);
  });

  it.each([
    [{ played: 3, won: 1, drawn: 1, lost: 0 }, /difere de jogos/],
    [{ played: -1, won: 0, drawn: 0, lost: 0 }, /played/],
  ])('rejeita linha inconsistente %j', (partial, msg) => {
    expect(() => recordFromBaseline({ teamId: 'A', goalsFor: 0, goalsAgainst: 0, ...partial }, P)).toThrow(
      msg,
    );
  });
});

describe('accumulate', () => {
  it('soma tabela de partida + novos jogos + ajustes e inclui times sem jogos', () => {
    const recs = accumulate({
      points: P,
      baseline: [
        { teamId: 'A', played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 3, goalsAgainst: 1, form: 'WD' },
      ],
      matches: [match('A', 'B', 0, 1)],
      teams: [{ teamId: 'C' }],
      adjustments: [{ teamId: 'B', points: -6, reason: 'punição' }],
    });
    expect(recs.get('A')).toMatchObject({
      played: 3,
      won: 1,
      drawn: 1,
      lost: 1,
      goalsFor: 3,
      goalsAgainst: 2,
    });
    expect(formString(recs.get('A')!)).toBe('WDL');
    expect(totalPoints(recs.get('B')!, P)).toBe(-3);
    expect(recs.get('C')!.played).toBe(0);
  });

  it.each([
    [
      'time repetido na tabela de partida',
      {
        baseline: [
          { teamId: 'A', played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
          { teamId: 'A', played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
        ],
        matches: [],
      },
      /repetido/,
    ],
    [
      'partida aplicada duas vezes',
      { matches: [match('A', 'B', 1, 0, { id: 'x' }), match('A', 'B', 1, 0, { id: 'x' })] },
      /duas vezes/,
    ],
    [
      'ajuste para time desconhecido',
      { matches: [], adjustments: [{ teamId: 'Z', points: -1 }] },
      /desconhecido/,
    ],
  ])('rejeita %s', (_n, input, msg) => {
    expect(() => accumulate({ points: P, ...input })).toThrow(msg);
  });
});

describe('chronological e forma', () => {
  it('ordena por data quando todas têm data; senão mantém a ordem recebida', () => {
    const a = match('A', 'B', 1, 0, { playedAt: '2024-05-02T00:00:00Z' });
    const b = match('A', 'B', 0, 1, { playedAt: '2024-05-01T00:00:00Z' });
    expect(chronological([a, b])).toEqual([b, a]);
    expect(chronological([a, match('A', 'B', 0, 0)])[0]).toBe(a);
  });

  it('forma = últimos 5, do mais antigo ao mais recente', () => {
    const recs = accumulate({
      points: P,
      matches: [
        match('A', 'B', 1, 0, { playedAt: '2024-01-01' }),
        match('A', 'B', 0, 1, { playedAt: '2024-01-02' }),
        match('A', 'B', 0, 0, { playedAt: '2024-01-03' }),
        match('A', 'B', 2, 0, { playedAt: '2024-01-04' }),
        match('A', 'B', 2, 0, { playedAt: '2024-01-05' }),
        match('A', 'B', 0, 3, { playedAt: '2024-01-06' }),
      ],
    });
    expect(formString(recs.get('A')!)).toBe('LDWWL');
    expect(formString(recs.get('A')!, 3)).toBe('WWL');
  });
});
