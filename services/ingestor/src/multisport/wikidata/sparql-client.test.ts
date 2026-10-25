import { describe, expect, it } from 'vitest';
import { response, statementRow } from './fixtures.js';
import {
  DEFAULT_USER_AGENT,
  queryHash,
  SparqlClient,
  type SparqlCache,
  type SparqlResponse,
} from './sparql-client.js';

const ok = (body: SparqlResponse) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function memoryCache(): SparqlCache & { store: Map<string, SparqlResponse> } {
  const store = new Map<string, SparqlResponse>();
  return {
    store,
    get: async (hash) => store.get(hash) ?? null,
    put: async (e) => {
      store.set(e.hash, e.body);
    },
  };
}

const noSleep = async () => {};

describe('SparqlClient', () => {
  it('envia User-Agent genérico (sem contato pessoal) e a consulta via POST', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new SparqlClient({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return ok(response([]));
      },
      minIntervalMs: 0,
      sleep: noSleep,
    });
    await client.query('t', 'SELECT * WHERE {}');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
    expect(headers['User-Agent']).not.toMatch(/@|mailto/);
    expect(calls[0]!.init.method).toBe('POST');
    expect(String(calls[0]!.init.body)).toContain('query=SELECT');
  });

  it('tenta de novo em 429/5xx respeitando Retry-After', async () => {
    const waits: number[] = [];
    let n = 0;
    const client = new SparqlClient({
      fetch: async () => {
        n += 1;
        if (n === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '7' } });
        if (n === 2) return new Response('upstream request timeout', { status: 504 });
        return ok(response([statementRow({ id: 's', ev: 'Q1', p: 'Q2', rank: 1 })]));
      },
      minIntervalMs: 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const { data } = await client.query('t', 'SELECT 1');
    expect(data.results.bindings).toHaveLength(1);
    expect(n).toBe(3);
    expect(waits).toEqual([7000, 4000]);
    expect(client.networkCalls).toBe(3);
  });

  it('não insiste em erro de consulta (400) e desiste após o limite de tentativas', async () => {
    const bad = new SparqlClient({
      fetch: async () => new Response('MalformedQueryException', { status: 400 }),
      minIntervalMs: 0,
      sleep: noSleep,
    });
    await expect(bad.query('t', 'SELEC')).rejects.toThrow(/400/);
    expect(bad.networkCalls).toBe(1);

    const down = new SparqlClient({
      fetch: async () => new Response('', { status: 503 }),
      minIntervalMs: 0,
      maxRetries: 2,
      sleep: noSleep,
    });
    await expect(down.query('t', 'SELECT 1')).rejects.toThrow(/503/);
    expect(down.networkCalls).toBe(3);
  });

  it('reaproveita o cache e só volta ao endpoint com refresh', async () => {
    const cache = memoryCache();
    let n = 0;
    const fetchFn = async () => {
      n += 1;
      return ok(response([]));
    };
    const a = new SparqlClient({ fetch: fetchFn, cache, minIntervalMs: 0, sleep: noSleep });
    expect((await a.query('t', 'Q')).fromCache).toBe(false);
    expect((await a.query('t', 'Q')).fromCache).toBe(true);
    expect(cache.store.has(queryHash('Q'))).toBe(true);
    const b = new SparqlClient({ fetch: fetchFn, cache, refresh: true, minIntervalMs: 0, sleep: noSleep });
    expect((await b.query('t', 'Q')).fromCache).toBe(false);
    expect(n).toBe(2);
  });

  it('pagina até receber uma página incompleta', async () => {
    const offsets: number[] = [];
    const client = new SparqlClient({
      fetch: async (_url, init) => {
        const q = new URLSearchParams(String(init!.body)).get('query')!;
        const offset = Number(/OFFSET (\d+)/.exec(q)![1]);
        offsets.push(offset);
        const size = offset < 4 ? 2 : 1;
        return ok(
          response(
            Array.from({ length: size }, (_, i) =>
              statementRow({ id: `s${offset + i}`, ev: 'Q1', p: 'Q2', rank: 1 }),
            ),
          ),
        );
      },
      minIntervalMs: 0,
      sleep: noSleep,
    });
    const rows = await client.paginate(
      't',
      (limit, offset) => `SELECT LIMIT ${limit} OFFSET ${offset}`,
      {},
      2,
    );
    expect(offsets).toEqual([0, 2, 4]);
    expect(rows).toHaveLength(5);
  });

  it('paginação não mistura cache e rede: faltou uma página no cache, todas vêm da rede de novo', async () => {
    const cache = memoryCache();
    const build = (limit: number, offset: number) => `SELECT LIMIT ${limit} OFFSET ${offset}`;
    // página 1 de uma carga antiga (com s0 e s1); depois a fonte mudou (s0 saiu) e a página 2 não está no cache
    cache.store.set(
      queryHash(build(2, 0)),
      response(['s0', 's1'].map((id) => statementRow({ id, ev: 'Q1', p: 'Q2', rank: 1 }))),
    );
    const now = ['s1', 's2', 's3'];
    const offsets: number[] = [];
    const client = new SparqlClient({
      cache,
      fetch: async (_url, init) => {
        const q = new URLSearchParams(String(init!.body)).get('query')!;
        const offset = Number(/OFFSET (\d+)/.exec(q)![1]);
        offsets.push(offset);
        return ok(
          response(
            now.slice(offset, offset + 2).map((id) => statementRow({ id, ev: 'Q1', p: 'Q2', rank: 1 })),
          ),
        );
      },
      minIntervalMs: 0,
      sleep: noSleep,
    });
    const rows = await client.paginate('t', build, {}, 2);
    // misturado, viriam s0, s1 (cache) e s3 (rede): s2 sumiria e s0 voltaria
    expect(offsets).toEqual([0, 2]);
    expect(rows.map((r) => r.st!.value.split('/').pop())).toEqual(now);
    expect(client.cacheHits).toBe(0);
    // tudo no cache agora: a segunda paginação não vai à rede
    const again = await client.paginate('t', build, {}, 2);
    expect(again).toHaveLength(3);
    expect(offsets).toHaveLength(2);
    expect(client.cacheHits).toBe(2);
  });
});
