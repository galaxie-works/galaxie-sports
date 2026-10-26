import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const next = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: next.revalidateTag }));

import { REVALIDATE_HEADER, signRevalidate } from '@/lib/cache/signature';

import { POST } from './route';

const SECRET = 'segredo-de-teste';
const LOCAL = { 'x-forwarded-for': '127.0.0.1' };

const sign = (body: string) => signRevalidate(SECRET, Math.floor(Date.now() / 1000), body);

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://127.0.0.1:3000/api/interno/revalidar', {
      method: 'POST',
      headers: { ...LOCAL, [REVALIDATE_HEADER]: sign(body), ...headers },
      body,
    }),
  );
}

/** Corpo em stream que registra se alguém começou a lê-lo. */
function trackedBody(chunks: Uint8Array[]) {
  const state = { pulled: 0 };
  // highWaterMark 0: o stream só puxa quando alguém lê (sem pré-carregar o primeiro pedaço)
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[state.pulled++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

const streamed = (stream: ReadableStream<Uint8Array>, headers: Record<string, string>) =>
  POST(
    new Request('http://127.0.0.1:3000/api/interno/revalidar', {
      method: 'POST',
      headers,
      body: stream,
      duplex: 'half',
    } as RequestInit),
  );

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_SECRET', SECRET);
  vi.stubEnv('DEMO_INTERNAL_URL', '');
  next.revalidateTag.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/interno/revalidar', () => {
  it('revalida as tags assinadas', async () => {
    const res = await post(JSON.stringify({ tags: ['f1_editorial', 'event'] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { revalidated: 2 } });
    expect(next.revalidateTag.mock.calls).toEqual([
      ['f1_editorial', { expire: 0 }],
      ['event', 'max'],
    ]);
  });

  it('revalidateTag falhou: responde 500 (o seguidor não avança o cursor)', async () => {
    next.revalidateTag.mockImplementation((tag: string) => {
      if (tag === 'f1_editorial') throw new Error('Invariant: static generation store missing');
    });
    const res = await post(JSON.stringify({ tags: ['f1_editorial', 'team:t1'] }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      code: 'revalidate_failed',
      data: { revalidated: 1, failed: ['f1_editorial'] },
    });
  });

  it('assinatura inválida: 401 sem ler um byte do corpo', async () => {
    const { stream, state } = trackedBody([new TextEncoder().encode('{"tags":["x"]}')]);
    const res = await streamed(stream, {
      ...LOCAL,
      [REVALIDATE_HEADER]: signRevalidate('outro-segredo', Math.floor(Date.now() / 1000), '{}'),
    });
    expect(res.status).toBe(401);
    expect(state.pulled).toBe(0);
    expect(next.revalidateTag).not.toHaveBeenCalled();
  });

  it('Content-Length acima do teto: 413 antes de ler o corpo', async () => {
    const { stream, state } = trackedBody([new Uint8Array(10)]);
    const res = await streamed(stream, {
      ...LOCAL,
      [REVALIDATE_HEADER]: sign('{}'),
      'content-length': String(10_000_000),
    });
    expect(res.status).toBe(413);
    expect(state.pulled).toBe(0);
  });

  it('corpo em stream sem Content-Length: para de ler ao passar do teto', async () => {
    const chunk = new Uint8Array(100_000);
    const { stream, state } = trackedBody(Array.from({ length: 50 }, () => chunk));
    const res = await streamed(stream, { ...LOCAL, [REVALIDATE_HEADER]: sign('{}') });
    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThan(5);
  });

  it('corpo diferente do assinado: 401', async () => {
    const res = await POST(
      new Request('http://127.0.0.1:3000/api/interno/revalidar', {
        method: 'POST',
        headers: { ...LOCAL, [REVALIDATE_HEADER]: sign('{"tags":["a"]}') },
        body: '{"tags":["b"]}',
      }),
    );
    expect(res.status).toBe(401);
    expect(next.revalidateTag).not.toHaveBeenCalled();
  });

  it('chamada de fora do próprio host: 403, mesmo com assinatura válida', async () => {
    const body = JSON.stringify({ tags: ['a'] });
    expect((await post(body, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(403);
    expect((await post(body, { 'x-forwarded-for': '' })).status).toBe(403);
    expect((await post(body, { 'x-forwarded-for': '::ffff:127.0.0.1' })).status).toBe(200);
    // servidor que se chama por outro endereço (DEMO_INTERNAL_URL): só a assinatura vale
    vi.stubEnv('DEMO_INTERNAL_URL', 'http://demo:3000');
    expect((await post(body, { 'x-forwarded-for': '10.0.0.5' })).status).toBe(200);
  });
});
