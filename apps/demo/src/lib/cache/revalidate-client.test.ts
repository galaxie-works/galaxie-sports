import { describe, expect, it, vi } from 'vitest';

import { internalBaseUrl, revalidateOverHttp } from './revalidate-client';
import { REVALIDATE_HEADER, verifyRevalidate } from './signature';

const NOW = 1_800_000_000_000;

describe('revalidateOverHttp', () => {
  it('posta as tags na rota interna com a assinatura do corpo', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: { revalidated: 2 } }));
    const send = revalidateOverHttp({
      baseUrl: 'http://127.0.0.1:3000/',
      secret: () => 's',
      fetch: fetchMock,
      now: () => NOW,
    });
    await send(['f1_editorial', 'team:t1']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3000/api/interno/revalidar');
    expect(init?.method).toBe('POST');
    const body = init?.body as string;
    expect(JSON.parse(body)).toEqual({ tags: ['f1_editorial', 'team:t1'] });
    const header = (init?.headers as Record<string, string>)[REVALIDATE_HEADER]!;
    expect(verifyRevalidate(header, 's', body, NOW)).toBe(true);
  });

  it('resposta de erro rejeita (o seguidor tenta de novo)', async () => {
    const send = revalidateOverHttp({
      baseUrl: 'http://x',
      secret: () => 's',
      fetch: async () => new Response(null, { status: 401 }),
    });
    await expect(send(['a'])).rejects.toThrow('401');
  });
});

describe('internalBaseUrl', () => {
  it('DEMO_INTERNAL_URL ou a porta do servidor', () => {
    expect(internalBaseUrl({ DEMO_INTERNAL_URL: 'http://demo:3000' })).toBe('http://demo:3000');
    expect(internalBaseUrl({ PORT: '4000' })).toBe('http://127.0.0.1:4000');
    expect(internalBaseUrl({})).toBe('http://127.0.0.1:3000');
  });
});
