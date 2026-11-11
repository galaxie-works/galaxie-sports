/**
 * HTTP dos clientes que falam direto com a API (sem SDK): POST JSON com timeout e cancelamento, erro HTTP
 * com `status` e o código do provedor (para o classificador de erros) e leitura de Server-Sent Events.
 */
import { classifyProviderError } from './errors.js';

/** fetch injetável (testes). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Erro HTTP do provedor: `status`, `code` e `type` são lidos por classifyProviderError. */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly type?: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

/** Sinal que cancela no timeout ou no sinal de quem chamou (o que vier primeiro). */
export function callSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/** Corpo de erro nos formatos da OpenAI/DeepSeek, Anthropic e Gemini. */
interface ErrorBody {
  error?: { message?: unknown; code?: unknown; type?: unknown; status?: unknown } | string;
  message?: unknown;
}

/** Converte uma resposta não-ok em ProviderHttpError com a mensagem e o código do provedor. */
export async function httpErrorOf(res: Response): Promise<ProviderHttpError> {
  const text = await res.text().catch(() => '');
  let body: ErrorBody = {};
  try {
    const parsed = JSON.parse(text) as ErrorBody | ErrorBody[];
    body = (Array.isArray(parsed) ? parsed[0] : parsed) ?? {};
  } catch {
    // corpo fora de JSON: fica a mensagem genérica
  }
  const e = typeof body.error === 'object' && body.error ? body.error : {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const message =
    str(e.message) ?? str(body.error) ?? str(body.message) ?? (text.slice(0, 200) || `HTTP ${res.status}`);
  return new ProviderHttpError(message, res.status, str(e.code) ?? str(e.status), str(e.type));
}

/**
 * POST JSON; erros de rede, timeout e HTTP já saem como LlmError (classifyProviderError). Devolve a
 * resposta ok (o corpo ainda não lido: JSON ou stream).
 */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  provider: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw classifyProviderError(err, provider);
  }
  if (!res.ok) throw classifyProviderError(await httpErrorOf(res), provider);
  return res;
}

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Eventos de um corpo `text/event-stream` (linhas `event:` e `data:`, separados por linha em branco).
 * Comentários (`:`) e eventos sem `data` são ignorados.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];
  const flush = (): SseEvent | undefined => {
    const out = data.length ? { ...(event ? { event } : {}), data: data.join('\n') } : undefined;
    event = undefined;
    data = [];
    return out;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1));
        if (line === '') {
          const ev = flush();
          if (ev) yield ev;
        } else if (line.startsWith(':')) continue;
        else {
          const i = line.indexOf(':');
          const field = i < 0 ? line : line.slice(0, i);
          const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
      if (done) {
        if (buffer) data.push(...(buffer.startsWith('data:') ? [buffer.slice(5).replace(/^ /, '')] : []));
        const ev = flush();
        if (ev) yield ev;
        return;
      }
    }
  } finally {
    // quem parou de ler antes do fim (ou o fim normal): fecha a conexão
    await reader.cancel().catch(() => {});
  }
}
