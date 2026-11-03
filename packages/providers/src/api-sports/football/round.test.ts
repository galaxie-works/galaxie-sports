import { describe, expect, it } from 'vitest';
import { englishOrdinal, parseRound } from './round.js';
import { API_SPORTS_FOOTBALL_STATUS, mapFootballStatus } from './status.js';

describe('parseRound', () => {
  const cases: [string, string, string, string, number][] = [
    ['Regular Season - 12', 'regular', 'Rodada 12', 'Matchday 12', 2012],
    ['Regular Season', 'regular', 'Fase regular', 'Regular season', 2000],
    ['Apertura - 10', 'regular', 'Apertura · Rodada 10', 'Apertura · Matchday 10', 2010],
    ['Northeast - 3', 'regular', 'Northeast · Rodada 3', 'Northeast · Matchday 3', 2003],
    ['Group B - 6', 'group', 'Grupo B · Rodada 6', 'Group B · Matchday 6', 2006],
    ['Group Stage', 'group', 'Fase de grupos', 'Group stage', 2000],
    ['Group 10 - 4', 'group', 'Grupo 10 · Rodada 4', 'Group 10 · Matchday 4', 2004],
    ['League Stage - 3', 'league_phase', 'Fase de liga · Rodada 3', 'League phase · Matchday 3', 2003],
    [
      'Relegation Group - 9',
      'relegation',
      'Fase de rebaixamento · Rodada 9',
      'Relegation round · Matchday 9',
      3009,
    ],
    ['Relegation', 'relegation', 'Fase de rebaixamento', 'Relegation round', 3000],
    ['Qualification - 3', 'qualifying', 'Fase preliminar · Rodada 3', 'Qualifying round · Matchday 3', 1003],
    ['2nd Preliminary Round', 'qualifying', '2ª fase preliminar', '2nd qualifying round', 1002],
    ['Play-offs', 'playoff', 'Playoffs', 'Play-offs', 4000],
    ['3rd Round', 'knockout_round', '3ª fase', '3rd round', 5003],
    ['Round of 64', 'round_of_64', '32 avos de final', 'Round of 64', 7000],
    ['Round of 32', 'round_of_32', '16 avos de final', 'Round of 32', 8000],
    ['Round of 16', 'round_of_16', 'Oitavas de final', 'Round of 16', 9000],
    ['8th Finals', 'round_of_16', 'Oitavas de final', 'Round of 16', 9008],
    ['Quarter-finals', 'quarter_final', 'Quartas de final', 'Quarter-finals', 10000],
    ['Semi-finals', 'semi_final', 'Semifinal', 'Semi-finals', 11000],
    ['3rd Place Final', 'third_place', 'Disputa do 3º lugar', 'Third place', 12003],
    ['Final', 'final', 'Final', 'Final', 13000],
    ['Finals', 'final', 'Final', 'Final', 13000],
    ['Club Friendlies', 'friendly', 'Amistosos', 'Friendlies', 0],
    ['Torneio Esquisito', 'other', 'Torneio Esquisito', 'Torneio Esquisito', 2000],
    // mata-mata de torneio curto (Liguilla, playoffs do Apertura): a fase vem depois do nome do torneio
    [
      'Apertura - Quarter-finals',
      'quarter_final',
      'Apertura · Quartas de final',
      'Apertura · Quarter-finals',
      10000,
    ],
    ['Clausura - Semi-finals', 'semi_final', 'Clausura · Semifinal', 'Clausura · Semi-finals', 11000],
    ['Apertura - Final', 'final', 'Apertura · Final', 'Apertura · Final', 13000],
    ['Apertura - Round of 16', 'round_of_16', 'Apertura · Oitavas de final', 'Apertura · Round of 16', 9000],
    // o que não é mata-mata continua como antes
    [
      'Relegation Round - 3',
      'relegation',
      'Fase de rebaixamento · Rodada 3',
      'Relegation round · Matchday 3',
      3003,
    ],
    ['Liga MX - Group Stage', 'group', 'Fase de grupos', 'Group stage', 2000],
  ];

  it.each(cases)('%s', (label, kind, pt, en, order) => {
    const r = parseRound(label);
    expect(r.kind).toBe(kind);
    expect(r.name['pt-BR']).toBe(pt);
    expect(r.name.en).toBe(en);
    expect(r.order).toBe(order);
  });

  it('ordinal em inglês', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(englishOrdinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
    ]);
  });

  it('oitavas vêm antes das quartas, que vêm antes da final', () => {
    const order = ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'].map((l) => parseRound(l).order);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('nome em espanhol', () => {
    expect(parseRound('Regular Season - 5').name.es).toBe('Fecha 5');
    expect(parseRound('Quarter-finals').name.es).toBe('Cuartos de final');
  });
});

describe('status da api-sports', () => {
  const cases: [string, string | null][] = [
    ['TBD', 'scheduled'],
    ['NS', 'scheduled'],
    ['1H', 'live'],
    ['HT', 'break'],
    ['2H', 'live'],
    ['ET', 'live'],
    ['BT', 'break'],
    ['P', 'live'],
    ['LIVE', 'live'],
    ['SUSP', 'suspended'],
    ['INT', 'suspended'],
    ['FT', 'finished'],
    ['AET', 'finished'],
    ['PEN', 'finished'],
    ['AWD', 'finished'],
    ['WO', 'finished'],
    ['PST', 'postponed'],
    ['CANC', 'cancelled'],
    ['ABD', 'abandoned'],
    ['XYZ', null],
  ];
  it.each(cases)('%s → %s', (code, expected) => {
    expect(mapFootballStatus(code)).toBe(expected);
  });

  it('cobre os 19 códigos documentados', () => {
    expect(Object.keys(API_SPORTS_FOOTBALL_STATUS)).toHaveLength(19);
    expect(mapFootballStatus(null)).toBeNull();
    expect(mapFootballStatus('ft')).toBe('finished');
  });
});
