import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from './rate-limiter.js';

function fakeClock(): Clock & { t: number } {
  const c = {
    t: 0,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

describe('RateLimiter', () => {
  it('sem rajada inicial: 1 chamada a cada 6 s no free (10/min), nunca mais de 10 em 60 s', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock);
    const times: number[] = [];
    for (let i = 0; i < 13; i++) {
      await limiter.take('football');
      times.push(clock.t);
    }
    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(6_000);
    // janela deslizante de 60 s nunca contém mais de 10 chamadas
    for (const start of times) {
      expect(times.filter((t) => t >= start && t < start + 60_000).length).toBeLessThanOrEqual(10);
    }
  });

  it('mantém baldes independentes por API', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1, clock);
    await limiter.take('football');
    await limiter.take('basketball');
    expect(clock.t).toBe(0);
  });
});
