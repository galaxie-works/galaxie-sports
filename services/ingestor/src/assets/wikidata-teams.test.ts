import { describe, expect, it } from 'vitest';
import {
  ageOn,
  asPhotoMatch,
  isWomenTeam,
  matchByTeam,
  nationalityOf,
  resolveTeam,
  teamPlayers,
  teamPlayersQuery,
  teamSearchName,
  type TeamCandidate,
  type TeamPlayer,
  type TeamResolution,
} from './wikidata-teams.js';

const claim = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
const entity = (types: string[], countries: string[]) => ({
  P31: types.map(claim),
  P17: countries.map(claim),
});

const cand = (over: Partial<TeamCandidate>): TeamCandidate => ({
  personId: 'p1',
  providerId: '639962',
  name: 'J. Duran',
  fullName: null,
  nationality: null,
  age: 22,
  ageAt: '2026-08-01',
  teams: ['1137'],
  ...over,
});
const player = (over: Partial<TeamPlayer>): TeamPlayer => ({
  qid: 'Q1',
  birthDate: '2004-03-10',
  labels: ['Juan Durán'],
  countries: ['Colombia'],
  image: 'Juan Duran.jpg',
  teams: ['Q100'],
  ...over,
});
const teams = new Map<string, TeamResolution>([
  ['1137', { qid: 'Q100' }],
  ['2000', { ambiguous: ['Q200', 'Q201'] }],
]);

describe('casamento estrito pelo time no Wikidata', () => {
  it('time feminino pelo " W" da api-sports; a busca vai sem ele', () => {
    expect(isWomenTeam('Roma W')).toBe(true);
    expect(isWomenTeam('Watford')).toBe(false);
    expect(teamSearchName('Birmingham City W')).toBe('Birmingham City');
  });

  it('resolve o time: clube do gênero certo e do mesmo país; mais de um é ambíguo; nenhum, sem QID', () => {
    const claims = new Map([
      ['Q2714', entity(['Q476028'], ['Q145'])], // Watford FC (Reino Unido)
      ['Q99', entity(['Q515'], ['Q145'])], // a cidade de Watford
      ['Q160530', entity(['Q476028'], ['Q183'])], // VfL Osnabrück
      ['Q97927396', entity(['Q103229495'], ['Q183'])], // VfL Osnabrück feminino
      ['Q300', entity(['Q476028'], ['Q183'])],
    ]);
    const labels = new Map([
      ['Q145', 'United Kingdom'],
      ['Q183', 'Germany'],
    ]);
    // England → United Kingdom pelo apelido; a cidade não é clube
    expect(
      resolveTeam({ providerId: '1', name: 'Watford', country: 'England' }, ['Q99', 'Q2714'], claims, labels),
    ).toEqual({
      qid: 'Q2714',
    });
    // masculino ignora o feminino de mesmo nome
    expect(
      resolveTeam(
        { providerId: '2', name: 'VfL Osnabrück', country: 'Germany' },
        ['Q160530', 'Q97927396'],
        claims,
        labels,
      ),
    ).toEqual({
      qid: 'Q160530',
    });
    expect(
      resolveTeam(
        { providerId: '3', name: 'VfL Osnabrück W', country: 'Germany' },
        ['Q160530', 'Q97927396'],
        claims,
        labels,
      ),
    ).toEqual({
      qid: 'Q97927396',
    });
    expect(
      resolveTeam({ providerId: '4', name: 'X', country: 'Germany' }, ['Q160530', 'Q300'], claims, labels),
    ).toEqual({
      ambiguous: ['Q160530', 'Q300'],
    });
    // país diferente
    expect(
      resolveTeam({ providerId: '5', name: 'X', country: 'Brazil' }, ['Q160530'], claims, labels),
    ).toEqual({ none: true });
  });

  it('idade em anos completos na data do elenco', () => {
    expect(ageOn('2004-03-10', '2026-08-01')).toBe(22);
    expect(ageOn('2004-09-10', '2026-08-01')).toBe(21);
    expect(ageOn('2004-08-01', '2026-08-01')).toBe(22);
  });

  it('liga com nome, idade ±1 e time num candidato único', () => {
    const r = matchByTeam([cand({})], [player({}), player({ qid: 'Q2', labels: ['Pedro Gómez'] })], teams);
    expect(r).toMatchObject({ ambiguous: 0, unmatched: 0, noTeam: 0 });
    expect(r.matches.map((m) => m.player.qid)).toEqual(['Q1']);
    // idade 21 com nascimento que dá 22: dentro de ±1
    expect(matchByTeam([cand({ age: 21 })], [player({})], teams).matches).toHaveLength(1);
    // idade fora de ±1
    expect(matchByTeam([cand({ age: 25 })], [player({})], teams)).toMatchObject({
      matches: [],
      unmatched: 1,
    });
  });

  it('dois homônimos no time: ambíguo, não liga', () => {
    const r = matchByTeam(
      [cand({})],
      [player({}), player({ qid: 'Q2', labels: ['Jorge Durán'], birthDate: '2003-11-01' })],
      teams,
    );
    expect(r).toMatchObject({ matches: [], ambiguous: 1 });
  });

  it('nacionalidade só bloqueia quando os dois lados têm e divergem', () => {
    expect(matchByTeam([cand({ nationality: 'Venezuela' })], [player({})], teams)).toMatchObject({
      matches: [],
      unmatched: 1,
    });
    expect(matchByTeam([cand({ nationality: 'Colombia' })], [player({})], teams).matches).toHaveLength(1);
    expect(
      matchByTeam([cand({ nationality: 'Colombia' })], [player({ countries: [] })], teams).matches,
    ).toHaveLength(1);
  });

  it('o mesmo QID para duas pessoas do core não liga nenhuma; time sem QID único conta à parte', () => {
    const r = matchByTeam(
      [cand({ personId: 'a' }), cand({ personId: 'b', providerId: '9' })],
      [player({})],
      teams,
    );
    expect(r).toMatchObject({ matches: [], ambiguous: 2 });
    expect(matchByTeam([cand({ teams: ['2000'] })], [player({})], teams)).toMatchObject({
      matches: [],
      noTeam: 1,
    });
    // jogador de outro time não entra
    expect(matchByTeam([cand({})], [player({ teams: ['Q999'] })], teams)).toMatchObject({
      matches: [],
      unmatched: 1,
    });
  });

  it('agrupa o SPARQL por jogador, com times, rótulos, países e a foto; nacionalidade só com um país', () => {
    const row = (team: string, label: string, country?: string, image?: string) => ({
      player: { type: 'uri' as const, value: 'http://www.wikidata.org/entity/Q1' },
      team: { type: 'uri' as const, value: `http://www.wikidata.org/entity/${team}` },
      birth: { type: 'literal' as const, value: '2004-03-10T00:00:00Z' },
      label: { type: 'literal' as const, value: label },
      ...(country ? { country: { type: 'literal' as const, value: country } } : {}),
      ...(image
        ? {
            image: {
              type: 'uri' as const,
              value: `http://commons.wikimedia.org/wiki/Special:FilePath/${image}`,
            },
          }
        : {}),
    });
    const [p] = teamPlayers([
      row('Q100', 'Juan Durán', 'Colombia', 'Juan_Dur%C3%A1n.jpg'),
      row('Q101', 'Juan Duran', 'Spain'),
    ]);
    expect(p).toEqual({
      qid: 'Q1',
      birthDate: '2004-03-10',
      labels: ['Juan Durán', 'Juan Duran'],
      countries: ['Colombia', 'Spain'],
      image: 'Juan Durán.jpg',
      teams: ['Q100', 'Q101'],
    });
    expect(nationalityOf(p!)).toBeNull();
    expect(nationalityOf({ ...p!, countries: ['Colombia'] })).toBe('Colombia');
    expect(asPhotoMatch({ candidate: cand({}), player: { ...p!, image: null } })).toBeNull();
    expect(teamPlayersQuery(['Q100'])).toContain('YEAR(?end) >= 2026');
  });
});
