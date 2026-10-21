import { describe, expect, it } from 'vitest';
import { localDayRange, medalQuality, todayIn } from './multisport.js';

describe('localDayRange', () => {
  it('converte o dia local em intervalo UTC, inclusive com horário de verão', () => {
    expect(localDayRange('2024-08-02', 'Europe/Paris')).toEqual({
      from: new Date('2024-08-01T22:00:00Z'),
      to: new Date('2024-08-02T22:00:00Z'),
    });
    expect(localDayRange('2016-08-05', 'America/Sao_Paulo')).toEqual({
      from: new Date('2016-08-05T03:00:00Z'),
      to: new Date('2016-08-06T03:00:00Z'),
    });
    // dia da mudança de horário (Paris, 31/03/2024): 23 horas
    const dst = localDayRange('2024-03-31', 'Europe/Paris');
    expect(dst.from).toEqual(new Date('2024-03-30T23:00:00Z'));
    expect(dst.to).toEqual(new Date('2024-03-31T22:00:00Z'));
    expect(localDayRange('2024-12-31', 'UTC').to).toEqual(new Date('2025-01-01T00:00:00Z'));
  });

  it('todayIn usa a data local do fuso', () => {
    const now = new Date('2024-08-02T23:30:00Z');
    expect(todayIn('Europe/Paris', now)).toBe('2024-08-03');
    expect(todayIn('America/Sao_Paulo', now)).toBe('2024-08-02');
  });
});

describe('medalQuality', () => {
  it('só complete/partial são publicáveis; aviso localizado', () => {
    expect(
      medalQuality({ medalDataQuality: 'complete', medalCoverage: '0.9920', status: 'completed' }, 'pt-BR'),
    ).toEqual({
      level: 'complete',
      coverage: 0.992,
      publishable: true,
      notice: null,
    });
    const partial = medalQuality(
      { medalDataQuality: 'partial', medalCoverage: '0.9568', status: 'completed' },
      'pt-BR',
    );
    expect(partial).toMatchObject({
      publishable: true,
      notice: 'Quadro parcial: cobertura de 95,7% das medalhas distribuídas.',
    });
    for (const level of ['insufficient', 'unknown', null]) {
      const q = medalQuality({ medalDataQuality: level, medalCoverage: null, status: 'completed' }, 'es-MX');
      expect(q.publishable).toBe(false);
      expect(q.notice).toMatch(/insuficientes/);
    }
    expect(
      medalQuality({ medalDataQuality: null, medalCoverage: null, status: 'upcoming' }, 'es-AR').notice,
    ).toBe('Los Juegos todavía no comenzaron.');
  });
});
