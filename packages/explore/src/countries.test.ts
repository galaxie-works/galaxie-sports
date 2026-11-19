import { describe, expect, it } from 'vitest';
import { loadGeoConfig } from '@galaxie/geo';
import type { CatalogItem } from './choices.js';
import { compareCountries, mainLeagues, type CountryOrderKey } from './countries.js';

const geo = loadGeoConfig();

const league = (slug: string, countryCode: string, tier: number, recent = 100): CatalogItem => ({
  id: slug,
  sport: 'football',
  slug,
  type: 'league',
  tier,
  prestige: 0,
  countryCode,
  recent,
});

// as ligas do catálogo ativo como estão no banco de dev (19/11): Portugal e Venezuela têm a segunda divisão com mais
// jogos no ano que a primeira, e era isso que escolhia a "liga principal" quando as duas empatavam no tier
const catalog: CatalogItem[] = [
  league('brasileirao-serie-a', 'BR', 1, 428),
  league('brasileirao-serie-b', 'BR', 2, 390),
  league('paulista-a1', 'BR', 1, 72),
  league('argentina-copa-de-la-liga', 'AR', 1, 0),
  league('argentina-liga-profesional', 'AR', 1, 518),
  league('liga-bpi', 'PT', 2, 98),
  league('liga-portugal-2', 'PT', 2, 335),
  league('primeira-liga', 'PT', 2, 334),
  league('venezuela-primera-division', 'VE', 2, 234),
  league('venezuela-segunda-division', 'VE', 2, 267),
  league('bolivia-nacional-b', 'BO', 2, 300),
  league('bolivia-primera-division', 'BO', 2, 276),
  league('liga-mx', 'MX', 1, 337),
  league('mls', 'US', 2, 531),
  league('eredivisie', 'NL', 2, 346),
  league('premier-league', 'GB-ENG', 1, 420),
  league('efl-championship', 'GB-ENG', 2, 632),
  league('saudi-pro-league', 'SA', 2, 376),
  { ...league('copa-do-brasil', 'BR', 1, 120), type: 'cup' },
  // copa de clubes de fora do país e uma liga tier 3 (só espelho) não colocam ninguém na navegação
  { ...league('conmebol-libertadores', 'WORLD', 1, 150), type: 'cup' },
  league('jupiler-pro-league', 'BE', 3, 300),
  // estadual sozinho não basta
  league('carioca', 'CL', 1, 60),
  { ...league('nbb', 'CL', 1, 80), sport: 'basketball' },
];

describe('mainLeagues: países e liga principal a partir do catálogo', () => {
  const mains = mainLeagues(catalog, geo);

  it('Portugal mostra a Primeira Liga (não a Liga Portugal 2, que tem mais jogos no ano)', () => {
    expect(mains.get('PT')?.slug).toBe('primeira-liga');
  });

  it('a primeira divisão vence mesmo com menos jogos: Venezuela e Bolívia', () => {
    expect(mains.get('VE')?.slug).toBe('venezuela-primera-division');
    expect(mains.get('BO')?.slug).toBe('bolivia-primera-division');
  });

  it('Brasil e Argentina continuam com a liga de featured (Série A, Liga Profesional), não estadual nem copa', () => {
    expect(mains.get('BR')?.slug).toBe('brasileirao-serie-a');
    expect(mains.get('AR')?.slug).toBe('argentina-liga-profesional');
  });

  it('países novos entram pela liga do catálogo: EUA com a MLS, Holanda com a Eredivisie, Arábia Saudita', () => {
    expect(mains.get('US')?.slug).toBe('mls');
    expect(mains.get('NL')?.slug).toBe('eredivisie');
    expect(mains.get('SA')?.slug).toBe('saudi-pro-league');
  });

  it('fora: World, liga tier 3 (Bélgica), código que não é membro de confederação e outros esportes', () => {
    expect([...mains.keys()].sort()).toEqual(
      ['AR', 'BO', 'BR', 'GB-ENG', 'MX', 'NL', 'PT', 'SA', 'US', 'VE'].sort(),
    );
  });
});

describe('compareCountries: ordem estável por confederação e peso da liga principal', () => {
  const confederations = geo.confederations.map((c) => c.code);
  const key = (code: string, slug: string, tier: number, over: Partial<CountryOrderKey> = {}) => ({
    code,
    confederation: geo.country(code)!.confederation,
    tier,
    featured: geo.featuredOrder('football', slug),
    name: geo.country(code)!.name['pt-BR'] ?? code,
    ...over,
  });

  it('confederação na ordem de config/geo; dentro dela tier, depois a posição em featured', () => {
    const keys = [
      key('SA', 'saudi-pro-league', 2),
      key('NL', 'eredivisie', 2),
      key('US', 'mls', 2),
      key('PT', 'primeira-liga', 2),
      key('GB-ENG', 'premier-league', 1),
      key('MX', 'liga-mx', 1),
      key('VE', 'venezuela-primera-division', 2),
      key('AR', 'argentina-liga-profesional', 1),
      key('BR', 'brasileirao-serie-a', 1),
    ];
    const sorted = [...keys].sort(compareCountries(confederations, 'pt-BR'));
    expect(sorted.map((k) => [k.confederation, k.code])).toEqual([
      ['CONMEBOL', 'BR'],
      ['CONMEBOL', 'AR'],
      ['CONMEBOL', 'VE'],
      ['CONCACAF', 'MX'],
      ['CONCACAF', 'US'],
      ['UEFA', 'GB-ENG'],
      ['UEFA', 'PT'],
      ['UEFA', 'NL'],
      ['AFC', 'SA'],
    ]);
  });

  it('sem peso no catálogo, mais jogos em 7 dias e depois o nome', () => {
    const order = compareCountries(confederations, 'pt-BR');
    const a = key('NL', 'x', 2, { featured: null, upcoming: 3, name: 'Holanda' });
    const b = key('PT', 'y', 2, { featured: null, upcoming: 9, name: 'Portugal' });
    const c = key('GB-ENG', 'z', 2, { featured: null, upcoming: 3, name: 'Inglaterra' });
    expect([a, b, c].sort(order).map((k) => k.code)).toEqual(['PT', 'NL', 'GB-ENG']);
  });
});
