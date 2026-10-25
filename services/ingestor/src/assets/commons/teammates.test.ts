/**
 * Carro de destaque de mais de um piloto (companheiros de equipe com o mesmo carro, ou os dois do grid atual) e as
 * proteções do manifesto contra a descoberta vazia. Sem rede: F1DB mínimo e Commons falsa.
 */
import { describe, expect, it } from 'vitest';
import type { F1dbTables } from '@galaxie/providers';
import type { CommonsFile, WikimediaClient } from './client.js';
import { citesDriver } from './cites.js';
import { discoverCar, discoverDriver, type Discovery } from './discover.js';
import { highlightPhoto, pickHighlight } from './import.js';
import type { HighlightCar, ManifestEntry, ManifestPhoto } from './manifest.js';
import { mapCommons, mergeRanked } from './map.js';
import { mergeCarTarget, targetKey, targetsFor, type CarTarget, type DriverTarget } from './scope.js';
import { choose, eligible } from './select.js';

/** Red Bull 2023: Verstappen campeão (19 vitórias) e Pérez (2 vitórias); Hamilton na Mercedes. */
const tables: F1dbTables = {
  driver: [
    {
      id: 'max-verstappen',
      name: 'Max Verstappen',
      last_name: 'Verstappen',
      total_championship_wins: 1,
      total_race_wins: 19,
      total_race_starts: 22,
    },
    {
      id: 'sergio-perez',
      name: 'Sergio Pérez',
      last_name: 'Pérez',
      total_championship_wins: 0,
      total_race_wins: 2,
      total_race_starts: 22,
    },
    {
      id: 'lewis-hamilton',
      name: 'Lewis Hamilton',
      last_name: 'Hamilton',
      total_championship_wins: 0,
      total_race_wins: 0,
      total_race_starts: 22,
    },
  ],
  constructor: [
    { id: 'red-bull', name: 'Red Bull' },
    { id: 'mercedes', name: 'Mercedes' },
  ],
  chassis: [
    { id: 'rb19', full_name: 'Red Bull RB19' },
    { id: 'w14', full_name: 'Mercedes F1 W14' },
  ],
  season_driver: [
    {
      year: 2023,
      driver_id: 'max-verstappen',
      total_race_wins: 19,
      total_race_starts: 22,
      position_number: 1,
    },
    { year: 2023, driver_id: 'sergio-perez', total_race_wins: 2, total_race_starts: 22, position_number: 2 },
    {
      year: 2023,
      driver_id: 'lewis-hamilton',
      total_race_wins: 0,
      total_race_starts: 22,
      position_number: 3,
    },
  ],
  season_driver_standing: [
    { year: 2023, driver_id: 'max-verstappen', position_number: 1, championship_won: 1 },
    { year: 2023, driver_id: 'sergio-perez', position_number: 2, championship_won: 0 },
  ],
  season_entrant_driver: [
    {
      year: 2023,
      constructor_id: 'red-bull',
      entrant_id: 'red-bull',
      driver_id: 'max-verstappen',
      test_driver: 0,
    },
    {
      year: 2023,
      constructor_id: 'red-bull',
      entrant_id: 'red-bull',
      driver_id: 'sergio-perez',
      test_driver: 0,
    },
    {
      year: 2023,
      constructor_id: 'mercedes',
      entrant_id: 'mercedes',
      driver_id: 'lewis-hamilton',
      test_driver: 0,
    },
  ],
  season_entrant_chassis: [
    { year: 2023, constructor_id: 'red-bull', entrant_id: 'red-bull', chassis_id: 'rb19' },
    { year: 2023, constructor_id: 'mercedes', entrant_id: 'mercedes', chassis_id: 'w14' },
  ],
};

describe('carro de destaque dos dois companheiros (Red Bull 2023)', () => {
  const targets = targetsFor(tables, 'lendas', 3);
  const rb = targets.find((t) => targetKey(t) === 'car/red-bull/2023') as CarTarget;

  it('um alvo só, com os dois pilotos; o companheiro não é "outro piloto"', () => {
    expect(targets.map(targetKey).filter((k) => k === 'car/red-bull/2023')).toHaveLength(1);
    expect(rb.drivers?.map((d) => d.f1dbId)).toEqual(['max-verstappen', 'sergio-perez']);
    // a foto do Pérez não é mais recusada como "cita outro piloto da temporada"; a do Hamilton continua
    expect(rb.others).toEqual(['Hamilton']);
  });

  it('juntar o mesmo alvo de novo não duplica o piloto; alvo de piloto não muda', () => {
    const copy = structuredClone(rb);
    mergeCarTarget(copy, rb);
    expect(copy.drivers).toHaveLength(2);
    const driver = targets.find((t) => t.kind === 'driver') as DriverTarget;
    const before = structuredClone(driver);
    mergeCarTarget(driver, rb);
    expect(driver).toEqual(before);
  });

  const file = (title: string, license = 'cc-by-4.0'): CommonsFile => ({
    title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    url: 'https://upload.wikimedia.org/x.jpg',
    thumbUrl: 'https://upload.wikimedia.org/thumb/x.jpg',
    thumbWidth: 512,
    thumbHeight: 384,
    width: 1600,
    height: 1200,
    mime: 'image/jpeg',
    extmetadata: {
      License: { value: license },
      LicenseShortName: { value: license.toUpperCase() },
      Artist: { value: 'Fotógrafo' },
      DateTimeOriginal: { value: '2023-07-02' },
    },
    categories: [],
  });

  it('a escolha guarda também a melhor para o fundo de cada piloto (a do Pérez não fica de fora)', () => {
    const titles = ['Verstappen A', 'Verstappen B', 'Verstappen C', 'Verstappen D', 'Perez Baku'];
    const d: Discovery = {
      target: rb,
      wikidata: null,
      category: 'Red Bull RB19',
      note: null,
      candidates: titles.map((t) => ({
        file: file(`File:${t}.jpg`),
        season: 2023,
        wikidataImage: false,
        portraitCategory: false,
        featured: true,
        drivers: [t.startsWith('Perez') ? 'sergio-perez' : 'max-verstappen'],
      })),
    };
    const chosen = choose(d, eligible(d).ok, [
      { index: 0, kind: 'car', keep: true, quality: 9, hero: 0.9 },
      { index: 1, kind: 'car', keep: true, quality: 9, hero: 0.8 },
      { index: 2, kind: 'car', keep: true, quality: 9, hero: 0.7 },
      { index: 3, kind: 'car', keep: true, quality: 8, hero: 0.6 },
      { index: 4, kind: 'car', keep: true, quality: 5, hero: 0.7 },
    ]);
    expect(chosen.map((c) => c.eligible.candidate.file.title)).toEqual([
      'File:Verstappen A.jpg',
      'File:Verstappen B.jpg',
      'File:Verstappen C.jpg',
      'File:Perez Baku.jpg',
    ]);
  });

  describe('na importação, cada piloto leva ao fundo a foto que o cita', () => {
    const photo = (file: string, o: Partial<ManifestPhoto> = {}) =>
      ({ file, match: 'auto', share_alike: false, hero: 0.8, ...o }) as ManifestPhoto;
    const driver = (id: string, name: string): ManifestEntry =>
      ({
        target: `driver/${id}`,
        kind: 'driver',
        f1db_id: id,
        name,
        wikidata: null,
        category: null,
        photos: [],
        highlight_car: { target: 'car/red-bull/2023', season: 2023, reason: 'r', match: 'auto' },
      }) as ManifestEntry;
    const manifestWith = (photos: ManifestPhoto[]) => {
      const entries = [
        driver('max-verstappen', 'Max Verstappen'),
        driver('sergio-perez', 'Sergio Pérez'),
        { target: 'car/red-bull/2023', kind: 'car', photos } as ManifestEntry,
      ];
      return new Map(entries.map((e) => [e.target, e]));
    };
    const fundo = (byTarget: Map<string, ManifestEntry>, id: string) =>
      pickHighlight(byTarget.get(`driver/${id}`)!, byTarget)?.photo.file ?? null;

    it('Verstappen e Pérez com fotos próprias: cada um a sua, mesmo com nota menor', () => {
      const byTarget = manifestWith([
        photo('File:FIA F1 Austria 2023 Nr. 1 Verstappen.jpg', { hero: 0.95 }),
        // manifesto novo: o piloto citado vem registrado (pela categoria, sem o nome no título)
        photo('File:FIA F1 Austria 2023 Nr. 11 (2).jpg', { hero: 0.6, drivers: ['sergio-perez'] }),
        photo('File:RB19 exposição.jpg', { hero: 0.7 }),
      ]);
      expect(fundo(byTarget, 'max-verstappen')).toBe('File:FIA F1 Austria 2023 Nr. 1 Verstappen.jpg');
      expect(fundo(byTarget, 'sergio-perez')).toBe('File:FIA F1 Austria 2023 Nr. 11 (2).jpg');
    });

    it('sem foto própria: a que não cita ninguém, nunca a do companheiro', () => {
      const byTarget = manifestWith([
        photo('File:Verstappen Zandvoort 2023.jpg', { hero: 0.95 }),
        photo('File:RB19 exposição.jpg', { hero: 0.6 }),
      ]);
      expect(fundo(byTarget, 'sergio-perez')).toBe('File:RB19 exposição.jpg');
      const soDoOutro = manifestWith([photo('File:Verstappen Zandvoort 2023.jpg', { hero: 0.95 })]);
      expect(fundo(soDoOutro, 'sergio-perez')).toBeNull();
      // o sobrenome com acento casa sem ele ("Pérez" × "Perez")
      const semAcento = manifestWith([photo('File:Perez_Monaco_2023.jpg', { hero: 0.7 })]);
      expect(fundo(semAcento, 'max-verstappen')).toBeNull();
      expect(fundo(semAcento, 'sergio-perez')).toBe('File:Perez_Monaco_2023.jpg');
    });
  });
});

describe('licença conferida na importação vale para o fundo', () => {
  it('a que virou CC BY-SA na Commons não vai ao fundo; fica a próxima compatível', () => {
    const car = {
      target: 'car/red-bull/2023',
      photos: [
        { file: 'File:A.jpg', match: 'auto', share_alike: false, hero: 0.9 },
        { file: 'File:B.jpg', match: 'auto', share_alike: false, hero: 0.7 },
      ],
    } as ManifestEntry;
    expect(highlightPhoto(car, { scored: true })?.file).toBe('File:A.jpg');
    const free = (p: ManifestPhoto) => p.file !== 'File:A.jpg';
    expect(highlightPhoto(car, { scored: true, free })?.file).toBe('File:B.jpg');
    const entry = {
      target: 'driver/x',
      kind: 'driver',
      f1db_id: 'x',
      name: 'X Y',
      wikidata: null,
      category: null,
      photos: [],
      highlight_car: {
        target: 'car/red-bull/2023',
        season: 2023,
        reason: 'r',
        match: 'auto',
      } as HighlightCar,
    } as ManifestEntry;
    const byTarget = new Map([[car.target, car]]);
    expect(pickHighlight(entry, byTarget, { free })?.photo.file).toBe('File:B.jpg');
    // curadoria com a foto apontada: também pela licença conferida
    const curated = {
      ...entry,
      highlight_car: { ...entry.highlight_car!, match: 'manual' as const, file: 'File:A.jpg' },
    };
    expect(pickHighlight(curated, byTarget, { free })).toBeUndefined();
  });
});

describe('ordenar na VPS: destaque que saiu da entrada', () => {
  const ranked = { by: 'gemini' as const, model: 'm', at: '2026-10-24', pool: 12 };
  const entry = (o: Partial<ManifestEntry> = {}): ManifestEntry => ({
    target: 'driver/ayrton-senna',
    kind: 'driver',
    f1db_id: 'ayrton-senna',
    name: 'Ayrton Senna',
    wikidata: null,
    category: null,
    photos: [],
    ...o,
  });
  const h = (match: 'auto' | 'manual'): HighlightCar => ({
    target: 'car/mclaren/1988',
    season: 1988,
    reason: 'título',
    match,
  });

  it('sai também do alvo ordenado; a curadoria manual da execução anterior fica', () => {
    const [auto] = mergeRanked([entry()], [entry({ ranking: ranked, highlight_car: h('auto') })]);
    expect(auto).not.toHaveProperty('highlight_car');
    expect(auto!.ranking).toEqual(ranked);
    const [manual] = mergeRanked([entry()], [entry({ ranking: ranked, highlight_car: h('manual') })]);
    expect(manual!.highlight_car).toEqual(h('manual'));
    const [explicitNull] = mergeRanked(
      [entry({ highlight_car: null })],
      [entry({ ranking: ranked, highlight_car: h('auto') })],
    );
    expect(explicitNull).not.toHaveProperty('highlight_car');
    // `highlight_car: null` explícito no git tira também a curadoria manual
    const [manualOff] = mergeRanked(
      [entry({ highlight_car: null })],
      [entry({ ranking: ranked, highlight_car: h('manual') })],
    );
    expect(manualOff).not.toHaveProperty('highlight_car');
  });
});

describe('sobrenome que é o nome do carro (Brabham, McLaren, Surtees)', () => {
  const brabham = { name: 'Jack Brabham', surname: 'Brabham' };
  const carNames = ['Brabham 1970', 'Brabham BT33', 'brabham'];

  it('só o nome inteiro ou o possessivo cita o piloto-construtor; outro sobrenome vale como palavra inteira', () => {
    expect(citesDriver('1971 Brabham BT33 (19698941594).jpg', brabham, carNames)).toBe(false);
    expect(citesDriver('Jack Brabham, Zandvoort 1970.jpg', brabham, carNames)).toBe(true);
    expect(citesDriver("1970 Italian GP - Brabham's Brabham-Ford BT33.jpg", brabham, carNames)).toBe(true);
    // fora do carro dele, o sobrenome basta
    expect(citesDriver('Brabham at 1964 Dutch Grand Prix.jpg', brabham, ['Cooper T53'])).toBe(true);
    // palavra inteira: "Hill" não casa com "Hillclimb"
    const hill = { name: 'Graham Hill', surname: 'Hill' };
    expect(citesDriver('Shelsley Walsh Hillclimb.jpg', hill, ['Lotus 49'])).toBe(false);
    expect(citesDriver('Graham_Hill_Lotus.jpg', hill, ['Lotus 49'])).toBe(true);
  });

  it('car/brabham/1970: a foto só do carro serve a de Klerk e Stommelen; a do Jack fica com ele', () => {
    const driver = (id: string, name: string): ManifestEntry => ({
      target: `driver/${id}`,
      kind: 'driver',
      f1db_id: id,
      name,
      wikidata: null,
      category: null,
      photos: [],
      highlight_car: { target: 'car/brabham/1970', season: 1970, reason: 'r', match: 'auto' },
    });
    const photo = (file: string, hero: number) =>
      ({ file, match: 'auto', share_alike: false, hero }) as ManifestPhoto;
    const car: ManifestEntry = {
      target: 'car/brabham/1970',
      kind: 'car',
      f1db_id: 'brabham',
      name: 'Brabham 1970',
      season: 1970,
      wikidata: null,
      category: 'Brabham BT33',
      photos: [
        photo('File:1971 Brabham BT33 (19698941594).jpg', 0.8),
        photo("File:1970 Italian GP - Brabham's Brabham-Ford BT33.jpg", 0.7),
      ],
    };
    const entries = [
      driver('jack-brabham', 'Jack Brabham'),
      driver('peter-de-klerk', 'Peter de Klerk'),
      driver('rolf-stommelen', 'Rolf Stommelen'),
      car,
    ];
    const byTarget = new Map(entries.map((e) => [e.target, e]));
    const fundo = (id: string) => pickHighlight(byTarget.get(`driver/${id}`)!, byTarget)?.photo.file;
    expect(fundo('jack-brabham')).toBe("File:1970 Italian GP - Brabham's Brabham-Ford BT33.jpg");
    expect(fundo('peter-de-klerk')).toBe('File:1971 Brabham BT33 (19698941594).jpg');
    expect(fundo('rolf-stommelen')).toBe('File:1971 Brabham BT33 (19698941594).jpg');
  });

  it('na descoberta: a categoria do chassi não faz toda foto citar o Jack, nem recusar como "outro piloto"', async () => {
    const target: CarTarget = {
      kind: 'car',
      f1dbId: 'mclaren',
      constructorName: 'McLaren',
      year: 1970,
      chassis: ['McLaren M14A'],
      drivers: [{ f1dbId: 'denny-hulme', name: 'Denny Hulme', lastName: 'Hulme' }],
      // Bruce McLaren correu 1970 e é "outro piloto" do destaque do Hulme
      others: ['McLaren', 'Gurney'],
    };
    const files = ['File:McLaren M14A Brands Hatch.jpg', 'File:Hulme M14A 1970.jpg', 'File:Gurney M14A.jpg'];
    const client = {
      categoryExists: async (c: string) => c === 'McLaren M14A',
      get: async () => ({
        query: { categorymembers: files.map((title) => ({ ns: 6, title })) },
      }),
      categoryFiles: async () => [],
      imageInfo: async (titles: string[]) =>
        titles.map((title) => ({ title, width: 1600, height: 1200, mime: 'image/jpeg', extmetadata: {} })),
    } as unknown as WikimediaClient;
    const d = await discoverCar(client, target, 512);
    const by = new Map(d.candidates.map((c) => [c.file.title, c]));
    expect(by.get('File:McLaren M14A Brands Hatch.jpg')!.other).toBeUndefined();
    expect(by.get('File:Hulme M14A 1970.jpg')).toMatchObject({ featured: true, drivers: ['denny-hulme'] });
    expect(by.get('File:Gurney M14A.jpg')!.other).toBe(true);
  });
});

describe('outros pilotos no carro de vários destaques: interseção', () => {
  it('o carro da equipe do grid (sem recusas) continua sem recusar ninguém; os pilotos em ordem de id', () => {
    const generic: CarTarget = {
      kind: 'car',
      f1dbId: 'red-bull',
      constructorName: 'Red Bull',
      year: 2026,
      chassis: ['Red Bull Racing RB22'],
    };
    mergeCarTarget(generic, {
      ...generic,
      drivers: [{ f1dbId: 'isack-hadjar', name: 'Isack Hadjar', lastName: 'Hadjar' }],
      others: ['Lawson', 'Russell'],
    });
    expect(generic.others).toBeUndefined();
    const v: CarTarget = {
      ...generic,
      drivers: [{ f1dbId: 'max-verstappen', name: 'Max Verstappen', lastName: 'Verstappen' }],
      others: ['Pérez', 'Hamilton', 'Lawson'],
    };
    mergeCarTarget(v, {
      ...generic,
      drivers: [{ f1dbId: 'liam-lawson', name: 'Liam Lawson', lastName: 'Lawson' }],
      others: ['Verstappen', 'Hamilton'],
    });
    expect(v.drivers!.map((d) => d.f1dbId)).toEqual(['liam-lawson', 'max-verstappen']);
    expect(v.others).toEqual(['Hamilton']);
  });
});

describe('descoberta vazia não apaga a galeria do manifesto (Stefan Johansson)', () => {
  const johansson: DriverTarget = {
    kind: 'driver',
    f1dbId: 'stefan-johansson',
    name: 'Stefan Johansson',
    dateOfBirth: '1956-09-08',
    seasons: [1980, 1985, 1991],
    highlight: null,
  };
  const before: ManifestEntry = {
    target: 'driver/stefan-johansson',
    kind: 'driver',
    f1db_id: 'stefan-johansson',
    name: 'Stefan Johansson',
    wikidata: null,
    category: 'Stefan Johansson',
    note: 'identificado pela categoria da Commons',
    photos: [
      {
        file: 'File:Stefan Johansson 1985.jpg',
        role: 'portrait',
        season: 1985,
        rank: 0,
        match: 'auto',
        selected_by: 'gemini',
        page_url: 'https://commons.wikimedia.org/wiki/File:Stefan_Johansson_1985.jpg',
        license: 'CC BY 2.0',
        license_url: null,
        author: 'A',
        author_url: null,
        credit: null,
        attribution_required: true,
        share_alike: false,
        date: '1985-01-01',
        width: 1600,
        height: 1200,
      },
    ],
  };
  const previous = {
    schema_version: 1,
    acervo: { id: 'commons-f1', name: 't', source: 's', revision: 'r' },
    generated_at: '2026-10-22T00:00:00Z',
    entries: [before],
  };

  it('nenhuma candidata (também com --refazer): a entrada anterior fica (proteção do #299)', async () => {
    const discover = async (): Promise<Discovery> => ({
      target: johansson,
      wikidata: null,
      category: null,
      candidates: [],
      note: 'sem item conferido no Wikidata',
    });
    for (const redo of [false, true]) {
      const { manifest, stats } = await mapCommons({} as WikimediaClient, [johansson], previous, {
        revision: '2026-10-23',
        redo,
        discover,
      });
      expect(manifest.entries).toEqual([before]);
      expect(stats[0]!.note).toMatch(/descoberta vazia/);
    }
  });

  it('a busca do Wikidata não acha o item: a categoria da Commons (pais de piloto e ano de nascimento) identifica', async () => {
    const calls: string[] = [];
    const client = {
      searchItems: async () => [],
      get: async (_api: string, params: Record<string, string>) => {
        calls.push(String(params.list ?? params.titles));
        if (params.list === 'categorymembers')
          return { query: { categorymembers: [{ ns: 6, title: 'File:Stefan Johansson 1985.jpg' }] } };
        return {
          query: {
            pages: [
              params.titles === 'Category:Stefan Johansson'
                ? {
                    title: params.titles,
                    categories: [
                      { title: 'Category:Formula One drivers from Sweden' },
                      { title: 'Category:1956 births' },
                    ],
                  }
                : { title: params.titles, missing: true },
            ],
          },
        };
      },
      categoryExists: async () => false,
      categoryFiles: async () => [],
      imageInfo: async (titles: string[]) =>
        titles.map((title) => ({ title, width: 1600, height: 1200, mime: 'image/jpeg', extmetadata: {} })),
    } as unknown as WikimediaClient;
    const d = await discoverDriver(client, johansson, 512);
    expect(d.category).toBe('Stefan Johansson');
    expect(d.note).toMatch(/categoria da Commons/);
    expect(d.candidates.map((c) => c.file.title)).toEqual(['File:Stefan Johansson 1985.jpg']);
    expect(calls[0]).toBe('Category:Stefan Johansson');
  });
});
