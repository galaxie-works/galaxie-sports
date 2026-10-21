import { describe, expect, it } from 'vitest';
import { FakeClock, fakeMediaFetch, fakePng } from '../../test/helpers.js';
import { MEDIA_USER_AGENT, MediaFetcher } from './media-fetcher.js';

const URL_A = 'https://media.api-sports.io/football/teams/1.png';

describe('MediaFetcher', () => {
  it('baixa com User-Agent genérico e sem identificação pessoal', async () => {
    const { fetch, calls } = fakeMediaFetch({
      [URL_A]: [{ status: 200, body: fakePng(10, 10), headers: { 'content-type': 'image/png' } }],
    });
    const res = await new MediaFetcher({ fetch, clock: new FakeClock() }).get(URL_A);
    expect(res).toMatchObject({ status: 'ok', contentType: 'image/png', attempts: 1 });
    expect(calls[0]!.headers['user-agent']).toBe(MEDIA_USER_AGENT);
    expect(JSON.stringify(calls[0]!.headers)).not.toMatch(/@|from|cookie|authorization/i);
  });

  it('404 é definitivo: uma tentativa só', async () => {
    const { fetch, calls } = fakeMediaFetch({ [URL_A]: [{ status: 404 }] });
    const res = await new MediaFetcher({ fetch, clock: new FakeClock() }).get(URL_A);
    expect(res).toEqual({ status: 'not_found', httpStatus: 404, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('429 respeita Retry-After, pausa e depois baixa', async () => {
    const clock = new FakeClock();
    const { fetch, calls } = fakeMediaFetch({
      [URL_A]: [
        { status: 429, headers: { 'retry-after': '7' } },
        { status: 200, body: fakePng(1, 1) },
      ],
    });
    const res = await new MediaFetcher({ fetch, clock }).get(URL_A);
    expect(res.status).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toContain(7000);
  });

  it('5xx repete com backoff exponencial e desiste no limite', async () => {
    const clock = new FakeClock();
    const { fetch, calls } = fakeMediaFetch({ [URL_A]: [{ status: 503 }] });
    const res = await new MediaFetcher({ fetch, clock, maxRetries: 3, backoffBaseMs: 500 }).get(URL_A);
    expect(res).toEqual({ status: 'error', reason: 'HTTP 503', rateLimited: false, attempts: 4 });
    expect(calls).toHaveLength(4);
    expect(clock.sleeps).toEqual([500, 1000, 2000]);
  });

  it('403 não repete (fica pendente para a próxima execução)', async () => {
    const { fetch, calls } = fakeMediaFetch({ [URL_A]: [{ status: 403 }] });
    const res = await new MediaFetcher({ fetch, clock: new FakeClock() }).get(URL_A);
    expect(res).toMatchObject({ status: 'error', reason: 'HTTP 403' });
    expect(calls).toHaveLength(1);
  });

  it('erro de rede repete', async () => {
    let n = 0;
    const fetch = (async () => {
      if (n++ === 0) throw new TypeError('fetch failed');
      return new Response(fakePng(2, 2));
    }) as typeof globalThis.fetch;
    const res = await new MediaFetcher({ fetch, clock: new FakeClock() }).get(URL_A);
    expect(res).toMatchObject({ status: 'ok', attempts: 2 });
  });
});
