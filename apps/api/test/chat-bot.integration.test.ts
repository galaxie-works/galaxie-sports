import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOT_BLOCK_MS, CADENCE_SAMPLES, RedisBotGuard, type BotInput } from '../src/chat/bot.js';

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

const input = (over: Partial<BotInput> = {}): BotInput => ({
  tenantId: 't1',
  roomId: 'r1',
  profileId: 'p1',
  accountId: 'a1',
  hosts: [],
  verified: false,
  now: 0,
  ...over,
});

describe('Chat ao vivo: detecção de robô no Valkey (#1290)', () => {
  it('duas instâncias somam o ritmo, e o bloqueio vale para as duas', async () => {
    const a = new RedisBotGuard(redis, prefix);
    const b = new RedisBotGuard(redis, prefix);
    let last;
    for (let i = 0; i < CADENCE_SAMPLES; i++) last = await (i % 2 ? a : b).check(input({ now: i * 5_000 }));
    expect(last).toEqual({ blockedMs: BOT_BLOCK_MS, blockedNow: true, signals: ['bot_cadence'] });
    const still = await a.check(input({ roomId: 'r2', now: 50_000 }));
    expect(still.blockedNow).toBe(false);
    expect(still.blockedMs).toBeGreaterThan(BOT_BLOCK_MS - 5_000);
    // outra pessoa segue livre
    expect((await b.check(input({ profileId: 'p9', now: 50_000 }))).blockedMs).toBe(0);
  });

  it('Conta com vários Perfis na sala e o mesmo link entre Perfis só sinalizam', async () => {
    const g = new RedisBotGuard(redis, prefix);
    await g.check(input({ tenantId: 't2', profileId: 'x1' }));
    await g.check(input({ tenantId: 't2', profileId: 'x2' }));
    expect((await g.check(input({ tenantId: 't2', profileId: 'x3' }))).signals).toEqual([
      'bot_shared_account',
    ]);
    const link = (p: string) =>
      g.check(input({ tenantId: 't3', profileId: p, accountId: `a-${p}`, hosts: ['promo.example.com'] }));
    await link('y1');
    await link('y2');
    const v = await link('y3');
    expect(v).toEqual({ blockedMs: 0, blockedNow: false, signals: ['bot_shared_link'] });
  });
});
