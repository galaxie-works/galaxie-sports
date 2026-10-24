import type { Photo, RaceLegend } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { legendColor, legendPhotos, yearRanges } from './legends';

const livery = (primary: string, secondary: string | null = null) => ({
  primary,
  secondary,
  gradient: '',
  source: 'https://example.test',
});

const legend = (o: Partial<RaceLegend> = {}): RaceLegend =>
  ({
    id: 'senna',
    name: 'Ayrton Senna',
    highlight: null,
    portrait: null,
    ...o,
  }) as RaceLegend;

const team = (o: Record<string, unknown>) =>
  ({
    id: 't',
    name: 'McLaren',
    constructor_name: 'McLaren',
    logo: null,
    colors: null,
    livery: null,
    ...o,
  }) as NonNullable<RaceLegend['highlight']>['team'];

describe('anos dos títulos', () => {
  it('três ou mais seguidos viram faixa; dois ficam listados', () => {
    expect(yearRanges([2004, 2003, 2002, 2001, 2000, 1995, 1994])).toBe('1994, 1995, 2000–2004');
    expect(yearRanges([2008, 2014, 2015, 2017, 2018, 2019, 2020])).toBe('2008, 2014, 2015, 2017–2020');
    expect(yearRanges([1988, 1990, 1991])).toBe('1988, 1990, 1991');
    expect(yearRanges([])).toBe('');
  });
});

describe('cor do card', () => {
  it('a pintura da temporada marcante; clara demais, a secundária mais escura', () => {
    const season = { season: 1991, number: 1, car: null };
    expect(legendColor(legend({ highlight: { ...season, team: team({ livery: livery('#e4002b') }) } }))).toBe(
      '#e4002b',
    );
    expect(
      legendColor(legend({ highlight: { ...season, team: team({ livery: livery('#ffffff', '#0b2266') }) } })),
    ).toBe('#0b2266');
  });

  it('sem pintura, a cor do escudo; sem equipe, nenhuma (o card fica cinza)', () => {
    const colors = { primary: '#ff8000', secondary: null, text: '#000000', gradient: '' };
    expect(
      legendColor(legend({ highlight: { season: 2025, number: 4, car: null, team: team({ colors }) } })),
    ).toBe('#ff8000');
    expect(legendColor(legend())).toBeNull();
  });
});

describe('créditos do carrossel', () => {
  it('cada foto mostrada (carro e retrato) entra uma vez, com os pilotos dela', () => {
    const car = { url: 'https://cdn/ferrari-2002.jpg' } as Photo;
    const portrait = { url: 'https://cdn/schumacher.jpg' } as Photo;
    const schumacher = legend({
      name: 'Michael Schumacher',
      portrait,
      highlight: { season: 2002, number: 1, team: null, car },
    });
    const barrichello = legend({
      name: 'Rubens Barrichello',
      highlight: { season: 2002, number: 2, team: null, car },
    });
    expect(legendPhotos([schumacher, barrichello, legend({ name: 'Stirling Moss' })])).toEqual([
      { photo: car, names: ['Michael Schumacher', 'Rubens Barrichello'] },
      { photo: portrait, names: ['Michael Schumacher'] },
    ]);
  });
});
