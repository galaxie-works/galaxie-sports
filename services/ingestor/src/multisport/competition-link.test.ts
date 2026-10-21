import { describe, expect, it } from 'vitest';
import { matchSeasonToGames } from './competition-link.js';

const OG = [
  { id: 'g2016', type: 'OG', season: 'summer', year: 2016, startDate: '2016-08-05', endDate: '2016-08-21' },
  { id: 'g2020', type: 'OG', season: 'summer', year: 2020, startDate: '2021-07-23', endDate: '2021-08-08' },
  { id: 'g2024', type: 'OG', season: 'summer', year: 2024, startDate: '2024-07-26', endDate: '2024-08-11' },
];

describe('matchSeasonToGames', () => {
  it('liga pelas datas — o futebol começa antes da abertura', () => {
    const m = matchSeasonToGames({ year: 2016, startDate: '2016-08-03', endDate: '2016-08-20' }, OG);
    expect(m).toEqual({ games: OG[0], matchedBy: 'date_overlap' });
  });

  it('resolve temporada rotulada pelo ano do nome mas jogada depois (Tóquio 2020 em 2021)', () => {
    const m = matchSeasonToGames({ year: 2020, startDate: '2021-07-21', endDate: '2021-08-06' }, OG);
    expect(m?.games.id).toBe('g2020');
  });

  it('corrige rótulo enganoso ("2023" que na verdade é Paris 2024)', () => {
    const m = matchSeasonToGames({ year: 2023, startDate: '2024-07-27', endDate: '2024-08-11' }, OG);
    expect(m?.games.id).toBe('g2024');
  });

  it('sem datas, usa o ano; fora da janela, não liga', () => {
    expect(matchSeasonToGames({ year: 2024, startDate: null, endDate: null }, OG)).toEqual({
      games: OG[2],
      matchedBy: 'year',
    });
    expect(matchSeasonToGames({ year: 2024, startDate: '2024-01-20', endDate: '2024-02-11' }, OG)).toBeNull();
  });
});
