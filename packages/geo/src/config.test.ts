import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { audienceFor } from './audience.js';
import { GeoConfigError, loadGeoConfig, parseGeoConfig } from './config.js';

const competitionsDir = fileURLToPath(new URL('../../../config/competitions/', import.meta.url));
const geoDir = fileURLToPath(new URL('../../../config/geo/', import.meta.url));

interface CatalogEntry {
  slug: string;
  country: string;
  tier: number;
}

/** Catálogos config/competitions/<esporte>.yaml, por esporte. */
const catalogs = new Map(
  readdirSync(competitionsDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => {
      const doc = parse(readFileSync(competitionsDir + f, 'utf8')) as {
        sport: string;
        competitions: CatalogEntry[];
      };
      return [doc.sport, doc.competitions] as const;
    }),
);

const regionCode = (country: string) => country.toUpperCase().replace(/[^A-Z0-9]+/g, '-');

describe('config/geo do repositório', () => {
  const geo = loadGeoConfig(geoDir);

  it('tem as seis confederações com os membros da FIFA, sem país repetido', () => {
    expect(geo.confederations.map((c) => c.code)).toEqual([
      'CONMEBOL',
      'CONCACAF',
      'UEFA',
      'AFC',
      'CAF',
      'OFC',
    ]);
    const sizes = Object.fromEntries(geo.confederations.map((c) => [c.code, c.members.length]));
    expect(sizes).toEqual({ CONMEBOL: 10, CONCACAF: 41, UEFA: 55, AFC: 47, CAF: 54, OFC: 11 });
    expect(geo.allCountries()).toHaveLength(218);
    expect(geo.country('gb-eng')).toMatchObject({ confederation: 'UEFA', name: { 'pt-BR': 'Inglaterra' } });
    expect(geo.country('MX')).toMatchObject({ confederation: 'CONCACAF', ioc: 'MEX' });
    expect(geo.country('BR')).toMatchObject({ confederation: 'CONMEBOL', ioc: 'BRA' });
  });

  it('navegação: os 10 da CONMEBOL + México + 6 europeus, todos com nome em pt-BR e es', () => {
    expect(geo.navigationCountries).toEqual(
      expect.arrayContaining(['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'PY', 'PE', 'UY', 'VE', 'MX']),
    );
    expect(geo.navigationCountries).toEqual(expect.arrayContaining(['GB-ENG', 'ES', 'IT', 'DE', 'FR', 'PT']));
    expect(geo.navigationCountries).toHaveLength(17);
    for (const code of geo.navigationCountries) {
      const c = geo.country(code)!;
      expect(c.name['pt-BR'], code).toBeTruthy();
      expect(c.name.es, code).toBeTruthy();
    }
  });

  it('mercados ativos da relevância por país: os 10 da CONMEBOL + México', () => {
    expect(geo.markets).toEqual(['BR', 'AR', 'UY', 'CL', 'CO', 'PY', 'PE', 'EC', 'BO', 'VE', 'MX']);
  });

  it('navegação: os 12 esportes, um por catálogo de competições, futebol primeiro', () => {
    expect(geo.navigationSports[0]!.slug).toBe('football');
    expect(geo.navigationSports.map((s) => s.slug).sort()).toEqual([...catalogs.keys()].sort());
    for (const s of geo.navigationSports) expect(s.name['pt-BR'] && s.name.es, s.slug).toBeTruthy();
  });

  it('toda competição do escopo existe no catálogo do esporte (ou tem api_sports_id)', () => {
    for (const sport of geo.scopedSports()) {
      const slugs = new Set((catalogs.get(sport) ?? []).map((c) => c.slug));
      expect(catalogs.has(sport), sport).toBe(true);
      for (const e of geo.scopeEntries(sport)) {
        if (e.apiSportsId === null) expect(slugs.has(e.slug), `${sport}/${e.slug}`).toBe(true);
        else expect(slugs.has(e.slug), `${sport}/${e.slug} não deveria ter api_sports_id`).toBe(false);
      }
      for (const slug of geo.featuredSlugs(sport))
        expect(slugs.has(slug), `featured ${sport}/${slug}`).toBe(true);
      for (const slug of geo.regionalSlugs(sport))
        expect(slugs.has(slug), `regional ${sport}/${slug}`).toBe(true);
    }
  });

  it('toda doméstica do Brasil no catálogo é nacional (featured) ou regional, sem cair na mistura', () => {
    // uma competição nova sem nível voltaria a misturar estaduais com as nacionais na página do país
    const unclassified = (catalogs.get('football') ?? [])
      .filter((c) => c.country === 'Brazil' && c.tier <= 2)
      .filter((c) => geo.featuredOrder('football', c.slug) === null && !geo.isRegional('football', c.slug))
      .map((c) => c.slug);
    expect(unclassified).toEqual([]);
  });

  it('nível: Série A e D nacionais (divisões antes das copas), Carioca e Copa do Nordeste regionais', () => {
    expect(geo.competitionLevel('football', 'brasileirao-serie-a', 'BR')).toBe('national');
    expect(geo.competitionLevel('football', 'brasileirao-serie-d', 'BR')).toBe('national');
    expect(geo.competitionLevel('football', 'carioca', 'BR')).toBe('regional');
    expect(geo.competitionLevel('football', 'copa-do-nordeste', 'BR')).toBe('regional');
    expect(geo.competitionLevel('football', 'conmebol-libertadores', 'WORLD')).toBeNull();
    expect(geo.competitionLevel('football', 'conmebol-libertadores', null)).toBeNull();
    const nationals = [
      'brasileirao-serie-a',
      'brasileirao-serie-b',
      'brasileirao-serie-c',
      'brasileirao-serie-d',
      'copa-do-brasil',
      'supercopa-do-brasil',
    ];
    const order = nationals.map((slug) => geo.featuredOrder('football', slug)!);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('toda competição internacional do catálogo está mapeada ou excluída', () => {
    const missing: string[] = [];
    for (const [sport, comps] of catalogs) {
      const mapped = new Set(geo.scopeEntries(sport).map((e) => e.slug));
      for (const c of comps) {
        const code = regionCode(c.country);
        const international = c.country === 'World' || code in geo.regions;
        if (international && !mapped.has(c.slug) && !geo.isExcluded(sport, c.slug))
          missing.push(`${sport}/${c.slug}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('Libertadores e Sul-Americana unem os países da CONMEBOL; Champions só a UEFA', () => {
    const lib = geo.scopeEntries('football').find((e) => e.slug === 'conmebol-libertadores')!;
    for (const code of ['BR', 'AR', 'UY', 'VE']) expect(geo.participates(lib, code)).toBe(true);
    expect(geo.participates(lib, 'MX')).toBe(false);
    expect(geo.participates(lib, 'ES')).toBe(false);

    const br = geo.internationalFor('BR', 'football').map((e) => e.slug);
    const ar = geo.internationalFor('AR', 'football').map((e) => e.slug);
    expect(br).toEqual(
      expect.arrayContaining(['conmebol-libertadores', 'conmebol-sudamericana', 'conmebol-recopa']),
    );
    expect(br.filter((s) => ar.includes(s))).toEqual(br); // mesma confederação → mesmas internacionais
    expect(br).not.toContain('uefa-champions-league');
    expect(br).not.toContain('leagues-cup');

    const mx = geo.internationalFor('MX', 'football').map((e) => e.slug);
    expect(mx).toEqual(
      expect.arrayContaining([
        'concacaf-champions-cup',
        'leagues-cup',
        'copa-america',
        'wc-qualification-concacaf',
      ]),
    );
    expect(mx).not.toContain('conmebol-libertadores');

    const eng = geo.internationalFor('GB-ENG', 'football').map((e) => e.slug);
    expect(eng).toEqual(expect.arrayContaining(['uefa-champions-league', 'uefa-euro', 'fifa-world-cup']));
    expect(eng).not.toContain('copa-america');
  });

  it('esportes sem recorte por país (F1, MMA) ficam fora da navegação por país', () => {
    expect(geo.isExcluded('formula-1', 'formula-1-world-championship')).toBe(true);
    expect(geo.internationalFor('BR', 'formula-1')).toEqual([]);
  });

  it('audiência: toda competição existe no catálogo e todo mercado está entre os ativos', () => {
    for (const market of geo.audience.markets()) expect(geo.markets, market).toContain(market);
    for (const market of geo.markets)
      for (const e of geo.audience.entries(market)) {
        const slugs = new Set((catalogs.get(e.sport) ?? []).map((c) => c.slug));
        expect(slugs.has(e.slug), `${market} ${e.sport}/${e.slug}`).toBe(true);
      }
  });

  it('audiência: a liga nacional de 1ª divisão pesa no próprio país (35), não nos vizinhos', () => {
    const top: Record<string, string> = {
      BR: 'brasileirao-serie-a',
      AR: 'argentina-liga-profesional',
      UY: 'uruguay-primera',
      CL: 'chile-primera-division',
      CO: 'colombia-primera-a',
      PY: 'paraguay-primera-clausura',
      PE: 'peru-liga-1',
      EC: 'ecuador-ligapro-serie-a',
      BO: 'bolivia-primera-division',
      VE: 'venezuela-primera-division',
      MX: 'liga-mx',
    };
    for (const market of geo.markets) {
      expect(geo.audience.points(market, 'football', top[market]), market).toBe(35);
      const country = (catalogs.get('football') ?? []).find((c) => c.slug === top[market])!.country;
      expect(country, market).not.toBe('World');
    }
    expect(geo.audience.points('MX', 'football', 'brasileirao-serie-a')).toBe(0);
    expect(geo.audience.points('BR', 'football', 'liga-mx')).toBe(0);
    expect(geo.audience.points('MX', 'football', 'liga-mx-femenil')).toBe(25);
  });

  it('audiência: Premier League e LaLiga (20) e as outras grandes europeias (16) em todo mercado', () => {
    for (const market of geo.markets) {
      expect(geo.audience.points(market, 'football', 'premier-league'), market).toBe(20);
      expect(geo.audience.points(market, 'football', 'laliga'), market).toBe(20);
      for (const slug of ['serie-a-italia', 'bundesliga', 'ligue-1', 'uefa-champions-league'])
        expect(geo.audience.points(market, 'football', slug), `${market} ${slug}`).toBe(16);
    }
  });
});

describe('parseGeoConfig', () => {
  const name = { en: 'X', 'pt-BR': 'X', es: 'X' };
  const geo = (over: Record<string, unknown> = {}) => ({
    schema_version: 1,
    navigation: { countries: ['BR'], sports: [{ slug: 'football', name }] },
    regions: { 'SOUTH-AMERICA': 'CONMEBOL' },
    confederations: [
      {
        code: 'CONMEBOL',
        name,
        members: [
          { code: 'BR', ioc: 'BRA', name },
          { code: 'AR', name },
        ],
      },
      { code: 'UEFA', name, members: [{ code: 'GB-ENG', name: { en: 'England' } }] },
    ],
    ...over,
  });
  const scope = (competitions: unknown[] = [], extra: Record<string, unknown> = {}) => ({
    schema_version: 1,
    sports: { football: { competitions, ...extra } },
  });

  it('aceita a configuração mínima e aplica padrões', () => {
    const cfg = parseGeoConfig(
      geo(),
      scope([{ slug: 'cup', scope: 'continental_clubs', confederations: ['CONMEBOL'] }]),
    );
    expect(cfg.scopeEntries('football')[0]).toMatchObject({ countries: [], apiSportsId: null, order: 0 });
    expect(cfg.country('ar')!.ioc).toBeNull();
    expect(cfg.markets).toEqual([]);
  });

  it.each([
    [
      'país em duas confederações',
      geo({
        confederations: [
          { code: 'CONMEBOL', name, members: [{ code: 'BR', name }] },
          { code: 'UEFA', name, members: [{ code: 'BR', name }] },
        ],
      }),
      scope(),
    ],
    [
      'país da navegação sem tradução',
      geo({ navigation: { countries: ['GB-ENG'], sports: [{ slug: 'football', name }] } }),
      scope(),
    ],
    [
      'país da navegação fora das confederações',
      geo({ navigation: { countries: ['US'], sports: [{ slug: 'football', name }] } }),
      scope(),
    ],
    ['mercado fora das confederações', geo({ markets: ['US'] }), scope()],
    ['mercado repetido', geo({ markets: ['BR', 'BR'] }), scope()],
    [
      'confederação inexistente no escopo',
      geo(),
      scope([{ slug: 'a', scope: 'national_teams', confederations: ['XYZ'] }]),
    ],
    [
      'país desconhecido no escopo',
      geo(),
      scope([{ slug: 'a', scope: 'national_teams', countries: ['US'] }]),
    ],
    ['escopo sem participantes', geo(), scope([{ slug: 'a', scope: 'national_teams' }])],
    ['escopo doméstico no arquivo', geo(), scope([{ slug: 'a', scope: 'domestic', countries: ['BR'] }])],
    [
      'campo desconhecido',
      geo(),
      scope([{ slug: 'a', scope: 'world_clubs', confederations: ['FIFA'], tier: 1 }]),
    ],
    [
      'mapeada e excluída',
      geo(),
      scope([{ slug: 'a', scope: 'world_clubs', confederations: ['FIFA'] }], { excluded: ['a'] }),
    ],
    ['região com confederação inexistente', geo({ regions: { EUROPE: 'XYZ' } }), scope()],
    [
      'código de país inválido',
      geo({ navigation: { countries: ['bra'], sports: [{ slug: 'football', name }] } }),
      scope(),
    ],
  ])('rejeita %s', (_label, g, s) => {
    expect(() => parseGeoConfig(g, s)).toThrow(GeoConfigError);
  });

  it('audiência: o mercado sobrescreve `common`; sem arquivo, nenhuma competição soma', () => {
    const cfg = parseGeoConfig(geo(), scope(), {
      schema_version: 1,
      common: { football: { 'liga-a': 20, 'liga-b': 15 } },
      markets: { AR: { football: { 'liga-a': 5, 'liga-c': 35 } }, GB: { football: { 'liga-b': 0 } } },
    });
    expect(cfg.audience.points('AR', 'football', 'liga-a')).toBe(5);
    expect(cfg.audience.points('AR', 'football', 'liga-b')).toBe(15);
    expect(cfg.audience.points('AR', 'football', 'liga-c')).toBe(35);
    expect(cfg.audience.points('BR', 'football', 'liga-a')).toBe(20);
    expect(cfg.audience.points('BR', 'football', 'liga-c')).toBe(0);
    expect(cfg.audience.points('BR', 'basketball', 'liga-a')).toBe(0);
    expect(cfg.audience.points('GB', 'football', 'liga-b')).toBe(0);
    expect(cfg.audience.entries('GB')).toEqual([{ sport: 'football', slug: 'liga-a', points: 20 }]);
    expect(parseGeoConfig(geo(), scope()).audience.points('BR', 'football', 'liga-a')).toBe(0);
  });

  it('audiência efetiva: inteira até importância 44, proporcional acima (sem empatar no teto)', () => {
    expect(audienceFor(35, 29)).toBe(35);
    expect(audienceFor(35, 44)).toBe(35);
    expect(audienceFor(35, 70)).toBe(19);
    expect(audienceFor(35, 88)).toBe(8);
    expect(audienceFor(35, 100)).toBe(0);
    expect(audienceFor(0, 10)).toBe(0);
  });

  it.each([
    ['mercado desconhecido', { schema_version: 1, markets: { US: { football: { a: 10 } } } }],
    ['pontos acima do teto', { schema_version: 1, common: { football: { a: 41 } } }],
    ['pontos fracionados', { schema_version: 1, common: { football: { a: 7.5 } } }],
  ])('audiência: rejeita %s', (_label, a) => {
    expect(() => parseGeoConfig(geo(), scope(), a)).toThrow(GeoConfigError);
  });
});
