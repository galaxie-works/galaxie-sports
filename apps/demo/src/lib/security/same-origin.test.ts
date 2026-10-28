import { afterEach, describe, expect, it } from 'vitest';
import { rejectCrossSite } from './same-origin';

const post = (headers: Record<string, string>) =>
  new Request('http://demo:3000/api/ajustes/revisao/x', { method: 'POST', headers, body: '{}' });

describe('rejectCrossSite', () => {
  afterEach(() => {
    delete process.env.BETTER_AUTH_URL;
  });

  it('aceita a própria demo (Sec-Fetch-Site ou Origin igual ao host) com JSON', () => {
    expect(
      rejectCrossSite(post({ 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' })),
    ).toBeNull();
    expect(
      rejectCrossSite(
        post({
          origin: 'https://demo.sports.galaxie.works',
          'x-forwarded-host': 'demo.sports.galaxie.works',
          'content-type': 'application/json; charset=utf-8',
        }),
      ),
    ).toBeNull();
    process.env.BETTER_AUTH_URL = 'https://demo.sports.galaxie.works';
    expect(
      rejectCrossSite(
        post({ origin: 'https://demo.sports.galaxie.works', 'content-type': 'application/json' }),
      ),
    ).toBeNull();
  });

  it('recusa outra origem, origem ausente e site cruzado', async () => {
    for (const headers of <Record<string, string>[]>[
      { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      { 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
      { origin: 'https://evil.example', 'content-type': 'application/json' },
      { origin: 'null', 'content-type': 'application/json' },
      { 'content-type': 'application/json' },
    ]) {
      const res = rejectCrossSite(post(headers));
      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({ code: 'cross_site_request' });
    }
  });

  it('exige content-type application/json', () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])
      expect(rejectCrossSite(post({ 'sec-fetch-site': 'same-origin', 'content-type': type }))?.status).toBe(
        415,
      );
    expect(rejectCrossSite(post({ 'sec-fetch-site': 'same-origin' }))?.status).toBe(415);
  });
});
