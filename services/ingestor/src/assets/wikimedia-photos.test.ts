import { describe, expect, it } from 'vitest';
import {
  birthDateQuery,
  countriesMatch,
  fetchCommonsInfo,
  isFreeLicense,
  matchCandidates,
  namesMatch,
  parseCommonsInfo,
  wikidataPeople,
  type PhotoCandidate,
  type WikidataPerson,
} from './wikimedia-photos.js';

const cand = (over: Partial<PhotoCandidate>): PhotoCandidate => ({
  personId: 'p1',
  providerId: '306728',
  name: 'J. Valencia',
  fullName: 'Jhon Alexander Valencia Hinestroza',
  birthDate: '2002-04-04',
  nationality: 'Colombia',
  ...over,
});
const wd = (over: Partial<WikidataPerson>): WikidataPerson => ({
  qid: 'Q1',
  birthDate: '2002-04-04',
  labels: ['Jhon Valencia'],
  countries: ['Colombia'],
  image: 'Jhon Valencia 2024.jpg',
  ...over,
});

describe('fotos do Wikidata e do Commons', () => {
  it('nomes: igual, inicial + sobrenome, primeiro nome + sobrenome, e o nome completo do fornecedor', () => {
    expect(namesMatch(cand({}), 'Jhon Valencia')).toBe(true);
    expect(namesMatch(cand({ name: 'Naim García', fullName: null }), 'Naim Garcia')).toBe(true);
    expect(namesMatch(cand({ name: 'Pedro Emanuel', fullName: null }), 'Pedro Emanuel')).toBe(true);
    expect(namesMatch(cand({ name: 'Chupe', fullName: 'Jesús Pérez Gómez' }), 'Jesús Gómez')).toBe(true);
    // sobrenome igual, inicial diferente
    expect(namesMatch(cand({}), 'Carlos Valencia')).toBe(false);
    // outro sobrenome
    expect(namesMatch(cand({}), 'Jhon Córdoba')).toBe(false);
  });

  it('nacionalidade: igual, com apelido conhecido, ou ausente de um dos lados', () => {
    expect(countriesMatch('Colombia', ['Colombia'])).toBe(true);
    expect(countriesMatch('England', ['United Kingdom'])).toBe(true);
    expect(countriesMatch('Korea Republic', ['South Korea'])).toBe(true);
    expect(countriesMatch(null, ['Brazil'])).toBe(true);
    expect(countriesMatch('Brazil', [])).toBe(true);
    expect(countriesMatch('Brazil', ['Portugal'])).toBe(false);
  });

  it('casa por data, nome e país; ambíguo ou repetido fica de fora', () => {
    const a = cand({ personId: 'a' });
    const b = cand({
      personId: 'b',
      name: 'M. Pérez',
      fullName: null,
      nationality: 'Uruguay',
      birthDate: '2000-08-20',
    });
    const c = cand({
      personId: 'c',
      name: 'L. Duré',
      fullName: null,
      nationality: 'Uruguay',
      birthDate: '2005-10-21',
    });
    const people = [
      wd({}),
      // mesmo dia, outro nome
      wd({ qid: 'Q2', labels: ['Juan Córdoba'] }),
      // dois "M. Pérez" uruguaios no mesmo dia: ambíguo
      wd({ qid: 'Q3', birthDate: '2000-08-20', labels: ['Matías Pérez'], countries: ['Uruguay'] }),
      wd({ qid: 'Q4', birthDate: '2000-08-20', labels: ['Martín Pérez'], countries: ['Uruguay'] }),
      // país diferente
      wd({ qid: 'Q5', birthDate: '2005-10-21', labels: ['Luis Duré'], countries: ['Paraguay'] }),
    ];
    expect(matchCandidates([a, b, c], people).map((m) => [m.candidate.personId, m.person.qid])).toEqual([
      ['a', 'Q1'],
    ]);
    // a mesma pessoa do Wikidata para dois candidatos (duplicata no core): nenhum leva
    expect(matchCandidates([a, cand({ personId: 'a2' })], [wd({})])).toEqual([]);
  });

  it('agrupa as linhas do SPARQL por pessoa e lê o nome do arquivo do P18', () => {
    const row = (label: string, country?: string) => ({
      item: { type: 'uri' as const, value: 'http://www.wikidata.org/entity/Q933886' },
      birth: { type: 'literal' as const, value: '1975-02-11T00:00:00Z' },
      image: {
        type: 'uri' as const,
        value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Pedro%20Emanuel%202011.jpg',
      },
      label: { type: 'literal' as const, value: label },
      ...(country ? { country: { type: 'literal' as const, value: country } } : {}),
    });
    expect(wikidataPeople([row('Pedro Emanuel', 'Portugal'), row('Pedro Emanuel dos Santos')])).toEqual([
      {
        qid: 'Q933886',
        birthDate: '1975-02-11',
        labels: ['Pedro Emanuel', 'Pedro Emanuel dos Santos'],
        countries: ['Portugal'],
        image: 'Pedro Emanuel 2011.jpg',
      },
    ]);
    expect(birthDateQuery(['1975-02-11'])).toContain('"1975-02-11T00:00:00Z"^^xsd:dateTime');
  });

  it('licença livre: CC0, CC BY, CC BY-SA e domínio público; NC e ND ficam de fora', () => {
    for (const ok of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-self', 'CC BY-SA 3.0 de']) {
      expect(isFreeLicense(ok), ok).toBe(true);
    }
    for (const no of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'GFDL', 'Fair use', ''])
      expect(isFreeLicense(no), no).toBe(false);
  });

  it('Commons: lê miniatura, licença, autor (sem HTML) e página; descarta licença não livre', async () => {
    const body = {
      query: {
        pages: {
          '1': {
            title: 'File:Pedro Emanuel 2011.jpg',
            imageinfo: [
              {
                thumburl: 'https://upload.wikimedia.org/thumb/pedro.jpg/400px-pedro.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Pedro_Emanuel_2011.jpg',
                mime: 'image/jpeg',
                extmetadata: {
                  LicenseShortName: { value: 'CC BY-SA 3.0' },
                  LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' },
                  Artist: {
                    value: '<a href="//commons.wikimedia.org/wiki/User:Fulano">Fulano &amp; Cia</a>',
                  },
                },
              },
            ],
          },
          '2': {
            title: 'File:Outro.jpg',
            imageinfo: [
              { thumburl: 'https://x/y.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-NC 2.0' } } },
            ],
          },
        },
      },
    };
    expect(parseCommonsInfo(body)).toEqual([
      {
        file: 'Pedro Emanuel 2011.jpg',
        thumbUrl: 'https://upload.wikimedia.org/thumb/pedro.jpg/400px-pedro.jpg',
        descriptionUrl: 'https://commons.wikimedia.org/wiki/File:Pedro_Emanuel_2011.jpg',
        license: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
        author: 'Fulano & Cia',
        mime: 'image/jpeg',
      },
    ]);

    const calls: string[] = [];
    const fake = (async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const files = Array.from({ length: 51 }, (_, i) => `F${i}.jpg`);
    const images = await fetchCommonsInfo(files, { fetch: fake, sleep: async () => {} });
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]!).searchParams.get('titles')!.split('|')).toHaveLength(50);
    expect(images.get('Pedro Emanuel 2011.jpg')?.license).toBe('CC BY-SA 3.0');
  });
});
