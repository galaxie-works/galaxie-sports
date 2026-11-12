import { describe, expect, it } from 'vitest';
import { MemoryReactionCounter } from './reactions.js';

describe('MemoryReactionCounter', () => {
  it('soma no segundo e no total; o flush esvazia só o segundo', async () => {
    const c = new MemoryReactionCounter(5, () => 0);
    await c.add('t:j', 'p1', 'fire');
    await c.add('t:j', 'p2', 'fire');
    await c.add('t:j', 'p2', 'clap');
    expect(await c.flush()).toEqual([
      { room: 't:j', tally: { delta: { fire: 2, clap: 1 }, total: { fire: 2, clap: 1 } } },
    ]);
    expect(await c.flush()).toEqual([]);
    await c.add('t:j', 'p1', 'fire');
    expect((await c.flush())[0]!.tally).toEqual({ delta: { fire: 1 }, total: { fire: 3, clap: 1 } });
    expect(await c.totals('t:j')).toEqual({ fire: 3, clap: 1 });
  });

  it('limita reações por pessoa por segundo; outra pessoa e o segundo seguinte não são afetados', async () => {
    let t = 0;
    const c = new MemoryReactionCounter(3, () => t);
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await c.add('r', 'spam', 'fire'));
    expect(results).toEqual([true, true, true, false, false]);
    expect(await c.add('r', 'outro', 'fire')).toBe(true);
    t = 1_000;
    expect(await c.add('r', 'spam', 'fire')).toBe(true);
  });
});
