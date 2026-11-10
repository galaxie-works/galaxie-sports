import { describe, expect, it } from 'vitest';

import { dayIn, fillDays, MAX_PERIOD_DAYS, periodFrom } from './data-utils';
import { periodFromSelector, selectorFromPeriod } from './period';

const today = new Date(2026, 10, 10);

describe('período do seletor', () => {
  it('dias: intervalo, um dia, antes e depois', () => {
    const start = new Date(2026, 9, 5);
    const end = new Date(2026, 9, 20);
    expect(
      periodFromSelector({ period: 'day', operator: 'between', startDate: start, endDate: end }, today),
    ).toEqual({
      from: '2026-10-05',
      to: '2026-10-20',
    });
    expect(periodFromSelector({ period: 'day', operator: 'is', startDate: start }, today)).toEqual({
      from: '2026-10-05',
      to: '2026-10-05',
    });
    expect(periodFromSelector({ period: 'day', operator: 'before', startDate: start }, today)).toEqual({
      from: '2026-01-01',
      to: '2026-10-04',
    });
    expect(periodFromSelector({ period: 'day', operator: 'after', startDate: start }, today)).toEqual({
      from: '2026-10-06',
      to: '2026-11-10',
    });
  });

  it('mês, trimestre e ano (o mês é 0–11), também em intervalo', () => {
    expect(periodFromSelector({ period: 'month', operator: 'is', year: 2026, month: 1 }, today)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(periodFromSelector({ period: 'quarter', operator: 'is', year: 2026, quarter: 3 }, today)).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
    });
    expect(periodFromSelector({ period: 'year', operator: 'is', year: 2026 }, today)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(
      periodFromSelector(
        {
          period: 'month',
          operator: 'between',
          rangeStart: { year: 2026, value: 8 },
          rangeEnd: { year: 2026, value: 10 },
        },
        today,
      ),
    ).toEqual({ from: '2026-09-01', to: '2026-11-30' });
  });

  it('valor incompleto não aplica; o período da URL volta ao seletor', () => {
    expect(periodFromSelector({ period: 'day', operator: 'between' }, today)).toBeNull();
    expect(periodFromSelector(undefined, today)).toBeNull();
    expect(periodFromSelector(selectorFromPeriod({ from: '2026-10-01', to: '2026-10-31' }), today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });
});

describe('período da URL e dias do gráfico', () => {
  const now = new Date('2026-11-10T15:00:00Z');

  it('sem período ou com período inválido: os últimos 30 dias, hoje inclusive', () => {
    const p = periodFrom({}, now);
    expect(p.from.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(periodFrom({ from: '2026-12-01', to: '2026-11-01' }, now).from.toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
    expect(periodFrom({ from: 'x', to: '2026-11-05' }, now).to.toISOString()).toBe(
      '2026-11-06T00:00:00.000Z',
    );
  });

  it('no fuso de quem olha: 22h30 de 31/10 em São Paulo ainda é 31/10', () => {
    const tz = 'America/Sao_Paulo';
    const lateNight = new Date('2026-11-01T01:30:00Z'); // 22h30 de 31/10 em São Paulo
    expect(dayIn(lateNight, tz)).toBe('2026-10-31');
    const p = periodFrom({ from: '2026-10-31', to: '2026-10-31' }, now, tz);
    expect(p.from.toISOString()).toBe('2026-10-31T03:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(lateNight >= p.from && lateNight < p.to).toBe(true);
    // "hoje" também é o do fuso: 23h de 10/11 em São Paulo já é 11/11 em UTC
    expect(periodFrom({}, new Date('2026-11-11T02:00:00Z'), tz).toDay).toBe('2026-11-10');
  });

  it('período com teto: nunca antes de 2026-01-01 nem maior que 366 dias', () => {
    const huge = periodFrom({ from: '0001-01-01', to: '9999-12-31' }, now);
    expect(huge.toDay).toBe('9999-12-31');
    expect(huge.fromDay).toBe('9998-12-31');
    expect(fillDays([], huge.fromDay, huge.toDay)).toHaveLength(MAX_PERIOD_DAYS);
    expect(periodFrom({ from: '2020-01-01', to: '2026-03-01' }, now).fromDay).toBe('2026-01-01');
    expect(periodFrom({ from: '2020-01-01', to: '2020-02-01' }, now)).toMatchObject({
      fromDay: '2026-01-01',
      toDay: '2026-01-01',
    });
  });

  it('dias sem uso entram com 0; salas do mesmo dia somam', () => {
    expect(
      fillDays(
        [
          { day: '2026-11-01', credits: 1.5 },
          { day: '2026-11-01', credits: 2 },
          { day: '2026-11-03', credits: 4 },
        ],
        '2026-11-01',
        '2026-11-03',
      ),
    ).toEqual([
      { day: '2026-11-01', credits: 3.5 },
      { day: '2026-11-02', credits: 0 },
      { day: '2026-11-03', credits: 4 },
    ]);
  });
});
