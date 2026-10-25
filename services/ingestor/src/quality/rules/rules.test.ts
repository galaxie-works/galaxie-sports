import { describe, expect, it } from 'vitest';
import type { RaceCareer, Team } from '@galaxie/contracts';
import type { F1dbDriverTruth, F1dbTruth } from '../sources/f1db.js';
import {
  checkCareerTotals,
  checkDriverCountry,
  checkDriverLinks,
  checkSeasonNumbers,
  checkSeasonTeams,
  eraNameOk,
  type ServedDriver,
} from './f1.js';
import { wrongNames } from './geo.js';
import { compareSeasons, compareTables } from './standings.js';
import { hasOfficialSource, priceHasCurrency, servedStatuses, siteOf } from './watch.js';
import { categoryFromName, categoryFromWikidata, competitionCategory } from './wikidata.js';

const season = (year: number, team: { id: string; name: string } | null, number: number | null) =>
  ({
    year,
    number,
    teams: team ? [{ ...team, logo: null }] : [],
  }) as unknown as RaceCareer['seasons'][number];

function driver(
  seasons: RaceCareer['seasons'],
  truth: Partial<F1dbDriverTruth>,
  extra: { country?: Team['country_ref']; totals?: Partial<RaceCareer['totals']>; titles?: number[] } = {},
): ServedDriver {
  return {
    participantId: 'p1',
    name: 'Juan Manuel Fangio',
    truth: {
      id: 'juan-manuel-fangio',
      name: 'Juan Manuel Fangio',
      nationality: 'AR',
      starts: 51,
      wins: 24,
      titles: [],
      seasons: new Map(),
      tags: ['campeão'],
      ...truth,
    },
    career: {
      seasons,
      titles: extra.titles ?? [],
      totals: { titles: extra.titles?.length ?? 0, wins: 24, races: 51, ...extra.totals },
    } as unknown as RaceCareer,
    team: {
      name: 'Juan Manuel Fangio',
      country_ref: extra.country ?? { code: 'AR', name: 'Argentina' },
    } as unknown as Team,
  };
}

describe('F1: nome de época da equipe', () => {
  it('"Mercedes-AMG Petronas" vale em 2024 e não em 1955 (o erro do Fangio)', () => {
    expect(
      eraNameOk('Mercedes-AMG Petronas', ['Mercedes', 'Mercedes AMG F1', 'Mercedes-AMG Petronas F1 Team']),
    ).toBe(true);
    expect(eraNameOk('Mercedes-AMG Petronas', ['Mercedes', 'Mercedes AMG F1', 'Daimler Benz AG'])).toBe(
      false,
    );
    expect(eraNameOk('Scuderia Ferrari', ['Ferrari', 'Ferrari', 'Scuderia Ferrari'])).toBe(true);
    expect(eraNameOk('', ['Ferrari'])).toBe(false);
  });

  it('confere o construtor (aceita qualquer empatado) e o nome de cada temporada', () => {
    const d = driver(
      [
        season(1955, { id: 'mercedes-core', name: 'Mercedes-AMG Petronas' }, 2),
        season(1956, { id: 'ferrari-core', name: 'Ferrari' }, 1),
        season(1958, { id: 'mercedes-core', name: 'Mercedes-AMG Petronas' }, 2),
        season(1957, { id: 'maserati-core', name: 'Maserati' }, 2),
      ],
      {
        seasons: new Map([
          [
            1955,
            {
              constructorId: 'mercedes',
              constructorIds: ['mercedes'],
              names: ['Mercedes', 'Daimler Benz AG'],
              numbers: [2],
            },
          ],
          [
            1956,
            {
              constructorId: 'ferrari',
              constructorIds: ['ferrari'],
              names: ['Ferrari', 'Scuderia Ferrari'],
              numbers: [1],
            },
          ],
          [
            1958,
            { constructorId: 'maserati', constructorIds: ['maserati'], names: ['Maserati'], numbers: [2] },
          ],
          [
            1957,
            { constructorId: 'brm', constructorIds: ['brm', 'maserati'], names: ['Maserati'], numbers: [2] },
          ],
        ]),
      },
    );
    const constructorsOf = new Map([
      ['mercedes-core', ['mercedes']],
      ['ferrari-core', ['ferrari']],
      ['maserati-core', ['maserati']],
    ]);
    const { checked, failures } = checkSeasonTeams([d], constructorsOf);
    expect(checked).toBe(4);
    expect(failures.map((f) => [f.key, f.current, f.expected])).toEqual([
      ['p1:1955', 'Mercedes-AMG Petronas', 'Mercedes · Daimler Benz AG'],
      ['p1:1958', 'Mercedes-AMG Petronas (mercedes)', 'maserati'],
    ]);
    expect(failures[0]!.link).toMatchObject({ type: 'participant', id: 'p1', kind: 'driver' });
  });

  it('número da temporada: um dos mais usados', () => {
    const d = driver([season(2024, null, 3), season(2023, null, 1), season(1978, null, null)], {
      seasons: new Map([
        [2024, { constructorId: 'x', constructorIds: ['x'], names: [], numbers: [1] }],
        [2023, { constructorId: 'x', constructorIds: ['x'], names: [], numbers: [1, 11] }],
        [1978, { constructorId: 'x', constructorIds: ['x'], names: [], numbers: [] }],
      ]),
    });
    const r = checkSeasonNumbers([d]);
    expect(r.checked).toBe(2);
    expect(r.failures.map((f) => [f.key, f.current, f.expected])).toEqual([['p1:2024', '3', '1']]);
  });

  it('totais: títulos com os anos, vitórias e GPs', () => {
    const ok = driver([], { titles: [1951, 1954] }, { titles: [1951, 1954] });
    const wrong = driver([], { titles: [1951, 1954] }, { titles: [1951, 1954, 1958], totals: { races: 52 } });
    expect(checkCareerTotals([ok]).failures).toEqual([]);
    expect(checkCareerTotals([wrong]).failures.map((f) => f.key)).toEqual(['p1:títulos', 'p1:GPs']);
  });

  it('país: GB servido como Gales falha; Holanda para NL passa', () => {
    const wales = driver([], { nationality: 'GB' }, { country: { code: 'GB', name: 'Wales' } });
    const uk = driver([], { nationality: 'GB' }, { country: { code: 'GB', name: 'Reino Unido' } });
    const eng = driver([], { nationality: 'GB' }, { country: { code: 'GB-ENG', name: 'Inglaterra' } });
    const nl = driver([], { nationality: 'NL' }, { country: { code: 'NL', name: 'Holanda' } });
    const r = checkDriverCountry([wales, uk, eng, nl]);
    expect(r.checked).toBe(4);
    expect(r.failures.map((f) => [f.current, f.expected])).toEqual([
      ['GB Wales', 'GB Reino Unido'],
      ['GB-ENG Inglaterra', 'GB Reino Unido'],
    ]);
  });
});

describe('F1: vínculo dos pilotos prioritários', () => {
  const truthOf = (...drivers: Partial<F1dbDriverTruth>[]): F1dbTruth => ({
    release: 'v0',
    currentYear: 2026,
    racesLeft: 0,
    drivers: new Map(
      drivers.map((d) => [
        d.id!,
        {
          name: d.id!,
          nationality: null,
          starts: 0,
          wins: 0,
          titles: [],
          seasons: new Map(),
          tags: [],
          ...d,
        } as F1dbDriverTruth,
      ]),
    ),
  });

  it('prioritário sem participante no core é falha; quem não é prioritário não conta', () => {
    const truth = truthOf(
      { id: 'juan-manuel-fangio', name: 'Juan Manuel Fangio', tags: ['campeão'] },
      { id: 'alberto-ascari', name: 'Alberto Ascari', tags: ['campeão', 'top 20 vitórias'] },
      { id: 'piloto-reserva', name: 'Piloto Reserva', tags: [] },
    );
    const r = checkDriverLinks(truth, new Map([['juan-manuel-fangio', 'p1']]));
    expect(r.checked).toBe(2);
    expect(r.failures.map((f) => [f.key, f.label, f.expected])).toEqual([
      ['alberto-ascari', 'Alberto Ascari · campeão, top 20 vitórias', 'vínculo f1db driver-alberto-ascari'],
    ]);
    expect(checkDriverLinks(truth, new Map()).failures).toHaveLength(2);
  });
});

describe('países ambíguos', () => {
  it('GB precisa ser o Reino Unido em todos os idiomas', () => {
    expect(wrongNames('GB', { en: 'United Kingdom', 'pt-BR': 'Reino Unido', es: 'Reino Unido' })).toEqual([]);
    expect(wrongNames('GB', { en: 'Wales', 'pt-BR': 'País de Gales', es: 'Reino Unido' })).toEqual([
      'en',
      'pt-BR',
    ]);
    expect(wrongNames('GB', null)).toEqual(['en', 'pt-BR', 'es']);
    expect(wrongNames('BR', { en: 'Brazil' })).toEqual([]);
  });
});

describe('Wikidata: categoria do time', () => {
  it('pelo nosso nome', () => {
    expect(categoryFromName('Fiorentina W')).toBe('women');
    expect(categoryFromName('Palmeiras U20')).toBe('youth');
    expect(categoryFromName('Flamengo Sub-20')).toBe('youth');
    expect(categoryFromName('Hoffenheim II')).toBe('reserve');
    expect(categoryFromName('Estudiantes L.P. Res.')).toBe('reserve');
    expect(categoryFromName('Boca Juniors')).toBe('main');
  });

  it('pelo rótulo e pela descrição do item', () => {
    expect(categoryFromWikidata(['Boca Juniors'], ['Argentine football club'])).toBe('main');
    expect(
      categoryFromWikidata(
        ['Boca Juniors Reserves and Academy'],
        ['reserve and youth academy teams of Boca Juniors'],
      ),
    ).not.toBe('main');
    expect(
      categoryFromWikidata(['Real Madrid Castilla'], ['association football reserve team of Real Madrid CF']),
    ).toBe('reserve');
    expect(categoryFromWikidata(['Madrid C.F.F. B'], ['Reserve side of Madrid C.F.F.'])).toBe('reserve');
    expect(categoryFromWikidata(['ACF Fiorentina'], ['association football club in Florence, Italy'])).toBe(
      'main',
    );
    expect(categoryFromWikidata(['Chelsea F.C. Women'], ["English women's association football club"])).toBe(
      'women',
    );
    expect(categoryFromWikidata(['Club Atlético Juventud'], ['Uruguayan football club'])).toBe('main');
    // "II" e "B" só como sufixo do rótulo (os casos da primeira execução no dev)
    expect(categoryFromWikidata(['Baník Ostrava B'], [])).toBe('reserve');
    expect(
      categoryFromWikidata(
        ['Juan Pablo II College Sports Club Association'],
        ['association sport club in Peru'],
      ),
    ).toBe('main');
  });

  it('competição feminina', () => {
    expect(competitionCategory("UEFA Women's Champions League")).toBe('women');
    expect(competitionCategory('Copa Libertadores Femenina')).toBe('women');
    expect(competitionCategory('Copa Libertadores')).toBe('main');
  });
});

describe('grades', () => {
  it('piso editorial', () => {
    expect(servedStatuses(undefined)).toEqual(['approved']);
    expect(servedStatuses('reviewed')).toEqual(['reviewed', 'approved']);
    expect(servedStatuses('draft')).toEqual(['draft', 'reviewed', 'approved']);
    expect(servedStatuses('xyz')).toEqual(['approved']);
  });

  it('domínio registrável', () => {
    expect(siteOf('https://www.loja.exemplo.com.br/planos?x=1')).toBe('exemplo.com.br');
    expect(siteOf('exemplo.com')).toBe('exemplo.com');
    expect(siteOf('https://ayuda.operadora.com.mx/canales')).toBe('operadora.com.mx');
    expect(siteOf(null)).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });

  it('fonte oficial: página no site da plataforma ou do plano, ou informada pela operadora', () => {
    const at = '2026-10-24T00:00:00Z';
    expect(
      hasOfficialSource(
        [{ url: 'https://www.exemplo.com.br/grade', seen_at: at }],
        ['https://exemplo.com.br', null],
      ),
    ).toBe(true);
    expect(
      hasOfficialSource(
        [{ url: 'https://blog-de-tv.com/grade', seen_at: at }],
        ['https://exemplo.com.br', null],
      ),
    ).toBe(false);
    expect(hasOfficialSource([{ url: null, seen_at: at, kind: 'operator' }], [null])).toBe(true);
    expect(hasOfficialSource([], ['https://exemplo.com.br'])).toBe(false);
  });

  it('preço com moeda', () => {
    for (const p of ['R$ 99,90/mês', 'US$ 10', '$ 15.990 CLP', 'MXN 299', 'S/ 59', 'Grátis', 'ARS 12.000'])
      expect(priceHasCurrency(p)).toBe(true);
    for (const p of [null, '', '99,90', 'a partir de 49,90 por mês']) expect(priceHasCurrency(p)).toBe(false);
  });
});

describe('classificação', () => {
  it('compara só times com o mesmo número de jogos', () => {
    const line = (participantId: string, played: number, points: number, gf = 10, ga = 5) => ({
      participantId,
      name: participantId,
      group: '',
      played,
      points,
      goalsFor: gf,
      goalsAgainst: ga,
    });
    const { compared, diffs } = compareTables(
      [line('ecu', 18, 29), line('bra', 18, 28), line('arg', 17, 35)],
      [line('ecu', 18, 32), line('bra', 18, 28), line('arg', 18, 38)],
    );
    expect(compared).toBe(2);
    expect(diffs.map((d) => d.line.participantId)).toEqual(['ecu']);
  });

  const ref = (slug: string) => ({
    id: `s-${slug}`,
    slug,
    name: slug,
    year: 2026,
    competition_id: `c-${slug}`,
  });
  const table = {
    provider: [
      { participantId: 'a', name: 'A', group: '', played: 3, points: 9, goalsFor: 5, goalsAgainst: 1 },
    ],
    computed: [{ participantId: 'a', group: '', played: 3, points: 9, goalsFor: 5, goalsAgainst: 1 }],
  };
  const boom = async () => Promise.reject(new Error('regulamento inválido'));

  it('temporada com erro vira falha com a mensagem; as outras são conferidas', async () => {
    const r = await compareSeasons(
      [ref('serie-a'), ref('liga-x')],
      async (s) => (s.slug === 'liga-x' ? boom() : table),
      () => {},
    );
    expect(r.checked).toBe(1);
    expect(r.failures.map((f) => [f.key, f.current])).toEqual([
      ['s-liga-x:erro', 'erro ao recalcular: regulamento inválido'],
    ]);
  });

  it('erro em todas as temporadas: a regra lança (sai como error, não como pass com 0)', async () => {
    await expect(compareSeasons([ref('serie-a'), ref('liga-x')], boom, () => {})).rejects.toThrow(
      'nenhuma temporada recalculada (2 com erro; serie-a 2026: regulamento inválido)',
    );
    // sem erro e sem tabela, continua pass com 0
    expect(
      await compareSeasons(
        [ref('serie-a')],
        async () => null,
        () => {},
      ),
    ).toEqual({
      checked: 0,
      failures: [],
    });
  });
});
