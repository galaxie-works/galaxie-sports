import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@galaxie/db';
import { createQualityContext } from './context.js';
import { MAX_STORED_FAILURES, runRules, selectRules, splitBySport } from './engine.js';
import { QUALITY_RULES } from './rules/index.js';
import type { QualityRule } from './types.js';

const rule = (over: Partial<QualityRule> = {}): QualityRule => ({
  id: 'x.rule',
  sport: 'football',
  area: 'events',
  severity: 'high',
  description: { 'pt-BR': 'x', en: 'x', es: 'x' },
  check: async () => ({ checked: 0, failures: [] }),
  ...over,
});

describe('splitBySport', () => {
  it('regra de um esporte: uma linha, errados = falhas', () => {
    const rows = splitBySport(rule(), { checked: 10, failures: [{ key: 'a', label: 'A' }] }, 5);
    expect(rows).toMatchObject([
      { sport: 'football', status: 'fail', checked: 10, failed: 1, durationMs: 5 },
    ]);
  });

  it('regra de todos os esportes: uma linha por esporte, com a contagem completa', () => {
    const rows = splitBySport(
      rule({ sport: 'all' }),
      {
        checked: { football: 100, hockey: 20, nba: 3 },
        failed: { football: 250, hockey: 0 },
        failures: [
          { key: 'a', label: 'A', sport: 'football' },
          { key: 'b', label: 'B', sport: 'nba' },
        ],
      },
      0,
    );
    expect(rows.map((r) => [r.sport, r.status, r.failed, r.checked])).toEqual([
      ['football', 'fail', 250, 250],
      ['hockey', 'pass', 0, 20],
      ['nba', 'fail', 1, 3],
    ]);
  });

  it('nada conferido ainda sai como uma linha "pass" com 0', () => {
    expect(splitBySport(rule({ sport: 'all' }), { checked: {}, failures: [] }, 0)).toMatchObject([
      { sport: 'all', status: 'pass', checked: 0, failed: 0 },
    ]);
  });

  it('guarda no máximo N falhas por esporte', () => {
    const failures = Array.from({ length: MAX_STORED_FAILURES + 50 }, (_, i) => ({
      key: String(i),
      label: String(i),
    }));
    const [row] = splitBySport(rule(), { checked: 1000, failures }, 0);
    expect(row!.failed).toBe(MAX_STORED_FAILURES + 50);
    expect(row!.failures).toHaveLength(MAX_STORED_FAILURES);
  });
});

describe('runRules', () => {
  const db = {} as Database;

  it('sem API, a regra que precisa dela sai "skipped" (nunca "pass"); erro numa regra não derruba as outras', async () => {
    const ctx = createQualityContext(db, { env: {} });
    const rows = await runRules(
      [
        rule({ id: 'a.api', needs: ['api'], check: vi.fn() }),
        rule({ id: 'b.boom', check: async () => Promise.reject(new Error('consulta quebrou')) }),
        rule({ id: 'c.ok', check: async () => ({ checked: 3, failures: [] }) }),
      ],
      ctx,
    );
    expect(rows.map((r) => [r.ruleId, r.status, r.detail])).toEqual([
      ['a.api', 'skipped', 'API não configurada (QUALITY_API_URL e QUALITY_API_KEY)'],
      ['b.boom', 'error', 'consulta quebrou'],
      ['c.ok', 'pass', null],
    ]);
  });

  it('F1DB indisponível: skipped com o motivo', async () => {
    const ctx = createQualityContext(db, {
      env: { QUALITY_API_URL: 'http://api', QUALITY_API_KEY: 'k' },
      f1db: async () => Promise.reject(new Error('sem rede')),
    });
    const [row] = await runRules([rule({ needs: ['api', 'f1db'] })], ctx);
    expect(row).toMatchObject({ status: 'skipped', detail: 'F1DB indisponível: sem rede' });
  });

  it('fonte própria que falta (unavailable): skipped com o motivo; erro ao conferir a fonte: error', async () => {
    const ctx = createQualityContext(db, { env: {} });
    const check = vi.fn();
    const rows = await runRules(
      [
        rule({ id: 'a.raw', unavailable: async () => 'F1DB não importado no core', check }),
        rule({ id: 'b.raw', unavailable: async () => Promise.reject(new Error('banco caiu')), check }),
      ],
      ctx,
    );
    expect(rows.map((r) => [r.ruleId, r.status, r.detail])).toEqual([
      ['a.raw', 'skipped', 'F1DB não importado no core'],
      ['b.raw', 'error', 'banco caiu'],
    ]);
    expect(check).not.toHaveBeenCalled();
  });

  it('memo: a carga compartilhada roda uma vez por execução', async () => {
    const ctx = createQualityContext(db, { env: {} });
    const load = vi.fn(async () => 42);
    expect(await Promise.all([ctx.memo('k', load), ctx.memo('k', load)])).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('catálogo', () => {
  it('ids únicos, no formato área.regra, com descrição nos três idiomas', () => {
    const ids = QUALITY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of QUALITY_RULES) {
      expect(r.id).toMatch(/^[a-z0-9]+\.[a-z0-9-]+$/);
      expect(r.description['pt-BR'] && r.description.en && r.description.es).toBeTruthy();
    }
  });

  it('cada erro achado pelo dono do produto em 24/10 tem uma regra', () => {
    const origins = QUALITY_RULES.filter((r) => r.origin?.includes('dono do produto')).map((r) => r.id);
    expect(origins).toEqual(
      expect.arrayContaining([
        'f1.season-team', // Fangio em 1958 como "Mercedes-AMG Petronas"
        'f1.driver-country', // Hamilton com "GB Wales"
        'geo.ambiguous-country-code',
        'titles.safe-link-only', // campeões errados do Wikidata
        'wikidata.team-category', // times ligados aos femininos
        'watch.included-has-official-source', // canal no plano errado
      ]),
    );
  });

  it('filtro por id, prefixo e esporte', () => {
    expect(selectRules(QUALITY_RULES, { only: ['f1.'] }).every((r) => r.id.startsWith('f1.'))).toBe(true);
    expect(selectRules(QUALITY_RULES, { only: ['geo.ambiguous-country-code'] }).map((r) => r.id)).toEqual([
      'geo.ambiguous-country-code',
    ]);
    expect(
      selectRules(QUALITY_RULES, { sport: 'formula-1' }).every((r) => ['formula-1', 'all'].includes(r.sport)),
    ).toBe(true);
  });
});
