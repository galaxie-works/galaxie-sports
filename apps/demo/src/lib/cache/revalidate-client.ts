/**
 * Chamada do seguidor do change feed à rota interna de revalidação do próprio servidor. O `revalidateTag`
 * do Next só funciona dentro de uma requisição (Route Handler ou Server Action), não no processo de fundo
 * que o instrumentation.ts sobe; por isso o seguidor fala com o servidor por HTTP, assinado.
 */
import type { Revalidate } from './follower';
import { REVALIDATE_HEADER, REVALIDATE_ROUTE, signRevalidate } from './signature';

export interface RevalidateClientOptions {
  /** Origem do próprio servidor (ex.: http://127.0.0.1:3000). */
  baseUrl: string;
  secret: () => string;
  fetch?: typeof fetch;
  /** Na primeira chamada do `next dev` a rota ainda compila. */
  timeoutMs?: number;
  now?: () => number;
}

export function revalidateOverHttp(options: RevalidateClientOptions): Revalidate {
  const url = `${options.baseUrl.replace(/\/+$/, '')}${REVALIDATE_ROUTE}`;
  return async (tags) => {
    const body = JSON.stringify({ tags });
    const unix = Math.floor((options.now ?? Date.now)() / 1000);
    const res = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [REVALIDATE_HEADER]: signRevalidate(options.secret(), unix, body),
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`revalidação respondeu ${res.status}`);
  };
}

/** Origem do servidor para a chamada interna: DEMO_INTERNAL_URL ou a porta em que o Next escuta. */
export function internalBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.DEMO_INTERNAL_URL || `http://127.0.0.1:${env.PORT || 3000}`;
}
