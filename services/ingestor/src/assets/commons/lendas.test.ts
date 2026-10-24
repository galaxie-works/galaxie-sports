import { describe, expect, it } from 'vitest';
import type { F1dbTables } from '@galaxie/providers';
import type { CommonsFile, WikimediaClient } from './client.js';
import { chassisCategories, discoverCar, findDriverCategory } from './discover.js';
import type { ExtMetadata } from './license.js';
import { mergeEntry, type ManifestEntry } from './manifest.js';
import { mergeRanked } from './map.js';
import {
  highlightSeason,
  surname,
  targetKey,
  targetsFor,
  type CarTarget,
  type DriverTarget,
} from './scope.js';
import { choose, eligible } from './select.js';

/** F1DB mínimo: Senna (3 títulos), Hamilton (empate de vitórias), um piloto sem título e o líder provisório. */
const tables: F1dbTables = {
  driver: [
    { id: 'alain-prost', name: 'Alain Prost', last_name: 'Prost' },
    {
      id: 'ayrton-senna',
      name: 'Ayrton Senna',
      last_name: 'Senna',
      total_championship_wins: 3,
      total_race_wins: 41,
      total_race_starts: 161,
    },
    {
      id: 'lewis-hamilton',
      name: 'Lewis Hamilton',
      last_name: 'Hamilton',
      total_championship_wins: 7,
      total_race_wins: 105,
      total_race_starts: 380,
    },
    {
      id: 'stirling-moss',
      name: 'Stirling Moss',
      last_name: 'Moss',
      total_championship_wins: 0,
      total_race_wins: 16,
      total_race_starts: 66,
    },
    {
      id: 'kimi-antonelli',
      name: 'Kimi Antonelli',
      last_name: 'Antonelli',
      total_championship_wins: 0,
      total_race_wins: 0,
      total_race_starts: 40,
    },
  ],
  constructor: [
    { id: 'mclaren', name: 'McLaren' },
    { id: 'mercedes', name: 'Mercedes' },
    { id: 'vanwall', name: 'Vanwall' },
    { id: 'cooper', name: 'Cooper' },
  ],
  chassis: [
    { id: 'mp4-4', full_name: 'McLaren MP4/4' },
    { id: 'w11', full_name: 'Mercedes F1 W11' },
    { id: 'vw5', full_name: 'Vanwall VW5' },
  ],
  season_driver: [
    { year: 1988, driver_id: 'ayrton-senna', total_race_wins: 8, total_race_starts: 16, position_number: 1 },
    { year: 1990, driver_id: 'ayrton-senna', total_race_wins: 6, total_race_starts: 16, position_number: 1 },
    { year: 1991, driver_id: 'ayrton-senna', total_race_wins: 7, total_race_starts: 16, position_number: 1 },
    {
      year: 2019,
      driver_id: 'lewis-hamilton',
      total_race_wins: 11,
      total_race_starts: 21,
      position_number: 1,
    },
    {
      year: 2020,
      driver_id: 'lewis-hamilton',
      total_race_wins: 11,
      total_race_starts: 16,
      position_number: 1,
    },
    { year: 1958, driver_id: 'stirling-moss', total_race_wins: 4, total_race_starts: 10, position_number: 2 },
    { year: 1957, driver_id: 'stirling-moss', total_race_wins: 3, total_race_starts: 6, position_number: 2 },
    {
      year: 2026,
      driver_id: 'kimi-antonelli',
      total_race_wins: 0,
      total_race_starts: 18,
      position_number: 1,
    },
  ],
  season_driver_standing: [
    { year: 1988, driver_id: 'ayrton-senna', position_number: 1, championship_won: 1 },
    { year: 1990, driver_id: 'ayrton-senna', position_number: 1, championship_won: 1 },
    { year: 1991, driver_id: 'ayrton-senna', position_number: 1, championship_won: 1 },
    { year: 2019, driver_id: 'lewis-hamilton', position_number: 1, championship_won: 1 },
    { year: 2020, driver_id: 'lewis-hamilton', position_number: 1, championship_won: 1 },
    { year: 2026, driver_id: 'kimi-antonelli', position_number: 1, championship_won: 0 },
  ],
  season_entrant_driver: [
    { year: 1988, constructor_id: 'mclaren', driver_id: 'alain-prost', test_driver: 0 },
    { year: 1988, constructor_id: 'mclaren', driver_id: 'ayrton-senna', test_driver: 0 },
    { year: 1990, constructor_id: 'mclaren', driver_id: 'ayrton-senna', test_driver: 0 },
    { year: 1991, constructor_id: 'mclaren', driver_id: 'ayrton-senna', test_driver: 0 },
    { year: 2019, constructor_id: 'mercedes', driver_id: 'lewis-hamilton', test_driver: 0 },
    { year: 2020, constructor_id: 'mercedes', driver_id: 'lewis-hamilton', test_driver: 0 },
    { year: 1958, constructor_id: 'cooper', driver_id: 'stirling-moss', test_driver: 0, rounds: '1' },
    {
      year: 1958,
      constructor_id: 'vanwall',
      driver_id: 'stirling-moss',
      test_driver: 0,
      rounds: '2;3;5;6;7;8;9;10;11',
    },
    { year: 1957, constructor_id: 'vanwall', driver_id: 'stirling-moss', test_driver: 0 },
  ],
  season_entrant_chassis: [
    { year: 1988, constructor_id: 'mclaren', chassis_id: 'mp4-4' },
    { year: 2020, constructor_id: 'mercedes', chassis_id: 'w11' },
    { year: 1958, constructor_id: 'vanwall', chassis_id: 'vw5' },
  ],
};

describe('carro de destaque', () => {
  it('título com mais vitórias; empate pelo aproveitamento; sem título, a de mais vitórias, na equipe de mais rodadas', () => {
    expect(highlightSeason(tables, 'ayrton-senna')).toMatchObject({ target: 'car/mclaren/1988', year: 1988 });
    expect(highlightSeason(tables, 'lewis-hamilton')).toMatchObject({
      target: 'car/mercedes/2020',
      year: 2020,
    });
    expect(highlightSeason(tables, 'stirling-moss')).toEqual({
      target: 'car/vanwall/1958',
      year: 1958,
      reason: '4 vitória(s) em 10 corrida(s) em 1958',
      entrant: null,
    });
  });
});

describe('escopo antigos', () => {
  it('1950–1989: campeões, depois vencedores de GP, com os carros de destaque; sem vitória nem 3 temporadas, fora', () => {
    expect(targetsFor(tables, 'antigos').map(targetKey)).toEqual([
      'driver/ayrton-senna',
      'driver/stirling-moss',
      'car/mclaren/1988',
      'car/vanwall/1958',
    ]);
  });
});

describe('escopo lendas', () => {
  const targets = targetsFor(tables, 'lendas', 3);
  const keys = targets.map(targetKey);

  it('todos os campeões (só título decidido), os de mais vitórias e de mais GPs, e o carro de destaque de cada um', () => {
    expect(keys).toEqual([
      'driver/lewis-hamilton',
      'driver/ayrton-senna',
      'driver/stirling-moss',
      'car/mercedes/2020',
      'car/mclaren/1988',
      'car/vanwall/1958',
    ]);
    // o líder da temporada em andamento não é campeão nem está entre os 3 de mais GPs
    expect(keys).not.toContain('driver/kimi-antonelli');
  });

  it('o carro sabe de quem é o destaque', () => {
    const car = targets.find((t) => targetKey(t) === 'car/mclaren/1988') as CarTarget;
    expect(car.driver).toEqual({ f1dbId: 'ayrton-senna', name: 'Ayrton Senna', lastName: 'Senna' });
    expect(car.chassis).toEqual(['McLaren MP4/4']);
  });

  it('campeoes também não conta o líder provisório', () => {
    expect(targetsFor(tables, 'campeoes').map(targetKey)).not.toContain('driver/kimi-antonelli');
  });
});

describe('curadoria do carro de destaque no manifesto', () => {
  const senna = targetsFor(tables, 'lendas', 3).find((t) => t.f1dbId === 'ayrton-senna') as DriverTarget;
  const d = { target: senna, wikidata: null, category: 'Ayrton Senna', candidates: [], note: null };

  it('auto vem da regra; manual fica nas próximas varreduras', () => {
    const auto = mergeEntry(senna, d, [], undefined);
    expect(auto.highlight_car).toEqual({
      target: 'car/mclaren/1988',
      season: 1988,
      reason: 'título de 1988 · 8 vitória(s) em 16 corrida(s)',
      match: 'auto',
      // os outros títulos, se o carro de 1988 não tiver foto para o fundo
      fallbacks: [
        {
          target: 'car/mclaren/1991',
          season: 1991,
          reason: 'título de 1991 · 7 vitória(s) em 16 corrida(s)',
        },
        {
          target: 'car/mclaren/1990',
          season: 1990,
          reason: 'título de 1990 · 6 vitória(s) em 16 corrida(s)',
        },
      ],
    });
    const manual = {
      target: 'car/mclaren/1991',
      season: 1991,
      reason: 'escolha editorial',
      match: 'manual' as const,
    };
    expect(mergeEntry(senna, d, [], { ...auto, highlight_car: manual }).highlight_car).toEqual(manual);
  });
});

describe('foto do carro com o piloto', () => {
  const meta: ExtMetadata = {
    License: { value: 'cc-by-2.0' },
    LicenseShortName: { value: 'CC BY 2.0' },
    Artist: { value: 'Fotógrafo' },
    DateTimeOriginal: { value: '1988-07-10' },
  };
  const file = (title: string): CommonsFile => ({
    title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    url: 'https://upload.wikimedia.org/x.jpg',
    thumbUrl: 'https://upload.wikimedia.org/thumb/x.jpg',
    thumbWidth: 512,
    thumbHeight: 384,
    width: 1600,
    height: 1200,
    mime: 'image/jpeg',
    extmetadata: meta,
    categories: [],
  });
  /** Commons falsa: a categoria do chassi tem uma foto solta e uma subcategoria com o Senna. */
  const client = {
    categoryExists: async () => true,
    get: async () => ({
      query: {
        categorymembers: [
          { ns: 6, title: 'File:MP4-4 Prost Monaco.jpg' },
          { ns: 14, title: 'Category:McLaren MP4/4 driven by Ayrton Senna' },
        ],
      },
    }),
    categoryFiles: async () => ['File:MP4-4 Suzuka 1988.jpg'],
    imageInfo: async (titles: string[]) => titles.map(file),
  } as unknown as WikimediaClient;

  it('a foto que cita o piloto (título ou categoria) vem primeiro; a que cita outro piloto sai', async () => {
    const car = targetsFor(tables, 'lendas', 3).find((t) => targetKey(t) === 'car/mclaren/1988') as CarTarget;
    const d = await discoverCar(client, car, 512);
    expect(d.candidates.map((c) => [c.file.title, !!c.featured, !!c.other])).toEqual([
      ['File:MP4-4 Suzuka 1988.jpg', true, false],
      ['File:MP4-4 Prost Monaco.jpg', false, true],
    ]);
    const { ok, rejected } = eligible(d);
    expect(rejected).toEqual([
      { title: 'File:MP4-4 Prost Monaco.jpg', reason: 'cita outro piloto da temporada' },
    ]);
    expect(choose(d, ok, null).map((c) => c.eligible.candidate.file.title)).toEqual([
      'File:MP4-4 Suzuka 1988.jpg',
    ]);
  });
});

describe('chassi com outro nome na Commons', () => {
  it('Racing Bulls VCARB 03 é "RB VCARB 03" na Commons: a categoria dela vale, sem buscar o nome do F1DB', async () => {
    const asked: string[] = [];
    const client = {
      categoryExists: async (c: string) => (asked.push(c), c === 'RB VCARB 03'),
      get: async () => ({
        query: { categorymembers: [{ ns: 6, title: 'File:VCARB 03 Lindblad Melbourne.jpg' }] },
      }),
      categoryFiles: async () => [],
      imageInfo: async (titles: string[]) =>
        titles.map((title) => ({ title, extmetadata: {}, categories: [] }) as unknown as CommonsFile),
    } as unknown as WikimediaClient;
    const car: CarTarget = {
      kind: 'car',
      f1dbId: 'racing-bulls',
      constructorName: 'Racing Bulls',
      year: 2026,
      chassis: ['Racing Bulls VCARB 03'],
    };
    const d = await discoverCar(client, car, 512);
    expect(d.category).toBe('RB VCARB 03');
    expect(d.candidates.map((c) => c.file.title)).toEqual(['File:VCARB 03 Lindblad Melbourne.jpg']);
    expect(asked).toEqual(['RB VCARB 03']);
  });
});

describe('foto principal sem a API do Wikidata', () => {
  const vettel: DriverTarget = {
    kind: 'driver',
    f1dbId: 'sebastian-vettel',
    name: 'Sebastian Vettel',
    dateOfBirth: '1987-07-03',
    seasons: [2007, 2013, 2022],
    highlight: null,
  };
  const client = (birth: string) =>
    ({
      get: async () => ({
        query: {
          pages: [
            {
              title: 'Category:Sebastian Vettel',
              categories: [
                { title: 'Category:Formula One drivers from Germany' },
                { title: 'Category:1987 births' },
              ],
              pageprops: { wikibase_item: 'Q8235063' },
            },
          ],
        },
      }),
      entityClaims: async (id: string) =>
        id === 'Q8235063'
          ? { P301: [{ mainsnak: { datavalue: { value: { id: 'Q9671' } } } }] }
          : {
              P18: [{ mainsnak: { datavalue: { value: 'Sebastian Vettel 2015 Malaysia podium.jpg' } } }],
              P569: [{ mainsnak: { datavalue: { value: { time: `+${birth}T00:00:00Z` } } } }],
            },
    }) as unknown as WikimediaClient;

  it('categoria da Commons → item da categoria → a pessoa, conferida pela data de nascimento', async () => {
    expect(await findDriverCategory(client('1987-07-03'), vettel)).toEqual({
      id: 'Q9671',
      image: ['File:Sebastian Vettel 2015 Malaysia podium.jpg'],
      category: 'Sebastian Vettel',
    });
  });

  it('data de nascimento diferente: fica a categoria, sem a foto principal', async () => {
    expect(await findDriverCategory(client('1990-01-01'), vettel)).toEqual({
      id: null,
      image: [],
      category: 'Sebastian Vettel',
    });
  });
});

describe('categoria do chassi com outro nome na Commons', () => {
  const search = (titles: string[]) =>
    ({
      get: async () => ({ query: { search: titles.map((t) => ({ title: `Category:${t}` })) } }),
    }) as unknown as WikimediaClient;

  it('construtor e o mesmo chassi, com fronteira; a do carro antes das de piloto', async () => {
    const ferrari = search([
      'Ferrari 312 T3',
      'Ferrari 312 T of Niki Lauda in 1975',
      'Ferrari 312 T',
      'Ferrari 312T',
      'Robert M. Rubin',
      'Ferrari 312 T models',
    ]);
    expect(await chassisCategories(ferrari, 'Ferrari', 'Ferrari 312T')).toEqual([
      'Ferrari 312T',
      'Ferrari 312 T',
      'Ferrari 312 T of Niki Lauda in 1975',
    ]);
    const mercedes = search([
      'Mercedes-AMG F1 W11 EQ Performance',
      'Mercedes-AMG F1 W11 EQ Performance of Lewis Hamilton',
      'Mercedes AMG F1 W10 EQ Power+',
      'Mercedes-AMG F1 W12 E Performance',
    ]);
    expect(await chassisCategories(mercedes, 'Mercedes', 'Mercedes F1 W11')).toEqual([
      'Mercedes-AMG F1 W11 EQ Performance',
      'Mercedes-AMG F1 W11 EQ Performance of Lewis Hamilton',
    ]);
    // sem o construtor no nome, não serve (o "158" de outra coisa)
    expect(
      await chassisCategories(search(['158', 'Antonov An-158']), 'Alfa Romeo', 'Alfa Romeo 158'),
    ).toEqual([]);
  });
});

describe('carro de destaque: chassi da equipe e regras de foto', () => {
  it('só o chassi da equipe do piloto (Ascari 1952: Scuderia Ferrari, não a 125 privada)', () => {
    const t = targetsFor(
      {
        driver: [
          { id: 'alberto-ascari', name: 'Alberto Ascari', last_name: 'Ascari', total_championship_wins: 2 },
        ],
        constructor: [{ id: 'ferrari', name: 'Ferrari' }],
        chassis: [
          { id: 'ferrari-500', full_name: 'Ferrari 500' },
          { id: 'ferrari-125', full_name: 'Ferrari 125' },
        ],
        season_driver: [
          { year: 1952, driver_id: 'alberto-ascari', total_race_wins: 6, total_race_starts: 7 },
        ],
        season_driver_standing: [{ year: 1952, driver_id: 'alberto-ascari', championship_won: 1 }],
        season_entrant_driver: [
          {
            year: 1952,
            constructor_id: 'ferrari',
            entrant_id: 'scuderia-ferrari',
            driver_id: 'alberto-ascari',
            test_driver: 0,
            rounds: '2;3;4;5;6;7;8',
          },
        ],
        season_entrant_chassis: [
          { year: 1952, constructor_id: 'ferrari', entrant_id: 'peter-whitehead', chassis_id: 'ferrari-125' },
          {
            year: 1952,
            constructor_id: 'ferrari',
            entrant_id: 'scuderia-ferrari',
            chassis_id: 'ferrari-500',
          },
        ],
      },
      'lendas',
    );
    expect((t.find((x) => x.kind === 'car') as CarTarget).chassis).toEqual(['Ferrari 500']);
  });

  it('sobrenome sem Jr./Sr. para casar com a foto', () => {
    expect(surname('Sainz Jr.')).toBe('Sainz');
    expect(surname('Hill')).toBe('Hill');
  });

  it('miniatura (diecast) não é foto do carro', () => {
    const d = {
      target: targetsFor(tables, 'lendas', 3).find((x) => x.kind === 'car')!,
      wikidata: null,
      category: 'x',
      note: null,
      candidates: [
        {
          file: {
            title: 'File:Diecast Jordan EJ13.jpg',
            pageUrl: 'https://commons.wikimedia.org/wiki/File:Diecast_Jordan_EJ13.jpg',
            url: 'https://upload.wikimedia.org/x.jpg',
            thumbUrl: 'https://upload.wikimedia.org/thumb/x.jpg',
            thumbWidth: 512,
            thumbHeight: 384,
            width: 1600,
            height: 1200,
            mime: 'image/jpeg',
            extmetadata: {
              License: { value: 'cc-by-2.0' },
              LicenseShortName: { value: 'CC BY 2.0' },
              Artist: { value: 'X' },
            },
            categories: [],
          },
          season: 2003,
          wikidataImage: false,
          portraitCategory: false,
        },
      ],
    };
    expect(eligible(d).rejected.map((r) => r.reason)).toEqual([
      'título indica que não é foto do piloto/carro',
    ]);
  });
});

describe('ordenar na VPS com o manifesto novo', () => {
  const entry = (target: string, over: Partial<ManifestEntry> = {}): ManifestEntry => ({
    target,
    kind: 'driver',
    f1db_id: target.split('/')[1]!,
    name: target,
    wikidata: null,
    category: null,
    photos: [],
    ...over,
  });
  it('alvos novos da entrada; os já ordenados no volume ficam, com o carro de destaque novo', () => {
    const highlight = { target: 'car/mclaren/1988', season: 1988, reason: 'título', match: 'auto' as const };
    const ranked = { by: 'gemini' as const, model: 'm', at: '2026-10-24', pool: 12 };
    const merged = mergeRanked(
      [entry('driver/ayrton-senna', { highlight_car: highlight }), entry('driver/lewis-hamilton')],
      [entry('driver/ayrton-senna', { ranking: ranked, note: 'do volume' }), entry('driver/johnny-dumfries')],
    );
    expect(
      merged.map((e) => [e.target, e.ranking?.by ?? null, e.highlight_car?.target ?? null, e.note ?? null]),
    ).toEqual([
      ['driver/ayrton-senna', 'gemini', 'car/mclaren/1988', 'do volume'],
      ['driver/lewis-hamilton', null, null, null],
    ]);
  });
});
