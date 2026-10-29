import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { tagsForChange } from './change-feed.js';
import {
  LEGACY_ENTRY_TTL_SEC,
  matchesEtag,
  remainingTtl,
  sendCached,
  SURROGATE_KEY_MAX,
  surrogateKeyHeader,
} from './http.js';
import { cacheControl } from './policy.js';
import { MemoryResponseCache } from './store.js';
import { problems, registerErrorHandling } from '../errors.js';
import { parseInput } from '../util.js';

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
    // resposta por tenant: a chave secreta e a publicável (widgets) separam as cópias de um cache compartilhado
    expect(first.headers.vary).toBe('Accept-Language, x-galaxie-key, x-galaxie-publishable-key');
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

  it('HIT anuncia o que resta do TTL da entrada (o do load), não o TTL da rota', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T15:00:00Z'), toFake: ['Date'] });
    try {
      const cache = new MemoryResponseCache();
      const app = Fastify();
      // rota de 1 h cujo load escolhe 10 s (jogo ao vivo)
      app.get('/live', (request, reply) =>
        sendCached(request, reply, cache, {
          ttl: 3600,
          load: async () => ({ body: { status: 'live' }, tags: ['event:1'], ttl: 10 }),
        }),
      );
      const miss = await app.inject({ url: '/live' });
      expect(miss.headers['cache-control']).toBe(cacheControl(10));
      vi.advanceTimersByTime(4_000);
      const hit = await app.inject({ url: '/live' });
      expect(hit.headers['x-galaxie-cache']).toBe('HIT');
      expect(hit.headers['cache-control']).toBe(cacheControl(6));
    } finally {
      vi.useRealTimers();
    }
  });

  it('entrada antiga sem ttl gravado: HIT com TTL curto, nunca o da rota', () => {
    const storedAt = Date.parse('2026-10-21T15:00:00Z');
    expect(remainingTtl({ storedAt }, 86_400, storedAt + 1_000)).toBe(LEGACY_ENTRY_TTL_SEC);
    expect(remainingTtl({ storedAt }, 5, storedAt)).toBe(5);
    expect(remainingTtl({ storedAt, ttl: 60 }, 86_400, storedAt + 59_500)).toBe(1);
    expect(remainingTtl({ storedAt, ttl: 60 }, 86_400, storedAt + 61_000)).toBe(0);
    // gravada por uma instância com o relógio adiantado: nunca mais que o TTL da entrada
    expect(remainingTtl({ storedAt, ttl: 10 }, 3600, storedAt - 30_000)).toBe(10);
  });

  it('chave usa a query validada: parâmetro desconhecido não fura o cache', async () => {
    const cache = new MemoryResponseCache();
    const app = Fastify();
    const Query = z.object({ limit: z.coerce.number().int().default(50), q: z.string().optional() });
    let loads = 0;
    app.get('/q', (request, reply) => {
      const query = parseInput(Query, request.query);
      return sendCached(request, reply, cache, {
        ttl: 60,
        load: async () => {
          loads += 1;
          return { body: query, tags: [] };
        },
      });
    });
    expect((await app.inject({ url: '/q?x=1' })).headers['x-galaxie-cache']).toBe('MISS');
    expect((await app.inject({ url: '/q?x=2&y=3' })).headers['x-galaxie-cache']).toBe('HIT');
    // o padrão do schema e o valor explícito igual caem na mesma entrada
    expect((await app.inject({ url: '/q?limit=50' })).headers['x-galaxie-cache']).toBe('HIT');
    expect(loads).toBe(1);
    // parâmetro conhecido continua separando as respostas
    expect((await app.inject({ url: '/q?limit=10' })).json()).toEqual({ limit: 10 });
    expect((await app.inject({ url: '/q?limit=10&q=a' })).json()).toEqual({ limit: 10, q: 'a' });
    expect(loads).toBe(3);
  });

  it('rota que não valida a query segue com a query bruta na chave', async () => {
    const { app, loads } = appWith(new MemoryResponseCache(), () => ({}));
    await app.inject({ url: '/r?x=1' });
    await app.inject({ url: '/r?x=2' });
    expect(loads()).toBe(2);
  });

  it('purge durante o load: não grava a resposta (pode ser anterior à mudança) e sai sem cache', async () => {
    const cache = new MemoryResponseCache();
    let name = 'A';
    let purgeMidLoad = true;
    const { app, loads } = appWith(cache, () => {
      const body = { name };
      if (purgeMidLoad) {
        // a mudança comita e o change feed purga enquanto a requisição ainda monta a resposta velha
        name = 'B';
        void cache.purgeTags(['competition:1']);
        purgeMidLoad = false;
      }
      return body;
    });
    const stale = await app.inject({ url: '/r' });
    expect(stale.json()).toEqual({ name: 'A' });
    expect(stale.headers['cache-control']).toBe('no-cache');
    const next = await app.inject({ url: '/r' });
    expect(next.headers['x-galaxie-cache']).toBe('MISS');
    expect(next.json()).toEqual({ name: 'B' });
    expect(next.headers['cache-control']).toBe(cacheControl(60));
    expect((await app.inject({ url: '/r' })).headers['x-galaxie-cache']).toBe('HIT');
    expect(loads()).toBe(2);
  });

  it('cache fora do ar na leitura: responde do load sem buscar a marca de purge', async () => {
    const cache = new MemoryResponseCache();
    cache.get = async () => {
      throw new Error('fora do ar');
    };
    const purgeMark = vi.spyOn(cache, 'purgeMark');
    const { app } = appWith(cache, () => ({ ok: true }));
    const res = await app.inject({ url: '/r' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(purgeMark).not.toHaveBeenCalled();
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

describe('sendCached — singleflight e stale-while-revalidate (rotas quentes)', () => {
  /** Load controlado pelo teste: cada chamada espera `release()` e devolve o valor da vez. */
  function gatedApp(cache: MemoryResponseCache, opts: { ttl?: number; staleSec?: number } = {}) {
    const app = Fastify();
    registerErrorHandling(app);
    const results: string[] = [];
    app.decorate('metrics', {
      cacheResults: { inc: ({ result }: { result: string }) => results.push(result) },
    } as never);
    let loads = 0;
    let value = 'v1';
    let fail: Error | undefined;
    const gates: (() => void)[] = [];
    app.get('/live', (request, reply) =>
      sendCached(request, reply, cache, {
        ttl: opts.ttl ?? 10,
        ...(opts.staleSec !== 0 ? { staleSec: opts.staleSec ?? 5 } : {}),
        load: async () => {
          loads += 1;
          const placar = value; // lido do banco no começo do load
          await new Promise<void>((r) => gates.push(r));
          if (fail) throw fail;
          return { body: { placar }, tags: ['event', 'event:1'] };
        },
      }),
    );
    return {
      app,
      results,
      loads: () => loads,
      set: (v: string) => (value = v),
      failWith: (e: Error | undefined) => (fail = e),
      /** Libera os loads pendentes. */
      release: async () => {
        await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0));
        for (const g of gates.splice(0)) g();
      },
    };
  }

  it('cache vazio: requisições simultâneas esperam um único load (singleflight)', async () => {
    const t = gatedApp(new MemoryResponseCache());
    const all = Promise.all(Array.from({ length: 20 }, () => t.app.inject({ url: '/live' })));
    await t.release();
    const res = await all;
    expect(t.loads()).toBe(1);
    expect(new Set(res.map((r) => r.body))).toEqual(new Set([JSON.stringify({ placar: 'v1' })]));
    expect(res.every((r) => r.statusCode === 200 && r.headers['x-galaxie-cache'] === 'MISS')).toBe(true);
    expect(t.results.filter((r) => r === 'miss')).toHaveLength(1);
    expect(t.results.filter((r) => r === 'coalesced')).toHaveLength(19);
  });

  it('TTL vencido: só uma requisição recalcula, as outras recebem o valor anterior', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-29T20:00:00Z'), toFake: ['Date'] });
    try {
      const t = gatedApp(new MemoryResponseCache());
      const first = t.app.inject({ url: '/live' });
      await t.release();
      expect((await first).json()).toEqual({ placar: 'v1' });

      vi.advanceTimersByTime(11_000); // passou do TTL de 10 s, dentro da janela de 5 s
      t.set('v2');
      const leader = t.app.inject({ url: '/live' });
      await vi.waitFor(() => expect(t.loads()).toBe(2));
      const others = await Promise.all(Array.from({ length: 10 }, () => t.app.inject({ url: '/live' })));
      for (const r of others) {
        expect(r.headers['x-galaxie-cache']).toBe('STALE');
        expect(r.headers['cache-control']).toBe('no-cache');
        expect(r.json()).toEqual({ placar: 'v1' });
      }
      expect(t.loads()).toBe(2);
      await t.release();
      const led = await leader;
      expect(led.headers['x-galaxie-cache']).toBe('MISS');
      expect(led.json()).toEqual({ placar: 'v2' });

      const after = await t.app.inject({ url: '/live' });
      expect(after.headers['x-galaxie-cache']).toBe('HIT');
      expect(after.json()).toEqual({ placar: 'v2' });
      expect(t.results.filter((r) => r === 'stale')).toHaveLength(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passada a janela de stale, a entrada some: MISS normal, sem valor velho', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-29T20:00:00Z'), toFake: ['Date'] });
    try {
      const cache = new MemoryResponseCache();
      const t = gatedApp(cache);
      const first = t.app.inject({ url: '/live' });
      await t.release();
      await first;
      vi.advanceTimersByTime(15_000); // TTL 10 s + stale 5 s
      t.set('v2');
      const next = t.app.inject({ url: '/live' });
      await t.release();
      expect((await next).json()).toEqual({ placar: 'v2' });
      expect((await next).headers['x-galaxie-cache']).toBe('MISS');
    } finally {
      vi.useRealTimers();
    }
  });

  it('purge apaga a entrada: depois de uma mudança nunca se serve o valor anterior', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-29T20:00:00Z'), toFake: ['Date'] });
    try {
      const cache = new MemoryResponseCache();
      const t = gatedApp(cache);
      const first = t.app.inject({ url: '/live' });
      await t.release();
      await first;
      vi.advanceTimersByTime(11_000);
      await cache.purgeTags(['event:1']);
      t.set('gol');
      const a = t.app.inject({ url: '/live' });
      const b = t.app.inject({ url: '/live' });
      await t.release();
      expect((await a).json()).toEqual({ placar: 'gol' });
      expect((await b).json()).toEqual({ placar: 'gol' });
      expect(t.loads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('quem entra num load depois de um purge não recebe a resposta anterior à mudança', async () => {
    const cache = new MemoryResponseCache();
    const t = gatedApp(cache);
    const leader = t.app.inject({ url: '/live' });
    await vi.waitFor(() => expect(t.loads()).toBe(1));
    await cache.purgeTags(['event:1']); // gol durante o load do líder
    t.set('gol');
    const late = t.app.inject({ url: '/live' }); // chegou depois do purge
    await vi.waitFor(() => expect(t.loads()).toBe(1));
    await t.release(); // o líder termina com o placar antigo (gravação recusada)
    expect((await leader).json()).toEqual({ placar: 'v1' });
    await vi.waitFor(() => expect(t.loads()).toBe(2));
    await t.release();
    expect((await late).json()).toEqual({ placar: 'gol' });
  });

  it('recálculo que falha (banco fora) serve o valor anterior; erro do cliente (404) vale', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-29T20:00:00Z'), toFake: ['Date'] });
    try {
      const t = gatedApp(new MemoryResponseCache());
      const first = t.app.inject({ url: '/live' });
      await t.release();
      await first;
      vi.advanceTimersByTime(11_000);
      t.failWith(new Error('connection terminated'));
      const down = t.app.inject({ url: '/live' });
      await t.release();
      expect((await down).headers['x-galaxie-cache']).toBe('STALE');
      expect((await down).json()).toEqual({ placar: 'v1' });

      t.failWith(problems.notFound('Evento'));
      const gone = t.app.inject({ url: '/live' });
      await t.release();
      expect((await gone).statusCode).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rota sem staleSec segue como antes: cada requisição sem cache faz o seu load', async () => {
    const t = gatedApp(new MemoryResponseCache(), { staleSec: 0 });
    const all = Promise.all([t.app.inject({ url: '/live' }), t.app.inject({ url: '/live' })]);
    await vi.waitFor(() => expect(t.loads()).toBe(2));
    await t.release();
    await all;
  });
});
