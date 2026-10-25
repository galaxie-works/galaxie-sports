import { describe, expect, it } from 'vitest';
import {
  ageOn,
  asPhotoMatch,
  itemCategory,
  matchByTeam,
  nationalityOf,
  normalizeTeamName,
  resolveTeam,
  teamCategory,
  teamPlayers,
  teamPlayersQuery,
  teamSearchName,
  type TeamCandidate,
  type TeamItem,
  type TeamPlayer,
  type TeamResolution,
} from './wikidata-teams.js';

const item = (over: Partial<TeamItem>): TeamItem => ({
  label: null,
  names: over.label ? [over.label] : [],
  description: 'association football club',
  types: ['Q476028'],
  countries: ['Argentina'],
  leagues: [],
  partOf: [],
  ...over,
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
  it('categoria do nosso time pelo sufixo da api-sports; a busca vai sem ele', () => {
    expect(teamCategory('Roma W')).toBe('women');
    expect(teamCategory('Palmeiras U20')).toBe('youth');
    expect(teamCategory('Flamengo Sub-20')).toBe('youth');
    expect(teamCategory('Barcelona B')).toBe('reserve');
    expect(teamCategory('Estudiantes Res.')).toBe('reserve');
    expect(teamCategory('Watford')).toBe('senior');
    expect(teamCategory('Juan Pablo II College')).toBe('senior');
    expect(teamSearchName('Birmingham City W')).toBe('Birmingham City');
    expect(teamSearchName('Palmeiras U20')).toBe('Palmeiras');
    expect(teamSearchName('Boca Juniors')).toBe('Boca Juniors');
  });

  it('categoria do item pelo rótulo e pela descrição, não pelo tipo nem pelos apelidos', () => {
    const it = (label: string, description: string, types = ['Q476028']) => ({ label, description, types });
    // o Chelsea masculino é Q103229495 ("men's association football team")
    expect(itemCategory(it('Chelsea F.C.', 'association football club in London', ['Q103229495']))).toBe(
      'senior',
    );
    expect(itemCategory(it('Chelsea F.C. Women', "women's association football club"))).toBe('women');
    expect(itemCategory(it('X', 'y', ['Q28140340']))).toBe('women');
    expect(
      itemCategory(
        it('Boca Juniors Reserves and Academy', 'reserve and youth academy teams of Boca Juniors'),
      ),
    ).toBe('youth');
    expect(
      itemCategory(it('Real Madrid Castilla', 'association football reserve team of Real Madrid CF')),
    ).toBe('reserve');
    expect(itemCategory(it('FC Barcelona B', 'Spanish football team'))).toBe('reserve');
  });

  it('nome comparável sem acento, caixa e pontuação', () => {
    expect(normalizeTeamName('Estudiantes L.P.')).toBe(normalizeTeamName('Estudiantes LP'));
    expect(normalizeTeamName('Atlético-MG')).toBe('atletico mg');
  });

  it('resolve o time: clube do mesmo país e da mesma categoria; mais de um é ambíguo; nenhum, sem QID', () => {
    const items = new Map([
      ['Q2714', item({ label: 'Watford F.C.', countries: ['United Kingdom'] })],
      ['Q99', item({ label: 'Watford', types: ['Q515'], countries: ['United Kingdom'] })], // a cidade
      // Chelsea masculino (Q103229495) e o feminino
      ['Q9616', item({ label: 'Chelsea F.C.', types: ['Q103229495'], countries: ['United Kingdom'] })],
      [
        'Q1023',
        item({
          label: 'Chelsea F.C. Women',
          description: "women's association football club",
          countries: ['United Kingdom'],
        }),
      ],
      ['Q160530', item({ label: 'VfL Osnabrück', countries: ['Germany'] })],
      ['Q300', item({ label: 'Y', countries: ['Germany'] })],
    ]);
    const t = (name: string, country: string, leagues: string[] = []) => ({
      providerId: '1',
      name,
      country,
      leagues,
    });
    // England → United Kingdom pelo apelido; a cidade não é clube
    expect(resolveTeam(t('Watford', 'England'), ['Q99', 'Q2714'], items)).toEqual({ qid: 'Q2714' });
    // o principal não liga com o feminino, e o feminino não liga com o principal
    expect(resolveTeam(t('Chelsea', 'England'), ['Q1023', 'Q9616'], items)).toEqual({ qid: 'Q9616' });
    expect(resolveTeam(t('Chelsea W', 'England'), ['Q1023', 'Q9616'], items)).toEqual({ qid: 'Q1023' });
    expect(resolveTeam(t('Fiorentina W', 'England'), ['Q9616'], items)).toEqual({ none: true });
    expect(resolveTeam(t('X', 'Germany'), ['Q160530', 'Q300'], items)).toEqual({
      ambiguous: ['Q160530', 'Q300'],
    });
    // país diferente
    expect(resolveTeam(t('X', 'Brazil'), ['Q160530'], items)).toEqual({ none: true });
  });

  it('Boca: o clube (só "sports club") e não as categorias de base', () => {
    const items = new Map([
      ['Q170703', item({ label: 'Boca Juniors', types: ['Q847017'], description: 'Argentine sports club' })],
      [
        'Q4936095',
        item({
          label: 'Boca Juniors Reserves and Academy',
          types: ['Q15944511', 'Q847017'],
          description: 'reserve and youth academy teams of Boca Juniors',
        }),
      ],
    ]);
    const boca = { providerId: '451', name: 'Boca Juniors', country: 'Argentina', leagues: [] };
    expect(resolveTeam(boca, ['Q4936095', 'Q170703'], items)).toEqual({ qid: 'Q170703' });
  });

  it('o time de futebol passa à frente do clube poliesportivo; outra modalidade nunca liga', () => {
    const items = new Map([
      ['Q837205', item({ label: 'Kongsvinger IL Toppfotball', countries: ['Norway'] })],
      [
        'Q1118263',
        item({
          label: 'Kongsvinger IL',
          types: ['Q847017'],
          description: 'sports club in Kongsvinger',
          countries: ['Norway'],
        }),
      ],
      [
        'Q65164760',
        item({ label: 'Legia Warsaw', description: 'Polish amputee football club', countries: ['Poland'] }),
      ],
      [
        'Q11753729',
        item({
          label: 'Legia Warszawa',
          types: ['Q847017'],
          description: 'former motorcycle speedway club from Warsaw',
          countries: ['Poland'],
        }),
      ],
    ]);
    const t = (name: string, country: string) => ({ providerId: '1', name, country, leagues: [] });
    expect(resolveTeam(t('Kongsvinger', 'Norway'), ['Q1118263', 'Q837205'], items)).toEqual({
      qid: 'Q837205',
    });
    expect(resolveTeam(t('Legia Warszawa', 'Poland'), ['Q65164760', 'Q11753729'], items)).toEqual({
      none: true,
    });
    // "basketball" na descrição de um clube de futebol não o tira (seções de outros esportes)
    expect(
      itemCategory({ label: 'X', description: 'football and basketball club', types: ['Q476028'] }),
    ).toBe('senior');
  });

  it('o clube passa à frente do item do primeiro time dele; nome inteiro igual vale pela categoria', () => {
    const items = new Map([
      ['Q162251', item({ label: '1. FC Heidenheim 1846', countries: ['Germany'] })],
      [
        'Q97927357',
        item({
          label: '1. FC Heidenheim',
          types: ['Q103229495'],
          description: "first men's team of 1. FC Heidenheim",
          countries: ['Germany'],
          partOf: ['Q162251'],
        }),
      ],
      [
        'Q113517265',
        item({ label: 'Östers IF', types: ['Q103229495'], description: "first men's soccer team" }),
      ],
      ['Q306787', item({ label: 'Östers IF' })],
      ['Q332664', item({ label: 'Willem II', countries: ['Netherlands'] })],
    ]);
    const t = (name: string, country: string) => ({ providerId: '1', name, country, leagues: [] });
    expect(resolveTeam(t('1. FC Heidenheim', 'Germany'), ['Q97927357', 'Q162251'], items)).toEqual({
      qid: 'Q162251',
    });
    expect(resolveTeam(t('Osters IF', 'Argentina'), ['Q113517265', 'Q306787'], items)).toEqual({
      qid: 'Q306787',
    });
    // "II" no fim, mas o clube se chama assim
    expect(resolveTeam(t('Willem II', 'Netherlands'), ['Q332664'], items)).toEqual({ qid: 'Q332664' });
    // o feminino de mesmo nome não entra pelo nome inteiro
    const tijuana = new Map([
      [
        'Q1103168',
        item({ label: 'Tijuana opossums', names: ['Club Tijuana', 'Xolos'], countries: ['Mexico'] }),
      ],
      [
        'Q60829969',
        item({
          label: 'Club Tijuana',
          description: "professional Mexican women's football club",
          countries: ['Mexico'],
        }),
      ],
    ]);
    expect(resolveTeam(t('Club Tijuana', 'Mexico'), ['Q60829969', 'Q1103168'], tijuana)).toEqual({
      qid: 'Q1103168',
    });
    // "Esports" é "esportes" em catalão
    expect(
      itemCategory({
        label: "Centre d'Esports Sabadell Futbol Club",
        description: 'football team',
        types: [],
      }),
    ).toBe('senior');
  });

  it('liga pelo nome contido ("Premiership" em "Scottish Premiership")', () => {
    const items = new Map([
      [
        'Q19593',
        item({ label: 'Celtic F.C.', countries: ['United Kingdom'], leagues: ['Scottish Premiership'] }),
      ],
      [
        'Q1849964',
        item({
          label: 'Stalybridge Celtic F.C.',
          countries: ['United Kingdom'],
          leagues: ['Northern Premier League'],
        }),
      ],
    ]);
    const celtic = { providerId: '247', name: 'Celtic', country: 'Scotland', leagues: ['Premiership'] };
    expect(resolveTeam(celtic, ['Q1849964', 'Q19593'], items)).toEqual({ qid: 'Q19593' });
  });

  it('homônimos do mesmo país: desempata pelo nome exato e depois pela liga', () => {
    const items = new Map([
      [
        'Q214940',
        item({
          label: 'Estudiantes de La Plata',
          names: ['Estudiantes de La Plata', 'Estudiantes LP'],
          leagues: ['Argentine Primera División', 'Liga Profesional Argentina'],
        }),
      ],
      [
        'Q2006',
        item({
          label: 'Club Atlético Estudiantes',
          names: ['CA Estudiantes'],
          leagues: ['Primera B Metropolitana'],
        }),
      ],
    ]);
    const t = (name: string, leagues: string[]) => ({
      providerId: '450',
      name,
      country: 'Argentina',
      leagues,
    });
    expect(resolveTeam(t('Estudiantes L.P.', []), ['Q2006', 'Q214940'], items)).toEqual({ qid: 'Q214940' });
    // sem nome exato: a liga em que o time jogou decide
    expect(
      resolveTeam(t('Estudiantes', ['Liga Profesional Argentina']), ['Q2006', 'Q214940'], items),
    ).toEqual({
      qid: 'Q214940',
    });
    // nem nome nem liga: ambíguo
    expect(resolveTeam(t('Estudiantes', ['Copa Argentina']), ['Q2006', 'Q214940'], items)).toEqual({
      ambiguous: ['Q2006', 'Q214940'],
    });
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
      prec: { type: 'literal' as const, value: '11' },
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

  it('nascimento só com precisão de dia: só o ano ou o mês não vira 1º de janeiro gravado como exato', () => {
    const q = teamPlayersQuery(['Q100']);
    expect(q).toContain('wikibase:timePrecision ?prec');
    expect(q).toContain('FILTER(?prec >= 11)');
    expect(q).toContain('wikibase:DeprecatedRank');
    expect(q).not.toContain('wdt:P569');
    const row = (prec?: string) => ({
      player: { type: 'uri' as const, value: 'http://www.wikidata.org/entity/Q1' },
      team: { type: 'uri' as const, value: 'http://www.wikidata.org/entity/Q100' },
      birth: { type: 'literal' as const, value: '2004-01-01T00:00:00Z' },
      label: { type: 'literal' as const, value: 'Juan Durán' },
      ...(prec ? { prec: { type: 'literal' as const, value: prec } } : {}),
    });
    // 9 = ano, 10 = mês; sem ?prec (consulta antiga)
    expect(teamPlayers([row('9'), row('10'), row()])).toEqual([]);
    expect(teamPlayers([row('11')]).map((p) => p.birthDate)).toEqual(['2004-01-01']);
  });

  it('país dos dois lados para resolver o time: sem país no core ou sem P17 no item, não resolve', () => {
    const t = (country: string | null) => ({ providerId: '1', name: 'Nacional', country, leagues: [] });
    const uy = new Map([['Q1', item({ label: 'Nacional', countries: ['Uruguay'] })]]);
    expect(resolveTeam(t('Uruguay'), ['Q1'], uy)).toEqual({ qid: 'Q1' });
    // homônimo de outro país passaria com o país ausente de um dos lados
    expect(resolveTeam(t(null), ['Q1'], uy)).toEqual({ none: true });
    const semPais = new Map([['Q2', item({ label: 'Nacional', countries: [] })]]);
    expect(resolveTeam(t('Colombia'), ['Q2'], semPais)).toEqual({ none: true });
  });

  it('o item "first team" só perde para o clube quando o clube está entre os candidatos', () => {
    const t = { providerId: '1', name: 'Heidenheim', country: 'Germany', leagues: [] };
    const items = new Map([
      [
        'Q97927357',
        item({
          label: 'Heidenheim',
          types: ['Q103229495'],
          description: "first men's team of 1. FC Heidenheim",
          countries: ['Germany'],
          partOf: ['Q162251'],
        }),
      ],
      // outro clube do país, sem o nome exato; o clube pai (Q162251) não veio na busca
      ['Q555', item({ label: 'SC Heidenheim 1911', countries: ['Germany'] })],
    ]);
    // antes, o "first team" saía e o outro clube ficava como resolução única
    expect(resolveTeam(t, ['Q97927357', 'Q555'], items)).toEqual({ qid: 'Q97927357' });
  });
});
