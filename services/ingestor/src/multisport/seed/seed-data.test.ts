import { describe, expect, it } from 'vitest';
import { WIKIPEDIA_REFERENCES } from '../qa/references.js';
import { GAMES_SEED, gamesName, gamesStatus } from './games.js';
import { NOC_SEED } from './nocs.js';
import { PROVIDER_LEAGUE_SEED } from './provider-leagues.js';
import { DISCIPLINE_SEED, disciplineAliasMap, SPORT_SEED } from './sports.js';

describe('CONs', () => {
  it('206 membros do COI, 41 da Panam Sports, códigos únicos e especiais presentes', () => {
    const codes = NOC_SEED.map((n) => n.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(NOC_SEED.filter((n) => n.iocMember)).toHaveLength(206);
    expect(NOC_SEED.filter((n) => n.panamMember)).toHaveLength(41);
    for (const c of ['AIN', 'EOR', 'ROT', 'ZZX', 'URS', 'GDR', 'FRG', 'TCH', 'YUG', 'EUN'])
      expect(codes).toContain(c);
  });

  it('equivalência COI ↔ ISO dos mercados prioritários', () => {
    const iso = Object.fromEntries(NOC_SEED.map((n) => [n.code, n.iso3]));
    expect(iso).toMatchObject({ CHI: 'CHL', URU: 'URY', PUR: 'PRI', GER: 'DEU', BRA: 'BRA', ESA: 'SLV' });
    const iso3 = NOC_SEED.filter((n) => n.kind === 'noc').map((n) => n.iso3);
    expect(new Set(iso3).size).toBe(iso3.length);
  });
});

describe('edições', () => {
  const bySlug = new Map(GAMES_SEED.map((g) => [g.slug, g]));

  it('cobre Verão 1896–2032, Inverno 1924–2030 e Pan 1951–2027', () => {
    expect(bySlug.get('og-summer-1896')).toBeDefined();
    expect(bySlug.get('og-summer-2028')).toMatchObject({ hostCity: 'Los Angeles', startDate: '2028-07-14' });
    expect(bySlug.get('og-summer-2032')).toMatchObject({ hostNoc: 'AUS', endDate: '2032-08-08' });
    expect(bySlug.get('og-winter-2026')).toMatchObject({ hostNoc: 'ITA', startDate: '2026-02-06' });
    expect(bySlug.get('pan-2023')).toMatchObject({
      hostNoc: 'CHI',
      startDate: '2023-10-20',
      endDate: '2023-11-05',
    });
    expect(bySlug.get('pan-2027')).toMatchObject({
      startDate: '2027-07-23',
      endDate: '2027-08-08',
      tz: 'America/Lima',
    });
    expect(GAMES_SEED.filter((g) => g.type === 'PAN')).toHaveLength(20);
    expect(GAMES_SEED.some((g) => [1916, 1940, 1944].includes(g.year) && g.season === 'summer')).toBe(false);
  });

  it('slugs únicos, datas coerentes e sede entre os CONs', () => {
    const codes = new Set(NOC_SEED.map((n) => n.code));
    expect(new Set(GAMES_SEED.map((g) => g.slug)).size).toBe(GAMES_SEED.length);
    for (const g of GAMES_SEED) {
      expect(g.startDate <= g.endDate).toBe(true);
      expect(codes.has(g.hostNoc)).toBe(true);
    }
  });

  it('status pela data e nomes localizados', () => {
    const lima = bySlug.get('pan-2027')!;
    expect(gamesStatus(lima, '2026-10-21')).toBe('upcoming');
    expect(gamesStatus(lima, '2027-07-30')).toBe('in_progress');
    expect(gamesStatus(bySlug.get('og-winter-2026')!, '2026-10-21')).toBe('completed');
    expect(gamesName(lima)['pt-BR']).toBe('Jogos Pan-Americanos Lima 2027');
    expect(gamesName(bySlug.get('og-summer-2016')!).es).toBe('Juegos Olímpicos Rio de Janeiro 2016');
  });
});

describe('esportes, ligas e referências', () => {
  it('disciplinas apontam para esportes existentes e aliases não colidem', () => {
    const sports = new Set(SPORT_SEED.map((s) => s.code));
    for (const d of DISCIPLINE_SEED) expect(sports.has(d.sport)).toBe(true);
    const aliases = DISCIPLINE_SEED.flatMap((d) => d.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(disciplineAliasMap().get('judo')).toBe('JUD');
  });

  it('lutas concedem dois bronzes', () => {
    const two = DISCIPLINE_SEED.filter((d) => d.twoBronzes).map((d) => d.code);
    expect(two).toEqual(expect.arrayContaining(['JUD', 'BOX', 'TKW', 'WRE']));
  });

  it('ligas dos coletivos únicas por esporte e referências apontam para edições existentes', () => {
    const keys = PROVIDER_LEAGUE_SEED.map((p) => `${p.sport}:${p.providerLeagueId}`);
    expect(new Set(keys).size).toBe(keys.length);
    const slugs = new Set(GAMES_SEED.map((g) => g.slug));
    for (const r of WIKIPEDIA_REFERENCES) expect(slugs.has(r.games)).toBe(true);
    const bra2023 = WIKIPEDIA_REFERENCES.find((r) => r.games === 'pan-2023' && r.noc === 'BRA')!;
    expect(bra2023.gold).toBe(66);
    expect(bra2023.gold + bra2023.silver + bra2023.bronze).toBe(205);
  });
});
