import { describe, expect, it } from 'vitest';
import { loadCompetitionRules } from '@galaxie/rules/config';
import {
  groupTies,
  importanceFromFacts,
  maxRounds,
  pairKey,
  roundPrefix,
  rulesLegs,
  sameBreakdown,
  tieShape,
  totalRoundsOf,
  type ImportanceFacts,
  type TieMatch,
} from './importance-facts.js';

const base: ImportanceFacts = {
  tier: 1,
  prestige: 0,
  stageKind: 'regular',
  stageLabel: 'Regular Season - 1',
  totalRounds: 38,
  knockout: null,
  derby: null,
  stakeFlags: [],
};

const m = (key: string, day: number, parts = ['pal', 'flu'], stageId = 'sf'): TieMatch => ({
  key,
  stageId,
  startsAt: new Date(Date.UTC(2026, 9, day, 22)),
  participants: parts,
});

describe('importanceFromFacts', () => {
  it('volta da semifinal da Libertadores: eliminação + prestígio = 80', () => {
    const r = importanceFromFacts({
      ...base,
      prestige: 10,
      stageKind: 'semi_final',
      stageLabel: 'Semi-finals',
      totalRounds: null,
      knockout: { legs: 2, leg: 2 },
    });
    expect(r.score).toBe(80);
    expect(r.breakdown).toEqual({
      tier: 40,
      phase: 22,
      derby: 0,
      decisive: 8,
      prestige: 10,
      leg: 2,
      flags: ['elimination'],
      stake_flags: [],
    });
  });

  it('ida da semifinal: fase × 0,75 e nada decidido', () => {
    const r = importanceFromFacts({
      ...base,
      prestige: 10,
      stageKind: 'semi_final',
      stageLabel: 'Semi-finals',
      knockout: { legs: 2, leg: 1 },
    });
    expect(r.score).toBe(40 + 17 + 10);
    expect(r.breakdown.flags).toEqual([]);
  });

  it('final em jogo único: título (95)', () => {
    const r = importanceFromFacts({
      ...base,
      prestige: 10,
      stageKind: 'final',
      stageLabel: 'Final',
      knockout: { legs: 1, leg: null },
    });
    expect(r.score).toBe(95);
    expect(r.breakdown.flags).toEqual(['title']);
  });

  it('rodada 32 do Brasileirão com sinais da tabela (teto 20) e reta final', () => {
    const r = importanceFromFacts({
      ...base,
      stageLabel: 'Regular Season - 32',
      stakeFlags: ['relegation', 'title', 'bogus'],
    });
    expect(r.breakdown).toMatchObject({ phase: 4 + 5, decisive: 20, flags: ['title', 'relegation'] });
    expect(r.breakdown.stake_flags).toEqual(['relegation', 'title']);
    expect(r.score).toBe(40 + 9 + 20);
  });

  it('progresso só em pontos corridos (grupo não ganha reta final)', () => {
    expect(
      importanceFromFacts({ ...base, stageKind: 'group', stageLabel: 'Group A - 6', totalRounds: 6 })
        .breakdown.phase,
    ).toBe(6);
  });
});

describe('ida e volta', () => {
  it('duas partidas do par na fase: a mais cedo é a ida', () => {
    const ties = groupTies([m('volta', 21), m('ida', 14, ['flu', 'pal']), m('outro', 15, ['fla', 'est'])]);
    const tie = ties.get(pairKey('sf', ['pal', 'flu'])!)!;
    expect(tie.map((t) => t.key)).toEqual(['ida', 'volta']);
    expect(tieShape({ key: 'ida' }, tie, null)).toEqual({ legs: 2, leg: 1 });
    expect(tieShape({ key: 'volta' }, tie, 1)).toEqual({ legs: 2, leg: 2 });
  });

  it('partida sozinha: o regulamento decide (perna desconhecida em ida e volta)', () => {
    const tie = [m('so', 21)];
    expect(tieShape({ key: 'so' }, tie, null)).toEqual({ legs: 1, leg: null });
    expect(tieShape({ key: 'so' }, tie, 1)).toEqual({ legs: 1, leg: null });
    expect(tieShape({ key: 'so' }, tie, 2)).toEqual({ legs: 2, leg: null });
  });

  it('chave repetida conta uma vez; sem dois participantes não há confronto', () => {
    expect(groupTies([m('a', 1), m('a', 2)]).get(pairKey('sf', ['pal', 'flu'])!)).toHaveLength(1);
    expect(pairKey('sf', ['pal'])).toBeNull();
  });

  it('pernas pelo regulamento: Libertadores (final em jogo único, semi ida e volta)', async () => {
    const lib = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
    expect(rulesLegs(lib, 'semi_final', 'Semi-finals')).toBe(2);
    expect(rulesLegs(lib, 'final', 'Final')).toBe(1);
    expect(rulesLegs(null, 'final', 'Final')).toBeNull();
  });
});

describe('total de rodadas', () => {
  it('prefixo e maior rodada conhecida por temporada', () => {
    expect(roundPrefix('Regular Season - 32')).toBe('Regular Season');
    expect(roundPrefix('Final')).toBeNull();
    const known = maxRounds([
      { seasonId: 's', label: 'Regular Season - 3' },
      { seasonId: 's', label: 'Regular Season - 30' },
      { seasonId: 's', label: 'Final' },
      { seasonId: 't', label: 'Regular Season - 8' },
    ]);
    expect(known.get('s|Regular Season')).toBe(30);
    expect(totalRoundsOf(null, 's', 'regular', 'Regular Season - 12', known)).toBe(30);
    expect(totalRoundsOf(null, 's', 'semi_final', 'Semi-finals', known)).toBeNull();
  });

  it('regulamento com matches_per_team vale mais que os dados', async () => {
    const bra = await loadCompetitionRules('brasileirao-serie-a', { season: 2026 });
    expect(
      totalRoundsOf(bra, 's', 'regular', 'Regular Season - 12', new Map([['s|Regular Season', 12]])),
    ).toBe(38);
  });
});

describe('sameBreakdown', () => {
  it('compara todos os componentes e sinais', () => {
    const a = importanceFromFacts(base).breakdown;
    expect(sameBreakdown(a, { ...a })).toBe(true);
    expect(sameBreakdown(a, { ...a, stake_flags: ['title'] })).toBe(false);
    expect(sameBreakdown(a, null)).toBe(false);
    expect(sameBreakdown(null, null)).toBe(true);
  });
});
