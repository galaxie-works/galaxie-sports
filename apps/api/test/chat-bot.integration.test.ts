import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BOT_BLOCK_MS,
  CADENCE_SAMPLES,
  RedisBotGuard,
  SIGNAL_WINDOW_MS,
  type BotInput,
} from '../src/chat/bot.js';

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
  links: [],
  verified: false,
  slowModeMs: 0,
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
      g.check(
        input({ tenantId: 't3', profileId: p, accountId: `a-${p}`, links: ['promo.example.com/oferta'] }),
      );
    await link('y1');
    await link('y2');
    const v = await link('y3');
    expect(v).toEqual({ blockedMs: 0, blockedNow: false, signals: ['bot_shared_link'] });
  });

  it('a janela de 10 min vale por Perfil: quem saiu da janela não conta mais', async () => {
    const g = new RedisBotGuard(redis, prefix);
    const at = (p: string, now: number) => g.check(input({ tenantId: 't4', profileId: p, now }));
    await at('z1', 0);
    await at('z2', 1_000);
    // z1 já saiu da janela quando z3 chega: são só dois
    expect((await at('z3', SIGNAL_WINDOW_MS + 500)).signals).toEqual([]);
    expect((await at('z4', SIGNAL_WINDOW_MS + 600)).signals).toEqual(['bot_shared_account']);
  });

  it('duas instâncias travando no mesmo instante: só uma abre o caso', async () => {
    const a = new RedisBotGuard(redis, prefix);
    const b = new RedisBotGuard(redis, prefix);
    for (let i = 0; i < CADENCE_SAMPLES - 1; i++) await a.check(input({ tenantId: 't5', now: i * 5_000 }));
    const both = await Promise.all([
      a.check(input({ tenantId: 't5', now: (CADENCE_SAMPLES - 1) * 5_000 })),
      b.check(input({ tenantId: 't5', now: (CADENCE_SAMPLES - 1) * 5_000 })),
    ]);
    expect(both.filter((v) => v.blockedNow)).toHaveLength(1);
    expect(both.every((v) => v.blockedMs > 0)).toBe(true);
  });
});
