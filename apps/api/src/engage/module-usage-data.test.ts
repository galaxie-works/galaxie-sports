import { describe, expect, it } from 'vitest';
import { MemoryModuleUsageMeter } from './module-usage.js';

describe('medição dos módulos de dados (F6, #1138)', () => {
  it('visualizações de widget, jogos enriquecidos e países distintos', async () => {
    const m = new MemoryModuleUsageMeter();
    const at = new Date('2026-11-12T12:00:00Z');
    await m.add('t', 'core_data', 'widget_views', 3, at);
    await m.add('t', 'core_data', 'widget_views', 2, at);
    await m.add('t', 'live_intelligence', 'enriched_games', 1, at);
    for (const c of ['BR', 'AR', 'BR']) await m.distinct('t', 'where_to_watch', 'active_markets', c, at);
    const r = await m.read('2026-11');
    const v = (module: string, metric: string) =>
      r.find((x) => x.module === module && x.metric === metric)?.value;
    expect(v('core_data', 'widget_views')).toBe(5);
    expect(v('live_intelligence', 'enriched_games')).toBe(1);
    expect(v('where_to_watch', 'active_markets')).toBe(2);
  });
});
