import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { tagsForChange } from './change-feed.js';
import { matchesEtag, sendCached, SURROGATE_KEY_MAX, surrogateKeyHeader } from './http.js';
import { cacheControl } from './policy.js';
import { MemoryResponseCache } from './store.js';

function appWith(cache: MemoryResponseCache, load: () => unknown, ttl = 60) {
  const app = Fastify();
  let loads = 0;
  app.get('/r', (request, reply) =>
    sendCached(request, reply, cache, {
      ttl,
      vary: [String((request.query as { locale?: string }).locale ?? '')],
      load: async () => {
        loads += 1;
        return { body: load(), tags: ['competition', 'competition:1'] };
      },
    }),
  );
  return { app, loads: () => loads };
}

describe('sendCached', () => {
  it('guarda no cache, marca HIT/MISS, ETag e Cache-Control', async () => {
    const cache = new MemoryResponseCache();
    const { app, loads } = appWith(cache, () => ({ name: 'Libertadores' }));
    const first = await app.inject({ url: '/r' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-galaxie-cache']).toBe('MISS');
    expect(first.headers['cache-control']).toBe(cacheControl(60));
    expect(first.headers['surrogate-key']).toBe('competition competition:1');
    const second = await app.inject({ url: '/r' });
    expect(second.headers['x-galaxie-cache']).toBe('HIT');
    expect(second.headers.etag).toBe(first.headers.etag);
    expect(second.json()).toEqual({ name: 'Libertadores' });
    expect(loads()).toBe(1);
  });

  it('If-None-Match com o ETag atual → 304 sem corpo', async () => {
    const { app } = appWith(new MemoryResponseCache(), () => ({ a: 1 }));
    const first = await app.inject({ url: '/r' });
    const res = await app.inject({ url: '/r', headers: { 'if-none-match': `W/${first.headers.etag}` } });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
  });

  it('purge por tag força nova leitura', async () => {
    const cache = new MemoryResponseCache();
    let name = 'A';
    const { app, loads } = appWith(cache, () => ({ name }));
    await app.inject({ url: '/r' });
    name = 'B';
    expect((await app.inject({ url: '/r' })).json()).toEqual({ name: 'A' });
    expect(await cache.purgeTags(['competition:1'])).toBe(1);
    expect((await app.inject({ url: '/r' })).json()).toEqual({ name: 'B' });
    expect(loads()).toBe(2);
  });

  it('varia por locale', async () => {
    const { app, loads } = appWith(new MemoryResponseCache(), () => ({}));
    await app.inject({ url: '/r?locale=es-AR' });
    await app.inject({ url: '/r?locale=pt-BR' });
    expect(loads()).toBe(2);
  });
});

describe('utilitários de cache', () => {
  it('matchesEtag aceita lista, * e validador fraco', () => {
    expect(matchesEtag('"a", "b"', '"b"')).toBe(true);
    expect(matchesEtag('*', '"x"')).toBe(true);
    expect(matchesEtag('W/"x"', '"x"')).toBe(true);
    expect(matchesEtag('"y"', '"x"')).toBe(false);
    expect(matchesEtag(undefined, '"x"')).toBe(false);
  });

  it('Cache-Control limita o navegador a 5 min e deixa a CDN com o TTL cheio', () => {
    expect(cacheControl(86_400)).toBe('public, max-age=300, s-maxage=86400, stale-while-revalidate=60');
    expect(cacheControl(10)).toBe('public, max-age=10, s-maxage=10, stale-while-revalidate=10');
    expect(cacheControl(0)).toBe('no-cache');
  });

  it('tags de uma mudança: entidade, coleção e extras do payload', () => {
    expect(
      tagsForChange({ entityType: 'season', entityId: 's1', payload: { tags: ['competition:c1', 1] } }),
    ).toEqual(['season:s1', 'season', 'competition:c1']);
    expect(tagsForChange({ entityType: 'venue', entityId: 'v1', payload: null })).toEqual([
      'venue:v1',
      'venue',
    ]);
  });
});

describe('surrogateKeyHeader', () => {
  it('mantém todas as tags quando cabem', () => {
    expect(surrogateKeyHeader(['event', 'event:1', 'competition:2'])).toBe('event event:1 competition:2');
  });

  it('acima do teto fica só com as tags de coleção (header nunca estoura o limite do cliente)', () => {
    const tags = [
      'event',
      ...Array.from(
        { length: 600 },
        (_, i) => `event:01a16b43-0674-75d3-a118-${String(i).padStart(12, '0')}`,
      ),
      'competition',
    ];
    const header = surrogateKeyHeader(tags);
    expect(tags.join(' ').length).toBeGreaterThan(SURROGATE_KEY_MAX);
    expect(header).toBe('event competition');
    expect(header.length).toBeLessThanOrEqual(SURROGATE_KEY_MAX);
  });
});
