import type { Event } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { splitStakes, type Stake } from './match-stakes';

type Participant = Event['participants'][number];

const HOME = 'aaaaaaaa-0000-7000-8000-000000000001';
const AWAY = 'aaaaaaaa-0000-7000-8000-000000000002';
const sides = [
  { id: HOME, side: 'home' },
  { id: AWAY, side: 'away' },
] as Participant[];

const stake = (o: Partial<Stake> & Pick<Stake, 'code'>): Stake =>
  ({
    team: 'home',
    team_id: HOME,
    text: { 'pt-BR': o.code },
    phase: 'pre_match',
    salient: true,
    ...o,
  }) as Stake;

const titles = (seasons: string[]) => ({ won: seasons.length, seasons, source: 'wikidata' as const });

describe('stakes dos dois times', () => {
  it('o mesmo código nos dois times, na mesma fase, vira um item só', () => {
    const home = stake({ code: 'relegation_risk' });
    const away = stake({ code: 'relegation_risk', team: 'away', team_id: AWAY });
    const { shared, groups } = splitStakes([home, away], sides);
    expect(shared).toEqual([home]);
    expect(groups.map((g) => g.stakes)).toEqual([[], []]);
  });

  it('histórico de títulos com edições diferentes fica no bloco de cada time', () => {
    const home = stake({ code: 'seeks_title_n', titles: titles(['1999', '2020', '2021']) });
    const away = stake({
      code: 'seeks_title_n',
      team: 'away',
      team_id: AWAY,
      titles: titles(['1981', '2019', '2022']),
    });
    const { shared, groups } = splitStakes([home, away], sides);
    expect(shared).toEqual([]);
    expect(groups.map((g) => g.stakes)).toEqual([[home], [away]]);
  });

  it('stake `both` vai para os dois; o de um time só fica no bloco dele', () => {
    const both = stake({ code: 'final', team: 'both', team_id: null });
    const only = stake({ code: 'leader', team: 'away', team_id: AWAY });
    const { shared, groups } = splitStakes([both, only], sides);
    expect(shared).toEqual([both]);
    expect(groups.map((g) => g.stakes)).toEqual([[], [only]]);
  });
});
