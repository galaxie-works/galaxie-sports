import { describe, expect, it } from 'vitest';
import {
  normalizeTeamStatistics,
  teamStatisticCode,
  teamStatisticNumber,
  teamStatisticValues,
} from './statistics.js';

/** Palmeiras na semifinal da Libertadores 2026 (detalhe real da api-sports, sem "Passes %"). */
const PALMEIRAS = [
  { type: 'expected_goals', value: '0.64' },
  { type: 'Passes accurate', value: 483 },
  { type: 'Shots insidebox', value: 6 },
  { type: 'Shots on Goal', value: 1 },
  { type: 'Total passes', value: 549 },
  { type: 'Total Shots', value: 12 },
  { type: 'Yellow Cards', value: 2 },
  { type: 'Red Cards', value: null },
  { type: 'Ball Possession', value: '54%' },
  { type: 'Tackles in the air', value: 3 },
];

describe('estatísticas de time da api-sports', () => {
  it('código estável pelo type do fornecedor, sem diferenciar maiúsculas', () => {
    expect(teamStatisticCode('Ball Possession')).toBe('possession_pct');
    expect(teamStatisticCode('Shots insidebox')).toBe('shots_inside_box');
    expect(teamStatisticCode('expected_goals')).toBe('xg');
    expect(teamStatisticCode('passes %')).toBe('pass_accuracy_pct');
    expect(teamStatisticCode('Goalkeeper Saves')).toBe('saves');
    expect(teamStatisticCode('Tackles in the air')).toBeNull();
    expect(teamStatisticCode(null)).toBeNull();
  });

  it('valor numérico de inteiros, percentuais e decimais em texto', () => {
    expect(teamStatisticNumber(12)).toBe(12);
    expect(teamStatisticNumber('54%')).toBe(54);
    expect(teamStatisticNumber('0.64')).toBe(0.64);
    expect(teamStatisticNumber('1,5')).toBe(1.5);
    expect(teamStatisticNumber(null)).toBeNull();
    expect(teamStatisticNumber('n/d')).toBeNull();
  });

  it('mantém type e value crus, na ordem do fornecedor, e deriva a precisão de passe', () => {
    const out = normalizeTeamStatistics(PALMEIRAS);
    expect(out[0]).toEqual({
      type: 'expected_goals',
      value: '0.64',
      code: 'xg',
      numeric: 0.64,
      source: 'provider',
    });
    expect(out.find((s) => s.type === 'Red Cards')).toMatchObject({
      code: 'red_cards',
      value: null,
      numeric: null,
    });
    expect(out.find((s) => s.type === 'Tackles in the air')).toMatchObject({ code: null, numeric: 3 });
    expect(out.at(-1)).toEqual({
      type: 'pass_accuracy_pct',
      value: 88,
      code: 'pass_accuracy_pct',
      numeric: 88,
      source: 'derived',
    });
  });

  it('não deriva a precisão quando o fornecedor já manda "Passes %"', () => {
    const out = normalizeTeamStatistics([
      { type: 'Total passes', value: 500 },
      { type: 'Passes accurate', value: 400 },
      { type: 'Passes %', value: '81%' },
    ]);
    expect(out.filter((s) => s.code === 'pass_accuracy_pct')).toEqual([
      { type: 'Passes %', value: '81%', code: 'pass_accuracy_pct', numeric: 81, source: 'provider' },
    ]);
  });

  it('mapa código → número só com o que é conhecido e tem valor', () => {
    expect(teamStatisticValues(PALMEIRAS)).toEqual({
      xg: 0.64,
      passes_accurate: 483,
      shots_inside_box: 6,
      shots_on_goal: 1,
      passes_total: 549,
      shots_total: 12,
      yellow_cards: 2,
      possession_pct: 54,
      pass_accuracy_pct: 88,
    });
    expect(teamStatisticValues(undefined)).toEqual({});
  });
});
