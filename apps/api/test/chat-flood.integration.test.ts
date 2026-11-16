import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisFloodGuard } from '../src/chat/flood.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prefix = `gs-test-${randomBytes(4).toString('hex')}:`;
let redis: Redis;

beforeAll(() => {
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
});

afterAll(async () => {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
  redis.disconnect();
});

describe('Chat ao vivo: anti-flood no Valkey', () => {
  it('duas instâncias contam juntas e o bloqueio vale para as duas', async () => {
    const a = new RedisFloodGuard(redis, prefix);
    const b = new RedisFloodGuard(redis, prefix);
    const rule = { maxPerMinute: 4, blockSeconds: 30 };
    const left = [];
    for (let i = 0; i < 4; i++) left.push(await (i % 2 ? a : b).hit('t1', 'p1', `m${i}`, rule));
    expect(left).toEqual([0, 0, 0, 0]);
    const blocked = await a.hit('t1', 'p1', 'm4', rule);
    expect(blocked).toBe(30_000);
    const still = await b.hit('t1', 'p1', 'm5', rule);
    expect(still).toBeGreaterThan(29_000);
    expect(still).toBeLessThanOrEqual(30_000);
    // outra pessoa e outro cliente seguem livres
    expect(await b.hit('t1', 'p2', 'oi', rule)).toBe(0);
    expect(await b.hit('t2', 'p1', 'oi', rule)).toBe(0);
  });

  it('a mesma mensagem 3 vezes bloqueia', async () => {
    const g = new RedisFloodGuard(redis, prefix);
    const rule = { maxPerMinute: 10, blockSeconds: 60 };
    expect(await g.hit('t3', 'p1', 'compre já', rule)).toBe(0);
    expect(await g.hit('t3', 'p1', 'COMPRE  JÁ', rule)).toBe(0);
    expect(await g.hit('t3', 'p1', 'compre já', rule)).toBe(60_000);
  });
});
