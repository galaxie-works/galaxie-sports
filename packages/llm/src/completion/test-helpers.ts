/** fetch falso dos testes: respostas em fila, com as chamadas registradas. */
import type { FetchLike } from '../http.js';

export interface FakeCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

export type FakeReply = Response | Error | ((init: RequestInit) => Promise<Response>);

export function fakeFetch(replies: FakeReply[]): FetchLike & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
    const next = replies.shift();
    if (!next) throw new Error('fetch falso sem resposta na fila');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(init);
    return next;
  }) as FetchLike & { calls: FakeCall[] };
  fn.calls = calls;
  return fn;
}

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Resposta `text/event-stream` com os eventos em pedaços (testa a junção de linhas partidas). */
export function sseResponse(events: Array<{ event?: string; data: unknown }>, chunkSize = 7): Response {
  const text = events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Resposta que só chega quando o sinal aborta (simula o provedor que não responde). */
export function hangingResponse(): (init: RequestInit) => Promise<Response> {
  return (init) =>
    new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
