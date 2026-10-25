import { describe, expect, it } from 'vitest';
import type { F1dbTables } from '@galaxie/providers';
import {
  candidatesQuery,
  f1dbBiographies,
  matchDriver,
  parseCandidates,
  parseFacts,
  wikidataBlock,
  type WikidataCandidate,
} from './biography.js';

const uri = (q: string) => ({ type: 'uri' as const, value: `http://www.wikidata.org/entity/${q}` });
const prop = (p: string) => ({ type: 'uri' as const, value: `http://www.wikidata.org/prop/direct/${p}` });
const lit = (value: string, lang?: string) => ({
  type: 'literal' as const,
  value,
  ...(lang ? { 'xml:lang': lang } : {}),
});

describe('f1dbBiographies', () => {
  it('nome completo, morte e a família com o que o parente é do piloto', () => {
    const bios = f1dbBiographies({
      driver: [
        {
          id: 'graham-hill',
          name: 'Graham Hill',
          full_name: 'Norman Graham Hill',
          date_of_birth: '1929-02-15',
          date_of_death: '1975-11-29',
          gender: 'MALE',
        },
        {
          id: 'damon-hill',
          name: 'Damon Hill',
          full_name: 'Damon Graham Devereux Hill',
          date_of_birth: '1960-09-17',
          gender: 'MALE',
        },
      ],
      driver_family_relationship: [
        {
          driver_id: 'damon-hill',
          position_display_order: 1,
          other_driver_id: 'graham-hill',
          type: 'PARENT',
        },
        { driver_id: 'graham-hill', position_display_order: 1, other_driver_id: 'damon-hill', type: 'CHILD' },
        {
          driver_id: 'graham-hill',
          position_display_order: 2,
          other_driver_id: 'fora-do-f1db',
          type: 'SIBLING',
        },
      ],
    } as unknown as F1dbTables);
    expect(bios.get('graham-hill')).toEqual({
      f1dbId: 'graham-hill',
      name: 'Graham Hill',
      fullName: 'Norman Graham Hill',
      birthDate: '1929-02-15',
      deathDate: '1975-11-29',
      family: [{ relation: 'CHILD', f1db_id: 'damon-hill', name: 'Damon Hill', gender: 'male' }],
    });
    expect(bios.get('damon-hill')!.family[0]).toMatchObject({ relation: 'PARENT', f1db_id: 'graham-hill' });
    expect(bios.get('damon-hill')!.deathDate).toBeNull();
  });
});

describe('casamento estrito com o Wikidata', () => {
  const senna = {
    f1dbId: 'ayrton-senna',
    name: 'Ayrton Senna',
    fullName: 'Ayrton Senna da Silva',
    birthDate: '1960-03-21',
  };
  const clark = {
    f1dbId: 'jim-clark',
    name: 'Jim Clark',
    fullName: 'James Clark, Jr.',
    birthDate: '1936-03-04',
  };
  const cand = (c: Partial<WikidataCandidate> & { qid: string }): WikidataCandidate => ({
    birthDate: '1960-03-21',
    label: null,
    driverIds: [],
    racer: false,
    ...c,
  });

  it('id do piloto e a mesma data de nascimento', () => {
    expect(matchDriver(senna, [cand({ qid: 'Q10490', driverIds: ['ayrton-senna'] })])).toEqual({
      qid: 'Q10490',
      matchedBy: 'driver_id',
    });
    // o id certo com outra data de nascimento não casa
    expect(
      matchDriver(senna, [cand({ qid: 'Q1', birthDate: '1960-03-22', driverIds: ['ayrton-senna'] })]),
    ).toBeNull();
  });

  it('sem id: o nome em inglês, a ocupação de piloto e um candidato só', () => {
    const jim = cand({ qid: 'Q3137', birthDate: '1936-03-04', label: 'Jim Clark', racer: true });
    expect(matchDriver(clark, [jim])).toEqual({ qid: 'Q3137', matchedBy: 'name' });
    // homônimo sem ocupação de piloto não conta; dois pilotos com o mesmo nome e data é dúvida
    expect(matchDriver(clark, [{ ...jim, racer: false }])).toBeNull();
    expect(matchDriver(clark, [jim, { ...jim, qid: 'Q9' }])).toBeNull();
  });

  it('a consulta filtra pela data e o parse junta as linhas por QID', () => {
    expect(candidatesQuery(['1960-03-21'])).toContain('"1960-03-21T00:00:00Z"^^xsd:dateTime');
    const rows = parseCandidates([
      {
        d: uri('Q10490'),
        dob: lit('1960-03-21T00:00:00Z'),
        label: lit('Ayrton Senna', 'en'),
        ddb: lit('ayrton-senna'),
      },
      { d: uri('Q10490'), dob: lit('1960-03-21T00:00:00Z'), mss: lit('ayrton-senna'), occ: uri('Q10841764') },
    ]);
    expect(rows).toEqual([
      {
        qid: 'Q10490',
        birthDate: '1960-03-21',
        label: 'Ayrton Senna',
        driverIds: ['ayrton-senna'],
        racer: true,
      },
    ]);
  });
});

describe('fatos do Wikidata', () => {
  const facts = parseFacts(
    [
      { d: uri('Q10490'), prop: prop('P570'), date: lit('1994-05-01T00:00:00Z') },
      { d: uri('Q10490'), prop: prop('P20'), v: uri('Q171313'), en: lit('Imola Circuit', 'en') },
      { d: uri('Q10490'), prop: prop('P20'), v: uri('Q3886608'), en: lit('Ospedale Maggiore', 'en') },
      { d: uri('Q10490'), prop: prop('P1196'), v: uri('Q21142718'), pt: lit('morte acidental', 'pt-br') },
      { d: uri('Q10490'), prop: prop('P1449'), nick: lit('Magic Senna', 'en') },
      { d: uri('Q3128'), prop: prop('P20'), v: uri('Q1'), pt: lit('Arkley', 'pt'), iso: lit('gb') },
      { d: uri('Q3128'), prop: prop('P570'), date: lit('1975-11-29T00:00:00Z') },
    ],
    [
      { d: uri('Q3128'), e: uri('Q898741'), series: uri('Q8032'), label: lit('1966 Indianapolis 500', 'en') },
      { d: uri('Q3128'), e: uri('Q898741'), series: uri('Q8032'), label: lit('1966 Indianapolis 500', 'en') },
    ],
  );

  it('morte, local, circunstância, apelidos e vitórias fora da F1', () => {
    expect(facts.get('Q10490')).toMatchObject({
      deathDate: '1994-05-01',
      manners: [{ qid: 'Q21142718', labels: { pt: 'morte acidental' } }],
      nicknames: [{ text: 'Magic Senna', lang: 'en' }],
    });
    expect(facts.get('Q10490')!.deathPlaces).toHaveLength(2);
    expect(facts.get('Q3128')!.wins).toEqual([{ race: 'indy500', year: 1966, qid: 'Q898741' }]);
    expect(facts.get('Q3128')!.deathPlaces[0]).toEqual({
      qid: 'Q1',
      labels: { pt: 'Arkley' },
      country: 'GB',
    });
  });

  it('na dúvida, não mostra: dois locais ou data da morte divergente do F1DB', () => {
    const at = '2026-10-24T00:00:00Z';
    const senna = wikidataBlock(
      { deathDate: '1994-05-01' },
      { qid: 'Q10490', matchedBy: 'driver_id' },
      facts.get('Q10490'),
      at,
    );
    expect(senna.death_place).toBeNull();
    expect(senna.death_manner).toHaveLength(1);
    const wrong = wikidataBlock(
      { deathDate: '1975-11-30' },
      { qid: 'Q3128', matchedBy: 'driver_id' },
      facts.get('Q3128'),
      at,
    );
    expect(wrong).toMatchObject({ death_place: null, death_cause: [], death_manner: [] });
    // vitórias e apelidos não dependem da morte
    expect(wrong.wins).toHaveLength(1);
  });
});
