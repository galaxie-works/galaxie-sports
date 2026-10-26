import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAND_SHARES,
  DEFAULT_BAND_SHARES_TEXT,
  DEFAULT_BUDGET_DAY,
  bandLimitsUsd,
  budgetDayOf,
  checkBandShares,
  formatBandShares,
  isTimeZone,
  parseBandShares,
} from './ai-policy.js';
import { settingDef } from './registry.js';
import { validateSettingKey } from './resolve.js';

describe('faixas do orçamento de IA (AI_BAND_SHARES)', () => {
  it('padrão calibrado no gasto de 21 a 25/10: 45% P0 + 10% de reserva só da P0, 15% P1, 15% clientes, 5% resto, 10% manual', () => {
    expect(DEFAULT_BAND_SHARES_TEXT).toBe('p0=45,reserve=10,p1=15,clients=15,rest=5,manual=10');
    expect(settingDef('AI_BAND_SHARES')?.default).toBe(DEFAULT_BAND_SHARES_TEXT);
    expect(Object.values(DEFAULT_BAND_SHARES).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('o registro (painel e serviço) aceita só as seis faixas somando 100, e grava na ordem das faixas', () => {
    expect(validateSettingKey('AI_BAND_SHARES', 'manual=3 rest=5 clients=12 p1=15 reserve=10 p0=55')).toEqual(
      {
        ok: true,
        value: 'manual=3 rest=5 clients=12 p1=15 reserve=10 p0=55',
      },
    );
    expect(validateSettingKey('AI_BAND_SHARES', 'p0=60,reserve=10,p1=15,clients=12,rest=5,manual=3')).toEqual(
      {
        ok: false,
        error: { code: 'shares', detail: '105' },
      },
    );
    expect(validateSettingKey('AI_BAND_SHARES', 'p0=55,reserve=10,p1=15,clients=12,rest=8')).toMatchObject({
      ok: false,
      error: { code: 'format', values: ['manual'] },
    });
    expect(
      validateSettingKey('AI_BAND_SHARES', 'p0=55,p0=10,p1=15,clients=12,rest=5,manual=3'),
    ).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
    expect(
      validateSettingKey('AI_BAND_SHARES', 'p2=55,reserve=10,p1=15,clients=12,rest=5,manual=3'),
    ).toMatchObject({
      ok: false,
    });
    expect(checkBandShares('p0=100,reserve=0,p1=0,clients=0,rest=0,manual=0')).toMatchObject({ ok: true });
    expect(formatBandShares(parseBandShares('manual=10 rest=5 clients=15 p1=15 reserve=10 p0=45')!)).toBe(
      DEFAULT_BAND_SHARES_TEXT,
    );
    expect(parseBandShares('')).toEqual(DEFAULT_BAND_SHARES);
    expect(parseBandShares('p0=1')).toBeNull();
  });

  it('teto de cada faixa: a % do teto global; a P0 soma a reserva; sem teto global, sem teto', () => {
    expect(bandLimitsUsd(10, DEFAULT_BAND_SHARES)).toEqual({
      p0: 5.5,
      p1: 1.5,
      clients: 1.5,
      rest: 0.5,
      manual: 1,
    });
    expect(bandLimitsUsd(null, DEFAULT_BAND_SHARES).p0).toBeNull();
  });

  it('corte P0/P1 e virada do dia no registro', () => {
    expect(validateSettingKey('AI_P0_MIN_AUDIENCE', '25')).toMatchObject({ ok: true });
    expect(validateSettingKey('AI_P0_MIN_AUDIENCE', '41')).toMatchObject({
      ok: false,
      error: { code: 'range' },
    });
    expect(validateSettingKey('AI_BUDGET_DAY_START', '06:00')).toMatchObject({ ok: true });
    expect(validateSettingKey('AI_BUDGET_DAY_START', '6h')).toMatchObject({ ok: false });
    expect(validateSettingKey('AI_BUDGET_DAY_START', '24:00')).toMatchObject({ ok: false });
    expect(validateSettingKey('AI_BUDGET_TIMEZONE', 'America/Sao_Paulo')).toMatchObject({ ok: true });
    expect(validateSettingKey('AI_BUDGET_TIMEZONE', 'America/Atlantida')).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
    expect(isTimeZone('UTC')).toBe(true);
  });
});

describe('dia de orçamento (vira às 06:00 em Brasília)', () => {
  it('05:59 em Brasília ainda é o dia anterior; 06:00 começa o novo', () => {
    // Brasília = UTC-3: 06:00 local = 09:00Z
    expect(budgetDayOf(new Date('2026-10-26T08:59:59Z'), DEFAULT_BUDGET_DAY)).toBe('2026-10-25');
    expect(budgetDayOf(new Date('2026-10-26T09:00:00Z'), DEFAULT_BUDGET_DAY)).toBe('2026-10-26');
    // a rodada da noite (quarta 19h–23h30 em Brasília, já quinta em UTC) fica num dia só
    expect(budgetDayOf(new Date('2026-10-28T22:00:00Z'), DEFAULT_BUDGET_DAY)).toBe('2026-10-28');
    expect(budgetDayOf(new Date('2026-10-29T02:30:00Z'), DEFAULT_BUDGET_DAY)).toBe('2026-10-28');
  });

  it('configurável; sem configuração, o dia UTC de antes', () => {
    expect(budgetDayOf(new Date('2026-10-26T00:30:00Z'))).toBe('2026-10-26');
    expect(budgetDayOf(new Date('2026-10-26T06:30:00Z'), { timeZone: 'UTC', start: '07:00' })).toBe(
      '2026-10-25',
    );
    expect(budgetDayOf(new Date('2026-10-26T07:00:00Z'), { timeZone: 'UTC', start: '07:00' })).toBe(
      '2026-10-26',
    );
  });
});
