import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
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
    }
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
});
