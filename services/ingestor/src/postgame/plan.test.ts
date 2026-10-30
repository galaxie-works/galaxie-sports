import { describe, expect, it } from 'vitest';
import { InMemoryCursorStore } from '../jobs/runtime/cursor-store.js';
import {
  capCursor,
  dueLists,
  listCursor,
  listEndpoint,
  postgameSports,
  recordCalls,
  type PendingDay,
} from './plan.js';

const NOW = new Date('2026-10-30T01:00:00Z');
const MIN = 60_000;

describe('fechamento pós-jogo: configuração', () => {
  it('padrão é fechamento a cada 15 min em todo esporte, menos a F1; off tira o esporte', () => {
    const all = postgameSports({});
    expect(all.find((s) => s.sport === 'volleyball')).toEqual({
      sport: 'volleyball',
      mode: 'fechamento',
      intervalMin: 15,
    });
    expect(all.some((s) => s.sport === ('formula-1' as never))).toBe(false);
    expect(all.some((s) => s.sport === 'football')).toBe(true);

    const env = {
      POSTGAME_VOLLEYBALL: 'off',
      POSTGAME_NBA: 'tempo-real',
      POSTGAME_NBA_MIN: '1',
      POSTGAME_HOCKEY_MIN: 'x',
    };
    const s = postgameSports(env);
    expect(s.some((x) => x.sport === 'volleyball')).toBe(false);
    expect(s.find((x) => x.sport === 'nba')).toEqual({ sport: 'nba', mode: 'tempo-real', intervalMin: 1 });
    expect(s.find((x) => x.sport === 'hockey')?.intervalMin).toBe(15);
  });

  it('lista do dia: fixtures no futebol, games/fights nos outros', () => {
    expect(listEndpoint('football')).toBe('/fixtures');
    expect(listEndpoint('volleyball')).toBe('/games');
    expect(listEndpoint('mma')).toBe('/fights');
  });
});

describe('fechamento pós-jogo: quem está na vez', () => {
  const sports = postgameSports({ POSTGAME_NBA: 'tempo-real', POSTGAME_NBA_MIN: '2' });
  const pending: PendingDay[] = [
    { sport: 'volleyball', date: '2026-10-29', pending: 1 },
    { sport: 'nba', date: '2026-10-29', pending: 2 },
    { sport: 'nba', date: '2026-10-30', pending: 1 },
  ];

  it('sem busca anterior, toda data pendente está na vez', async () => {
    const { due, capped } = await dueLists(new InMemoryCursorStore(), sports, pending, NOW, 40);
    expect(due.map((d) => `${d.sport} ${d.date}`)).toEqual([
      'volleyball 2026-10-29',
      'nba 2026-10-29',
      'nba 2026-10-30',
    ]);
    expect(capped).toEqual([]);
  });

  it('respeita o intervalo de cada esporte (com folga de segundos do cron)', async () => {
    const cursors = new InMemoryCursorStore();
    await cursors.complete([listCursor('volleyball', '2026-10-29')], {}, new Date(NOW.getTime() - 10 * MIN));
    await cursors.complete([listCursor('nba', '2026-10-29')], {}, new Date(NOW.getTime() - 2 * MIN + 5_000));
    const { due } = await dueLists(cursors, sports, pending, NOW, 40);
    // vôlei buscou há 10 min (intervalo 15): fora; NBA há 1m55s (intervalo 2): dentro da folga
    expect(due.map((d) => `${d.sport} ${d.date}`)).toEqual(['nba 2026-10-29', 'nba 2026-10-30']);
  });

  it('teto de chamadas por esporte e dia UTC', async () => {
    const cursors = new InMemoryCursorStore();
    await cursors.complete([capCursor('nba', '2026-10-30')], { calls: 39 }, NOW);
    const { due, capped } = await dueLists(cursors, sports, pending, NOW, 40);
    expect(due.map((d) => `${d.sport} ${d.date}`)).toEqual(['volleyball 2026-10-29', 'nba 2026-10-29']);
    expect(capped).toEqual(['nba']);

    // só o que saiu para o fornecedor conta: a lista do vôlei que a cota negou não gasta o dia
    await recordCalls(
      cursors,
      new Map([
        ['nba', 1],
        ['volleyball', 0],
      ]),
      NOW,
    );
    const state = await cursors.load([capCursor('nba', '2026-10-30'), capCursor('volleyball', '2026-10-30')]);
    expect(state.get('nba|postgame:cap|day=2026-10-30')?.cursor).toEqual({ calls: 40 });
    expect(state.get('volleyball|postgame:cap|day=2026-10-30')).toBeUndefined();
  });
});
