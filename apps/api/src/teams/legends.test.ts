import type { Photo } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';
import {
  coverable,
  pickHighlight,
  pickListed,
  rankLegends,
  type DriverTotals,
  type LegendSeason,
} from './legends.js';

const driver = (name: string, titles: number[], wins: number, races: number): DriverTotals => ({
  id: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  titles,
  wins,
  races,
});

const photo = (season: number, shareAlike = false): Photo =>
  ({
    url: `https://assets.test/${season}.jpg`,
    width: 1600,
    height: 1067,
    role: 'car',
    season,
    credit: { share_alike: shareAlike },
  }) as Photo;

describe('quem é lenda e em que ordem', () => {
  const drivers = [
    driver('Ayrton Senna', [1988, 1990, 1991], 41, 161),
    driver('Lewis Hamilton', [2008, 2014, 2015, 2017, 2018, 2019, 2020], 106, 400),
    driver('Michael Schumacher', [1994, 1995, 2000, 2001, 2002, 2003, 2004], 91, 308),
    driver('Rubens Barrichello', [], 11, 322),
    driver('Stirling Moss', [], 16, 66),
    driver('Piloto Sem Vitória', [], 0, 5),
  ];

  it('por títulos, depois vitórias; os 7 títulos desempatam pelas vitórias', () => {
    expect(rankLegends(drivers, 1).map((d) => d.name)).toEqual([
      'Lewis Hamilton',
      'Michael Schumacher',
      'Ayrton Senna',
    ]);
  });

  it('sem título, entra pelo top de vitórias ou de GPs, e diz por quê', () => {
    const ranked = rankLegends(drivers, 4);
    expect(ranked.map((d) => [d.name, d.criteria])).toEqual([
      ['Lewis Hamilton', ['titles', 'wins', 'races']],
      ['Michael Schumacher', ['titles', 'wins', 'races']],
      ['Ayrton Senna', ['titles', 'wins', 'races']],
      ['Stirling Moss', ['wins']],
      ['Rubens Barrichello', ['races']],
    ]);
  });

  it('quem não tem título nem está nos tops fica de fora', () => {
    expect(rankLegends(drivers).find((d) => d.name === 'Piloto Sem Vitória')).toMatchObject({
      criteria: ['races'],
    });
    expect(rankLegends(drivers, 3).some((d) => d.name === 'Piloto Sem Vitória')).toBe(false);
  });
});

describe('temporada marcante do card', () => {
  const season = (year: number, o: Partial<LegendSeason> = {}): LegendSeason => ({
    year,
    title: false,
    wins: 0,
    car: null,
    ...o,
  });
  // Senna: títulos em 1988 (8 vitórias), 1990 (6) e 1991 (7)
  const senna = [
    season(1993, { wins: 5, car: photo(1993) }),
    season(1991, { title: true, wins: 7, car: photo(1991) }),
    season(1990, { title: true, wins: 6 }),
    season(1988, { title: true, wins: 8 }),
  ];

  it('o carro de destaque do acervo vence (curadoria)', () => {
    const highlight = { ...photo(1990), role: 'highlight_car' } as Photo;
    expect(pickHighlight(senna, highlight)).toMatchObject({ season: { year: 1990 }, car: highlight });
  });

  it('sem destaque: o título com mais vitórias, sem foto de fundo (a do carro da temporada não tem a nota)', () => {
    expect(pickHighlight(senna, null)).toMatchObject({ season: { year: 1988 }, car: null });
  });

  it('nunca CC BY-SA no fundo: o destaque BY-SA é ignorado e o carro BY-SA não conta', () => {
    expect(coverable(photo(1988, true))).toBe(false);
    const bySa = [season(1988, { title: true, wins: 8, car: null }), season(1989, { wins: 6 })];
    expect(pickHighlight(bySa, { ...photo(1988, true), role: 'highlight_car' } as Photo)).toEqual({
      season: bySa[0],
      car: null,
    });
  });

  it('sem foto compatível em nenhuma: a mais marcante, sem carro (o card usa a cor e o número)', () => {
    expect(pickHighlight([season(1958, { wins: 4 }), season(1961, { wins: 2 })], null)).toEqual({
      season: expect.objectContaining({ year: 1958 }),
      car: null,
    });
    expect(pickHighlight([], null)).toBeNull();
  });
});

describe('lista editorial das lendas', () => {
  const ranked = [{ id: 'ham' }, { id: 'msc' }, { id: 'vet' }, { id: 'sen' }, { id: 'hul' }];
  const f1db = new Map([
    ['ham', ['lewis-hamilton']],
    ['msc', ['michael-schumacher']],
    ['vet', ['sebastian-vettel']],
    ['sen', ['ayrton-senna']],
  ]);
  it('só as da lista, na ordem dela; quem não está na lista ou não tem id do F1DB fica de fora', () => {
    const list = ['ayrton-senna', 'michael-schumacher', 'lewis-hamilton', 'jim-clark'];
    expect(pickListed(ranked, f1db, list).map((d) => d.id)).toEqual(['sen', 'msc', 'ham']);
  });
  it('lista vazia: todas as do critério automático, na ordem dele', () => {
    expect(pickListed(ranked, f1db, []).map((d) => d.id)).toEqual(['ham', 'msc', 'vet', 'sen', 'hul']);
  });
});
