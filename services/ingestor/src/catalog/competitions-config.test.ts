import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadFootballCatalog, loadSportCatalog } from './catalog-config.js';
import { OTHER_SPORTS } from './sport-catalog.js';

const configDir = resolve(import.meta.dirname, '../../../../config/competitions');

describe('config/competitions/<esporte>.yaml', () => {
  it.each(OTHER_SPORTS)('%s segue o schema do football.yaml', async (sport) => {
    const doc = parse(await readFile(resolve(configDir, `${sport}.yaml`), 'utf8')) as {
      schema_version: number;
      sport: string;
    };
    expect(doc).toMatchObject({ schema_version: 1, sport });
    const catalog = await loadSportCatalog(resolve(configDir, `${sport}.yaml`));
    expect(catalog.length).toBeGreaterThan(0);
    const slugs = new Set<string>();
    const ids = new Set<string>();
    for (const c of catalog) {
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(slugs.has(c.slug), `slug repetido: ${c.slug}`).toBe(false);
      slugs.add(c.slug);
      expect(['league', 'cup']).toContain(c.type);
      expect([1, 2, 3]).toContain(c.tier);
      expect(['high', 'medium', 'low', 'none']).toContain(c.live_priority);
      expect(['calendar-year', 'split-year']).toContain(c.seasons_strategy);
      expect(c.api_sports_id, c.slug).not.toBeNull();
      expect(ids.has(String(c.api_sports_id)), `ID repetido: ${c.api_sports_id}`).toBe(false);
      ids.add(String(c.api_sports_id));
    }
  });

  it('as prioridades latino-americanas estão no tier 1', async () => {
    const tier1 = async (sport: string) =>
      (await loadSportCatalog(resolve(configDir, `${sport}.yaml`)))
        .filter((c) => c.tier === 1)
        .map((c) => c.api_sports_id);
    expect(await tier1('basketball')).toEqual(expect.arrayContaining([26, 18]));
    expect(await tier1('volleyball')).toEqual(expect.arrayContaining([25, 24, 4, 183, 184]));
    expect(await tier1('nba')).toEqual(['standard']);
    expect(await tier1('formula-1')).toEqual(['world-championship']);
  });

  it('prestígio (docs/06 §3): 0–10, máximo nas copas continentais e torneios de seleções', async () => {
    const football = await loadFootballCatalog(resolve(configDir, 'football.yaml'));
    for (const c of football) {
      if (c.prestige === undefined) continue;
      expect(Number.isInteger(c.prestige), c.slug).toBe(true);
      expect(c.prestige, c.slug).toBeGreaterThanOrEqual(0);
      expect(c.prestige, c.slug).toBeLessThanOrEqual(10);
    }
    const prestige = new Map(football.map((c) => [c.slug, c.prestige ?? 0]));
    for (const slug of ['conmebol-libertadores', 'uefa-champions-league', 'fifa-world-cup', 'copa-america'])
      expect(prestige.get(slug), slug).toBe(10);
    expect(prestige.get('conmebol-sudamericana')).toBe(5);
    expect(prestige.get('uefa-europa-league')).toBe(5);
    // ligas nacionais não têm prestígio: o tier já as pondera
    expect(prestige.get('brasileirao-serie-a')).toBe(0);
    expect(prestige.get('premier-league')).toBe(0);
  });

  it('esporte sem arquivo vira catálogo vazio', async () => {
    expect(await loadSportCatalog(resolve(configDir, 'inexistente.yaml'))).toEqual([]);
  });
});
