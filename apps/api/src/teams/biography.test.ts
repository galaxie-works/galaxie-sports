import { describe, expect, it } from 'vitest';
import { ageAt, biographyOf, fatalSession, type BioRow, type FatalRace } from './biography.js';

const senna: BioRow = {
  full_name: 'Ayrton Senna da Silva',
  birth_date: '1960-03-21',
  death_date: '1994-05-01',
  bio_facts: {
    family: [{ relation: 'SIBLINGS_CHILD', f1db_id: 'bruno-senna', name: 'Bruno Senna', gender: 'male' }],
    wikidata: {
      qid: 'Q10490',
      matched_by: 'driver_id',
      death_place: null,
      death_cause: [{ qid: 'Q1995526', labels: { pt: 'traumatismo cranioencefálico' } }],
      death_manner: [{ qid: 'Q21142718', labels: { pt: 'morte acidental' } }],
      nicknames: [{ text: 'Magic Senna', lang: 'en' }],
      wins: [],
      checked_at: '2026-10-24T00:00:00Z',
    },
  },
};
const imola: FatalRace = {
  event_id: '00000000-0000-0000-0000-000000000001',
  starts_at: '1994-05-01T13:00:00Z',
  status: 'Fatal accident',
  stage: { 'pt-BR': 'San Marino Grand Prix' },
  circuit: 'Autodromo Enzo e Dino Ferrari',
  city: 'Imola',
};

describe('biografia do piloto', () => {
  it('morte em corrida: o GP marcado como fatal no F1DB, com a idade e sem causa', () => {
    const bio = biographyOf(senna, imola, new Map([['bruno-senna', 'id-bruno']]), new Map(), 'pt-BR');
    expect(bio.death).toEqual({
      date: '1994-05-01',
      age: 34,
      place: null,
      accident: true,
      cause: null,
      race: {
        event_id: imola.event_id,
        name: 'San Marino Grand Prix',
        date: '1994-05-01T13:00:00.000Z',
        session: 'race',
        circuit: 'Autodromo Enzo e Dino Ferrari',
        city: 'Imola',
      },
    });
    expect(bio.family).toEqual([
      {
        relation: 'SIBLINGS_CHILD',
        gender: 'male',
        driver: { id: 'id-bruno', f1db_id: 'bruno-senna', name: 'Bruno Senna' },
      },
    ]);
    expect(bio.nicknames).toEqual(['Magic Senna']);
    expect(bio.sources?.wikidata).toBe('https://www.wikidata.org/wiki/Q10490');
  });

  it('fora de corrida: o local com o país e a causa que não é acidente, no idioma pedido', () => {
    const hill: BioRow = {
      full_name: 'Norman Graham Hill',
      birth_date: '1929-02-15',
      death_date: '1975-11-29',
      bio_facts: {
        wikidata: {
          qid: 'Q3128',
          matched_by: 'driver_id',
          death_place: { qid: 'Q1', labels: { pt: 'Arkley', en: 'Arkley' }, country: 'GB' },
          death_cause: [{ qid: 'Q744913', labels: { pt: 'acidente aéreo', es: 'accidente de aviación' } }],
          death_manner: [],
          wins: [{ race: 'indy500', year: 1966, qid: 'Q898741' }],
          checked_at: '2026-10-24T00:00:00Z',
        },
      },
    };
    const countries = new Map([['GB', { code: 'GB', name: 'Reino Unido' }]]);
    const bio = biographyOf(hill, null, new Map(), countries, 'es-AR');
    expect(bio.death).toMatchObject({
      age: 46,
      accident: false,
      cause: 'accidente de aviación',
      place: { name: 'Arkley', country: { code: 'GB', name: 'Reino Unido' } },
      race: null,
    });
    expect(bio.other_wins).toEqual([
      { race: 'indy500', year: 1966, source: 'https://www.wikidata.org/wiki/Q898741' },
    ]);
  });

  it('colisão como causa é acidente (o rótulo "acidente rodoviário" não aparece); vivo fica sem morte', () => {
    const clark: BioRow = {
      full_name: 'James Clark, Jr.',
      birth_date: '1936-03-04',
      death_date: '1968-04-07',
      bio_facts: {
        wikidata: {
          qid: 'Q3137',
          matched_by: 'name',
          death_cause: [{ qid: 'Q9687', labels: { pt: 'acidente rodoviário' } }],
          checked_at: '2026-10-24T00:00:00Z',
        },
      },
    };
    expect(biographyOf(clark, null, new Map(), new Map(), 'pt-BR').death).toMatchObject({
      accident: true,
      cause: null,
    });
    const alive = biographyOf(
      { ...clark, death_date: null, bio_facts: null },
      null,
      new Map(),
      new Map(),
      'pt-BR',
    );
    expect(alive).toMatchObject({ death: null, family: [], other_wins: [], sources: { wikidata: null } });
  });

  it('onde foi o acidente e a idade em anos completos', () => {
    expect(fatalSession('Fatal accident in qualifying')).toBe('qualifying');
    expect(fatalSession('Fatal accident in practice')).toBe('practice');
    expect(fatalSession('Fatal accident in support race')).toBe('support_race');
    expect(fatalSession('Fatal collision')).toBe('race');
    expect(ageAt('1960-03-21', '1994-05-01')).toBe(34);
    expect(ageAt('1960-05-02', '1994-05-01')).toBe(33);
    expect(ageAt(null, '1994-05-01')).toBeNull();
  });
});
