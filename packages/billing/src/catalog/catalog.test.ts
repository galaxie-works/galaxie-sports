import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_MODULES,
  API_PLANS,
  DATA_MODULES,
  ENGAGE_MODULES,
  MODULE_LIMITS,
  PLAN_MODULES,
  PLANS_WITHOUT_REALTIME,
} from '@galaxie/db/schema';
import {
  CATALOG_FILES,
  CatalogConfigError,
  catalogVersion,
  featuresFor,
  loadCatalog,
  meetsRequirement,
  parseCatalog,
  type CatalogFile,
} from './catalog.js';
import { defaultCatalogDir } from './paths.js';
import { loadPlans } from './plans.js';

const realTexts = (): Record<CatalogFile, string> =>
  Object.fromEntries(
    CATALOG_FILES.map((f) => [f, readFileSync(join(defaultCatalogDir(), f), 'utf8')]),
  ) as Record<CatalogFile, string>;

/** Catálogo real com um arquivo trocado por uma transformação do texto. */
const withFile = (f: CatalogFile, edit: (s: string) => string) => {
  const t = realTexts();
  t[f] = edit(t[f]);
  return t;
};

const problemsOf = (texts: Record<CatalogFile, string>): string[] => {
  try {
    parseCatalog(texts);
  } catch (err) {
    if (err instanceof CatalogConfigError) return err.problems;
    throw err;
  }
  return [];
};

describe('config/catalog', () => {
  const catalog = loadCatalog();

  it('carrega e valida o catálogo real', () => {
    expect(Object.keys(catalog.modules).sort()).toEqual([...API_MODULES].sort());
    expect(Object.keys(catalog.plans).sort()).toEqual([...API_PLANS].sort());
    expect(catalog.version).toMatch(/^sha256:[0-9a-f]{12}$/);
  });

  it('nenhum preço no catálogo: a repo é pública', () => {
    for (const text of Object.values(realTexts())) expect(text).not.toMatch(/\b(price|preco|usd|brl)\s*:/i);
  });

  describe('transição: o catálogo bate com as constantes que o código ainda usa', () => {
    it('módulos de dados e de engajamento', () => {
      const data = API_MODULES.filter((m) => catalog.modules[m].kind === 'data');
      const engage = API_MODULES.filter((m) => catalog.modules[m].kind === 'engage');
      expect(data.sort()).toEqual([...DATA_MODULES].sort());
      expect(engage.sort()).toEqual([...ENGAGE_MODULES].sort());
    });

    it('módulos de cada plano (PLAN_MODULES)', () => {
      for (const p of API_PLANS)
        expect([...catalog.plans[p].modules].sort(), p).toEqual([...PLAN_MODULES[p]].sort());
    });

    it('faixas do engajamento (MODULE_LIMITS)', () => {
      for (const [key, def] of Object.entries(MODULE_LIMITS)) {
        const t = catalog.modules[def.module].tiers[key];
        expect(t, key).toBeDefined();
        expect({ min: t!.min, max: t!.max, default: t!.default, values: t!.values ?? null }, key).toEqual({
          min: def.min,
          max: def.max,
          default: def.default,
          values: def.tiers ? [...def.tiers] : null,
        });
      }
      const engageTiers = ENGAGE_MODULES.flatMap((m) => Object.keys(catalog.modules[m].tiers));
      expect(engageTiers.sort()).toEqual(Object.keys(MODULE_LIMITS).sort());
    });

    it('tempo real fora do trial (PLANS_WITHOUT_REALTIME)', () => {
      for (const p of API_PLANS) {
        const f = featuresFor(catalog, p, catalog.plans[p].modules);
        const has = f.includes('realtime.sse') && f.includes('realtime.webhooks');
        expect(has, p).toBe(!PLANS_WITHOUT_REALTIME.includes(p));
      }
    });

    it('loadPlans lê o mesmo plans.yaml do catálogo', () => {
      expect(loadPlans()).toEqual(catalog.plans);
    });
  });

  it('features derivadas respeitam as dependências', () => {
    expect(featuresFor(catalog, 'enterprise', ['communities'])).not.toContain('communities.match_room');
    expect(featuresFor(catalog, 'enterprise', ['communities', 'live_chat'])).toContain(
      'communities.match_room',
    );
    expect(featuresFor(catalog, 'core_data', ['cosmos_ai'])).not.toContain('cosmos_ai.moderation');
    expect(featuresFor(catalog, 'core_data', ['cosmos_ai', 'live_chat'])).toContain('cosmos_ai.moderation');
  });

  it('módulo de engajamento (fora a Cosmos) exige plano a partir do Fan Experience (PL4)', () => {
    for (const m of ['live_chat', 'communities', 'gamification', 'shopping'] as const) {
      expect(meetsRequirement(catalog.modules[m].requires, 'core_data', []), m).toBe(false);
      expect(meetsRequirement(catalog.modules[m].requires, 'fan_experience', []), m).toBe(true);
    }
    expect(meetsRequirement(catalog.modules.cosmos_ai.requires, 'core_data', [])).toBe(true);
  });

  it('a versão não depende do fim de linha', () => {
    const lf = realTexts();
    const crlf = Object.fromEntries(
      Object.entries(lf).map(([k, v]) => [k, v.replace(/\r?\n/g, '\r\n')]),
    ) as Record<CatalogFile, string>;
    expect(catalogVersion(crlf)).toBe(catalogVersion(lf));
    expect(catalogVersion(withFile('capacity.yaml', (s) => s.replace('C1\n', 'C2\n')))).not.toBe(
      catalogVersion(lf),
    );
  });
});

describe('consistência do catálogo', () => {
  it('dependência circular entre módulos', () => {
    const p = problemsOf(
      withFile('modules.yaml', (s) =>
        s.replace(
          'communities.wall: {}',
          'communities.wall:\n        requires:\n          modules: [gamification]',
        ),
      ),
    );
    expect(p.some((x) => x.startsWith('dependência circular'))).toBe(true);
  });

  it('plano com módulo de engajamento', () => {
    const p = problemsOf(
      withFile('plans.yaml', (s) =>
        s.replace('modules: [core_data]\n    markets', 'modules: [core_data, live_chat]\n    markets'),
      ),
    );
    expect(p.some((x) => x.includes('inclui o módulo de engajamento live_chat'))).toBe(true);
  });

  it('plano com módulo inexistente', () => {
    const p = problemsOf(
      withFile('plans.yaml', (s) => s.replace('modules: [core_data]', 'modules: [core_data, nope]')),
    );
    expect(p.some((x) => x.includes('plans.yaml'))).toBe(true);
  });

  it('módulo sem feature', () => {
    const p = problemsOf(
      withFile('modules.yaml', (s) =>
        s.replace('    features:\n      shopping.links: {}', '    features: {}'),
      ),
    );
    expect(p).toContain('módulo shopping sem feature');
  });

  it('faixa do plano fora do aceito e de módulo fora do plano', () => {
    const p = problemsOf(
      withFile('plans.yaml', (s) =>
        s
          .replace('      where_to_watch.markets: 3', '      where_to_watch.markets: 0')
          .replace(
            '    selfService: true\n\n  fan_experience',
            '    selfService: true\n    tiers:\n      where_to_watch.markets: 2\n\n  fan_experience',
          ),
      ),
    );
    expect(p).toContain('plano fan_experience: faixa where_to_watch.markets = 0 fora do aceito');
    expect(p).toContain('plano core_data: faixa where_to_watch.markets de módulo fora do plano');
  });

  it('feature limitada a um plano que não tem o módulo', () => {
    const p = problemsOf(
      withFile('modules.yaml', (s) =>
        s.replace('where_to_watch.rest: {}', 'where_to_watch.rest:\n        plans: [core_data]'),
      ),
    );
    expect(p).toContain(
      'feature where_to_watch.rest limitada ao plano core_data, que não inclui o módulo where_to_watch',
    );
  });

  it('faixa de capacidade que não cresce', () => {
    const p = problemsOf(
      withFile('capacity.yaml', (s) => s.replace('viewsPerMonth: 10000000', 'viewsPerMonth: 1000')),
    );
    expect(p).toContain('capacity.yaml: C2.viewsPerMonth não cresce em relação à faixa anterior');
  });

  it('add-on apontando para faixa de outro módulo', () => {
    const p = problemsOf(
      withFile('addons.yaml', (s) =>
        s.replace('tier: where_to_watch.markets', 'tier: live_intelligence.enriched_games'),
      ),
    );
    expect(p).toContain(
      'add-on where_to_watch.extra_markets: faixa live_intelligence.enriched_games não é do módulo where_to_watch',
    );
  });

  it('campo desconhecido reprova (sem erro de digitação passando calado)', () => {
    const p = problemsOf(
      withFile('modules.yaml', (s) =>
        s.replace('    kind: data\n    name: Odds', '    kind: data\n    nome: Odds\n    name: Odds'),
      ),
    );
    expect(p.some((x) => x.startsWith('modules.yaml modules.odds'))).toBe(true);
  });
});

it('o pacote importa o @galaxie/db só por subcaminhos (o índice traz o migrator, que o Next não empacota)', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = join(import.meta.dirname, '..');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
  for (const f of files) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/from '@galaxie\/db'/);
});
