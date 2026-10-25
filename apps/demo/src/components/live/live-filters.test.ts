import type { Event } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { createFilterQuery, createFilterRule } from '@/components/reui/filters/filters-query';

import {
  fromFilterQuery,
  groupUpcoming,
  hasLiveFilters,
  liveFilterOptions,
  liveFiltersSearch,
  matchesLiveFilters,
  NO_LIVE_FILTERS,
  parseLiveFilters,
  showsStatus,
  toFilterQuery,
  MAX_TARGETED_SCOPES,
  upcomingScopes,
  type LiveFilters,
} from './live-filters';

/** Só o que os filtros leem do evento. */
function ev(
  id: string,
  sport: string,
  comp: { slug: string; name: string; country: string | null } | null,
  startsAt = '2026-10-25T12:00:00Z',
) {
  return {
    id,
    sport,
    starts_at: startsAt,
    competition: comp
      ? {
          id: `c-${comp.slug}`,
          slug: comp.slug,
          name: comp.name,
          nickname: null,
          logo: null,
          country: comp.country
            ? { code: comp.country, name: comp.country === 'BR' ? 'Brasil' : comp.country, flag: null }
            : null,
        }
      : null,
  } as unknown as Event;
}

const serieA = { slug: 'brasileirao-serie-a', name: 'Brasileirão', country: 'BR' };
const nbb = { slug: 'nbb', name: 'NBB', country: 'BR' };
const liga = { slug: 'liga-profesional', name: 'Liga Profesional', country: 'AR' };
const libertadores = { slug: 'conmebol-libertadores', name: 'Libertadores', country: 'WORLD' };

const EVENTS = [
  ev('1', 'football', serieA),
  ev('2', 'football', serieA),
  ev('3', 'basketball', nbb),
  ev('4', 'football', liga),
  ev('5', 'football', libertadores),
  ev('6', 'mma', null),
];

const f = (over: Partial<LiveFilters>): LiveFilters => ({ ...NO_LIVE_FILTERS, ...over });

describe('filtros do Ao vivo na URL', () => {
  it('lê listas separadas por vírgula, sem repetição, e ignora status desconhecido', () => {
    const p = new URLSearchParams('status=ao-vivo,xyz&esporte=football,,football,mma&pais=br&competicao=nbb');
    expect(parseLiveFilters(p)).toEqual({
      status: ['live'],
      sport: ['football', 'mma'],
      country: ['BR'],
      competition: ['nbb'],
    });
  });

  it('sem parâmetro não há filtro', () => {
    expect(parseLiveFilters(new URLSearchParams(''))).toEqual(NO_LIVE_FILTERS);
    expect(hasLiveFilters(NO_LIVE_FILTERS)).toBe(false);
  });

  it('escreve os filtros e preserva os outros parâmetros', () => {
    const search = liveFiltersSearch(f({ status: ['upcoming'], sport: ['football', 'mma'] }), '?x=1&pais=AR');
    expect(new URLSearchParams(search).toString()).toBe('x=1&status=proximos&esporte=football%2Cmma');
    expect(liveFiltersSearch(NO_LIVE_FILTERS, '')).toBe('');
  });

  it('ida e volta pela URL dá o mesmo filtro', () => {
    const filters = f({ status: ['live'], sport: ['basketball'], country: ['BR'], competition: ['nbb'] });
    expect(parseLiveFilters(new URLSearchParams(liveFiltersSearch(filters)))).toEqual(filters);
  });
});

describe('filtro dos jogos', () => {
  const ids = (filters: LiveFilters) => EVENTS.filter((e) => matchesLiveFilters(e, filters)).map((e) => e.id);

  it('sem filtro passa tudo', () => {
    expect(ids(NO_LIVE_FILTERS)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('combina esporte, país e competição (cada um com escolha múltipla)', () => {
    expect(ids(f({ sport: ['football', 'mma'] }))).toEqual(['1', '2', '4', '5', '6']);
    expect(ids(f({ country: ['BR', 'AR'] }))).toEqual(['1', '2', '3', '4']);
    expect(ids(f({ sport: ['football'], country: ['BR'] }))).toEqual(['1', '2']);
    expect(ids(f({ competition: ['nbb', 'liga-profesional'] }))).toEqual(['3', '4']);
    // jogo sem competição não passa num filtro de país ou competição
    expect(ids(f({ sport: ['mma'], country: ['BR'] }))).toEqual([]);
  });

  it('os dois status equivalem a nenhum', () => {
    expect(showsStatus(NO_LIVE_FILTERS, 'live')).toBe(true);
    expect(showsStatus(f({ status: ['live', 'upcoming'] }), 'upcoming')).toBe(true);
    expect(showsStatus(f({ status: ['live'] }), 'upcoming')).toBe(false);
  });
});

describe('opções dos filtros', () => {
  const label = (slug: string) => slug.toUpperCase();

  it('vêm dos jogos, com contagem, da mais comum para a menos', () => {
    const o = liveFilterOptions(EVENTS, NO_LIVE_FILTERS, label);
    expect(o.sport.map((s) => [s.value, s.label, s.count])).toEqual([
      ['football', 'FOOTBALL', 4],
      ['basketball', 'BASKETBALL', 1],
      ['mma', 'MMA', 1],
    ]);
    expect(o.country.map((c) => c.value)).toEqual(['BR', 'AR', 'WORLD']);
    expect(o.competition[0]).toMatchObject({ value: 'brasileirao-serie-a', label: 'Brasileirão', count: 2 });
  });

  it('país segue o esporte; competição segue esporte e país', () => {
    const o = liveFilterOptions(EVENTS, f({ sport: ['basketball'] }), label);
    expect(o.country.map((c) => c.value)).toEqual(['BR']);
    expect(o.competition.map((c) => c.value)).toEqual(['nbb']);
    const byCountry = liveFilterOptions(EVENTS, f({ country: ['BR'] }), label);
    expect(byCountry.competition.map((c) => c.value)).toEqual(['brasileirao-serie-a', 'nbb']);
    // o esporte não se restringe: dá para trocar de esporte com um país escolhido
    expect(byCountry.sport).toHaveLength(3);
  });

  it('o que está escolhido e não aparece nos jogos continua na lista', () => {
    const o = liveFilterOptions(EVENTS, f({ competition: ['copa-do-brasil'] }), label);
    expect(o.competition.find((c) => c.value === 'copa-do-brasil')).toMatchObject({ count: 0 });
  });
});

describe('ponte com o componente de filtros', () => {
  it('um chip por filtro com valor, e volta igual', () => {
    const filters = f({ status: ['upcoming'], country: ['AR', 'BR'] });
    const query = toFilterQuery(filters);
    expect(query.rules.map((r) => (r.type === 'rule' ? r.path[0] : r.id))).toEqual(['status', 'country']);
    expect(fromFilterQuery(query)).toEqual(filters);
  });

  it('chip ainda sem valor não filtra', () => {
    const query = createFilterQuery([
      createFilterRule({ id: 'a', path: ['sport'], operator: 'is_any_of' }),
      createFilterRule({ id: 'b', path: ['status'], operator: 'is_any_of', value: ['live', 'outro'] }),
    ]);
    expect(fromFilterQuery(query)).toEqual(f({ status: ['live'] }));
  });
});

describe('buscas de próximos', () => {
  const sports = ['football', 'basketball', 'mma'];

  it('sem filtro: uma busca por esporte com jogo nos próximos dias', () => {
    expect(upcomingScopes(NO_LIVE_FILTERS, sports)).toEqual({
      base: [{ sport: 'football' }, { sport: 'basketball' }, { sport: 'mma' }],
      targeted: [],
    });
  });

  it('esporte escolhido fora da agenda também é buscado', () => {
    expect(upcomingScopes(f({ sport: ['hockey'] }), sports).base).toContainEqual({ sport: 'hockey' });
  });

  it('país escolhido: busca filtrada por esporte em cada país (só os esportes escolhidos, se houver)', () => {
    expect(upcomingScopes(f({ country: ['AR'] }), sports).targeted).toEqual([
      { sport: 'football', country: 'AR' },
      { sport: 'basketball', country: 'AR' },
      { sport: 'mma', country: 'AR' },
    ]);
    expect(upcomingScopes(f({ country: ['AR', 'BR'], sport: ['basketball'] }), sports).targeted).toEqual([
      { sport: 'basketball', country: 'AR' },
      { sport: 'basketball', country: 'BR' },
    ]);
  });

  it('competição escolhida: uma busca por competição (vale mais que o país)', () => {
    expect(upcomingScopes(f({ competition: ['nbb', 'laliga'], country: ['AR'] }), sports).targeted).toEqual([
      { competition: 'nbb' },
      { competition: 'laliga' },
    ]);
  });

  it('o número de buscas filtradas tem teto', () => {
    const many = Array.from({ length: 30 }, (_, i) => `s${i}`);
    expect(upcomingScopes(f({ country: ['AR', 'BR'] }), many).targeted).toHaveLength(MAX_TARGETED_SCOPES);
  });
});

describe('próximos por esporte', () => {
  const list = [
    ev('a', 'football', serieA, '2026-10-25T18:00:00Z'),
    ev('b', 'basketball', nbb, '2026-10-25T13:00:00Z'),
    ev('c', 'football', liga, '2026-10-25T12:00:00Z'),
    ev('d', 'football', serieA, '2026-10-25T20:00:00Z'),
    ev('c', 'football', liga, '2026-10-25T12:00:00Z'),
    ev('e', 'hockey', null, '2026-10-25T11:00:00Z'),
  ];

  it('agrupa na ordem da agenda, por horário, sem repetidos e com corte por esporte', () => {
    const groups = groupUpcoming(list, ['football', 'basketball'], 2);
    expect(groups.map((g) => [g.sport, g.total, g.events.map((e) => e.id)])).toEqual([
      ['football', 3, ['c', 'a']],
      ['basketball', 1, ['b']],
      ['hockey', 1, ['e']],
    ]);
  });
});

describe('opções de esporte com a agenda', () => {
  it('esportes com jogo na semana entram mesmo sem jogo carregado, pela contagem da agenda', () => {
    const o = liveFilterOptions(EVENTS, NO_LIVE_FILTERS, (s) => s, [
      { slug: 'football', count: 300 },
      { slug: 'volleyball', count: 12 },
    ]);
    expect(o.sport.map((s) => [s.value, s.count])).toEqual([
      ['football', 300],
      ['volleyball', 12],
      ['basketball', 1],
      ['mma', 1],
    ]);
  });
});
