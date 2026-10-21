import { describe, expect, it } from 'vitest';
import { createGalaxieClient, GalaxieApiError } from './client.js';

function fakeFetch(handler: (url: URL, init?: RequestInit) => Response) {
  const calls: { url: URL; init?: RequestInit | undefined }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

describe('createGalaxieClient', () => {
  it('envia a chave, o locale padrão e os filtros', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ data: [], next_cursor: null }));
    const client = createGalaxieClient({
      baseUrl: 'http://api.test/',
      apiKey: 'k',
      locale: 'es-AR',
      fetch: fn,
    });
    const page = await client.competitions({ country: 'AR', tier: 1 });
    expect(page.next_cursor).toBeNull();
    const call = calls[0]!;
    expect(call.url.pathname).toBe('/v1/competitions');
    expect(Object.fromEntries(call.url.searchParams)).toEqual({ locale: 'es-AR', country: 'AR', tier: '1' });
    expect((call.init?.headers as Record<string, string>)['x-galaxie-key']).toBe('k');
  });

  it('monta as rotas semânticas e multiesportivas (listas viram vírgula)', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({}));
    const client = createGalaxieClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fn });
    await client.teamSemantic('palmeiras', { locale: 'es-AR' });
    await client.copy({ intent: 'cheer', affinity_type: 'heart', affinity_source: 'explicit' });
    await client.medalHistory({ noc: ['BRA', 'ARG'], type: ['OG'] });
    await client.medals('og-summer-2024', { sort: 'total', region: 'latam' });
    expect(calls.map((c) => `${c.url.pathname}?${c.url.searchParams}`)).toEqual([
      '/v1/teams/palmeiras/semantic?locale=es-AR',
      '/v1/copy?intent=cheer&affinity_type=heart&affinity_source=explicit',
      '/v1/multisport/history/medals?noc=BRA%2CARG&type=OG',
      '/v1/multisport/games/og-summer-2024/medals?sort=total&region=latam',
    ]);
  });

  it('expõe a origem do espelho e lança GalaxieApiError com o problem', async () => {
    const { fn } = fakeFetch((url) =>
      url.pathname.startsWith('/mirror')
        ? Response.json(
            { get: 'fixtures', parameters: [], errors: [], results: 0, response: [] },
            { headers: { 'x-galaxie-source': 'miss' } },
          )
        : Response.json(
            { type: 't', title: 'Chave inválida', status: 401, code: 'INVALID_KEY' },
            { status: 401 },
          ),
    );
    const client = createGalaxieClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch: fn });
    const res = await client.mirror('football', '/fixtures', { date: '2026-10-21' });
    expect(res.source).toBe('miss');
    await expect(client.sports()).rejects.toBeInstanceOf(GalaxieApiError);
    await expect(client.sports()).rejects.toMatchObject({ status: 401, problem: { code: 'INVALID_KEY' } });
  });
});
