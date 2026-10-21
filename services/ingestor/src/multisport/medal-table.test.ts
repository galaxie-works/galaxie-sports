import { describe, expect, it } from 'vitest';
import { deriveMedalTable, type MedalRowLike } from './medal-table.js';

const m = (nocCode: string, medal: 'G' | 'S' | 'B', revokedAt: string | null = null): MedalRowLike => ({
  nocCode,
  medal,
  revokedAt,
});

describe('deriveMedalTable', () => {
  it('conta os dois bronzes das lutas e ignora medalhas revogadas', () => {
    const table = deriveMedalTable([
      // judô: ouro, prata e dois bronzes
      m('BRA', 'G'),
      m('MGL', 'S'),
      m('JPN', 'B'),
      m('BRA', 'B'),
      // ouro revogado por doping e realocado
      m('RUS', 'G', '2019-01-01'),
      m('BRA', 'G'),
    ]);
    expect(table.find((r) => r.nocCode === 'BRA')).toMatchObject({ gold: 2, silver: 0, bronze: 1, total: 3 });
    expect(table.find((r) => r.nocCode === 'RUS')).toBeUndefined();
    expect(table.reduce((s, r) => s + r.bronze, 0)).toBe(2);
  });

  it('ordena pelo padrão COI e divide a posição em empates exatos', () => {
    const table = deriveMedalTable([
      m('USA', 'G'),
      m('USA', 'S'),
      m('CAN', 'G'),
      m('CAN', 'S'),
      m('BRA', 'G'),
      m('ARG', 'S'),
      m('ARG', 'S'),
      m('ARG', 'S'),
      m('ARG', 'B'),
    ]);
    expect(table.map((r) => [r.nocCode, r.rankByGold])).toEqual([
      ['CAN', 1],
      ['USA', 1],
      ['BRA', 3],
      ['ARG', 4],
    ]);
  });

  it('ranking por total desempata por ouro, prata e bronze', () => {
    const table = deriveMedalTable([
      m('ARG', 'S'),
      m('ARG', 'S'),
      m('ARG', 'B'),
      m('ARG', 'B'),
      m('USA', 'G'),
      m('USA', 'S'),
      m('MEX', 'G'),
      m('MEX', 'B'),
      m('CHI', 'G'),
      m('CHI', 'B'),
    ]);
    const byTotal = Object.fromEntries(table.map((r) => [r.nocCode, r.rankByTotal]));
    expect(byTotal).toEqual({ ARG: 1, USA: 2, MEX: 3, CHI: 3 });
    const byGold = Object.fromEntries(table.map((r) => [r.nocCode, r.rankByGold]));
    expect(byGold).toEqual({ USA: 1, CHI: 2, MEX: 2, ARG: 4 });
  });

  it('quadro vazio', () => {
    expect(deriveMedalTable([])).toEqual([]);
  });
});
