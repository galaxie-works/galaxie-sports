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
  it('libera 10 imediatamente e espaça as seguintes em ~6 s (10/min)', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock);
    const times: number[] = [];
    for (let i = 0; i < 13; i++) {
      await limiter.take('football');
      times.push(clock.t);
    }
    expect(times.slice(0, 10).every((t) => t === 0)).toBe(true);
    expect(times[10]).toBeGreaterThanOrEqual(6_000);
    expect(times[12]! - times[11]!).toBeGreaterThanOrEqual(6_000);
  });

  it('mantém baldes independentes por API', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1, clock);
    await limiter.take('football');
    await limiter.take('basketball');
    expect(clock.t).toBe(0);
  });
});
