import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisReactionCounter } from '../src/chat/reactions.js';

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

describe('Chat ao vivo: reações no Valkey (#967)', () => {
  it('duas instâncias somam e fecham o segundo sem contar duas vezes', async () => {
    const a = new RedisReactionCounter(redis, prefix);
    const b = new RedisReactionCounter(redis, prefix);
    const room = 't1:jogo1';
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).add(room, `p${i}`, i % 3 ? 'fire' : 'clap')),
    );
    const [fa, fb] = await Promise.all([a.flush(), b.flush()]);
    const all = [...fa, ...fb];
    expect(all).toHaveLength(1);
    expect(all[0]!.tally.delta).toEqual({ fire: 26, clap: 14 });
    expect(all[0]!.tally.total).toEqual({ fire: 26, clap: 14 });
    // segundo seguinte: só o que entrou nele; o total continua
    await a.add(room, 'p0', 'fire');
    const next = await b.flush();
    expect(next[0]!.tally).toEqual({ delta: { fire: 1 }, total: { fire: 27, clap: 14 } });
    expect(await a.totals(room)).toEqual({ fire: 27, clap: 14 });
  });

  it('spam de uma pessoa é limitado por segundo; salas e clientes não se misturam', async () => {
    const c = new RedisReactionCounter(redis, prefix, 3);
    const accepted = await Promise.all(Array.from({ length: 10 }, () => c.add('t1:spam', 'p1', 'laugh')));
    expect(accepted.filter(Boolean)).toHaveLength(3);
    await c.add('t2:spam', 'p1', 'laugh');
    const out = await c.flush();
    const byRoom = Object.fromEntries(out.map((f) => [f.room, f.tally.delta]));
    expect(byRoom['t1:spam']).toEqual({ laugh: 3 });
    expect(byRoom['t2:spam']).toEqual({ laugh: 1 });
    await new Promise((r) => setTimeout(r, 1_100));
    expect(await c.add('t1:spam', 'p1', 'laugh')).toBe(true);
  });
});
