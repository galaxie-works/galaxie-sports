import { beforeEach, describe, expect, it, vi } from 'vitest';

const next = vi.hoisted(() => ({ cacheTag: vi.fn() }));
vi.mock('next/cache', () => ({ cacheTag: next.cacheTag }));

import { tagCacheEntry, taggedFetch } from './cache-tags';

beforeEach(() => {
  next.cacheTag.mockReset();
  vi.unstubAllGlobals();
});

describe('taggedFetch', () => {
  it('marca a entrada de cache com as tags do surrogate-key da API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({}, { headers: { 'surrogate-key': 'f1_editorial team:01a15fba-ec17-7d8b' } }),
      ),
    );
    const res = await taggedFetch('http://api.test/v1/teams/x/editorial');
    expect(res.ok).toBe(true);
    expect(next.cacheTag).toHaveBeenCalledWith('f1_editorial', 'team:01a15fba-ec17-7d8b');
  });

  it('sem header (404, por exemplo) não marca nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await taggedFetch('http://api.test/v1/teams/x/editorial');
    expect(next.cacheTag).not.toHaveBeenCalled();
  });
});

describe('tagCacheEntry', () => {
  it('fora de um use cache o cacheTag lança, e a chamada segue', () => {
    next.cacheTag.mockImplementation(() => {
      throw new Error('cacheTag() fora de use cache');
    });
    expect(() => tagCacheEntry(['event:e1'])).not.toThrow();
  });
});
