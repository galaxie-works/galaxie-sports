import { describe, expect, it } from 'vitest';
import { MODULE_LIMITS } from '@galaxie/db/schema';
import { loadCatalog } from '../catalog/catalog.js';
import { assessUsage, levelOf, TIER_USAGE, usageAlerts } from './assess.js';

const catalog = loadCatalog();

const ent = {
  modules: ['core_data', 'where_to_watch', 'live_chat'] as const,
  tiers: { 'where_to_watch.markets': 3, 'live_chat.peak_connections': 5_000 },
  capacity: { tier: 'C1' as const, viewsPerMonth: 1_000_000, peakConcurrent: 5_000, chatWriters: 1_000 },
};

describe('assessUsage (F6, #1138)', () => {
  it('níveis: aviso em 80%, cheio em 100%, excedente acima; sem teto é sempre ok', () => {
    expect(levelOf(79, 100)).toBe('ok');
    expect(levelOf(80, 100)).toBe('warn');
    expect(levelOf(100, 100)).toBe('full');
    expect(levelOf(101, 100)).toBe('over');
    expect(levelOf(10 ** 9, null)).toBe('ok');
    expect(levelOf(0, 0)).toBe('ok');
    expect(levelOf(1, 0)).toBe('over');
  });

  it('faixas dos módulos e capacidade da organização', () => {
    const checks = assessUsage({ ...ent, modules: [...ent.modules] }, [
      { module: 'where_to_watch', metric: 'active_markets', value: 4 },
      { module: 'live_chat', metric: 'peak_connections', value: 4_200 },
      { module: 'core_data', metric: 'widget_views', value: 700_000 },
      { module: 'where_to_watch', metric: 'widget_views', value: 450_000 },
    ]);
    expect(checks).toEqual([
      { key: 'capacity.peakConcurrent', used: 4_200, limit: 5_000, level: 'warn', overage: 0 },
      { key: 'capacity.viewsPerMonth', used: 1_150_000, limit: 1_000_000, level: 'over', overage: 150_000 },
      { key: 'live_chat.peak_connections', used: 4_200, limit: 5_000, level: 'warn', overage: 0 },
      { key: 'where_to_watch.markets', used: 4, limit: 3, level: 'over', overage: 1 },
    ]);
    expect(usageAlerts(checks)).toHaveLength(4);
  });

  it('tenant da Galaxie não tem faixa nem excedente', () => {
    expect(
      assessUsage({ ...ent, modules: [...ent.modules], isGalaxie: true }, [
        { module: 'core_data', metric: 'widget_views', value: 10 ** 9 },
      ]),
    ).toEqual([]);
  });

  it('faixa de módulo que o tenant não tem fica de fora', () => {
    const checks = assessUsage({ ...ent, modules: ['core_data'] }, []);
    expect(checks.map((c) => c.key)).toEqual(['capacity.peakConcurrent', 'capacity.viewsPerMonth']);
  });

  it('toda faixa ligada a uma medida existe no catálogo, no módulo certo', () => {
    for (const [key, src] of Object.entries(TIER_USAGE)) {
      expect(catalog.modules[src.module].tiers[key], key).toBeDefined();
    }
    // a faixa do chat é a mesma que o engajamento já usa
    expect(MODULE_LIMITS['live_chat.peak_connections']).toBeDefined();
  });
});
