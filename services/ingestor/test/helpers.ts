import type { Clock } from '@galaxie/apisports-client';

/** PNG mínimo: assinatura + chunk IHDR com largura/altura (+ bytes extras para variar o hash). */
export function fakePng(width: number, height: number, extra = 0): Uint8Array {
  const buf = new Uint8Array(33 + extra);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  for (let i = 33; i < buf.length; i++) buf[i] = i % 251;
  return buf;
}

/** Relógio virtual para testes: `sleep` avança o tempo na hora, sem esperar de verdade. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];

  constructor(private t = Date.parse('2026-10-21T12:00:00Z')) {}

  now(): number {
    return this.t;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.t += ms;
    await Promise.resolve();
  }
}

export interface FakeRoute {
  status: number;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
}

/**
 * `fetch` falso da CDN de mídia: cada URL tem uma fila de respostas (a última se repete).
 * Registra as requisições (URL e headers) para as asserções.
 */
export function fakeMediaFetch(routes: Record<string, FakeRoute[]>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const queue = routes[url] ?? [{ status: 404 }];
    const route = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(route.status === 204 ? null : (route.body ?? ''), {
      status: route.status,
      headers: route.headers ?? {},
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, calls };
}
