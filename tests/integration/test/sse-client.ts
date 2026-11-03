import { request, type IncomingHttpHeaders } from 'node:http';

/**
 * Cliente SSE mínimo para os testes de integração. Usa `node:http` com uma conexão por requisição
 * (`agent: false`): o pool do fetch abre conexões especulativas que seguram o close do servidor.
 */
export interface SseMessage {
  id?: string;
  event: string;
  data: string;
  receivedAt: number;
}

export interface SseClient {
  status: number;
  headers: IncomingHttpHeaders;
  messages: SseMessage[];
  /** Texto bruto recebido (inclui comentários/heartbeats). */
  raw: () => string;
  waitFor: (pred: (m: SseMessage) => boolean, timeoutMs?: number) => Promise<SseMessage>;
  close: () => void;
  /** Corpo JSON de uma resposta que não é SSE (erros). */
  body?: unknown;
}

export function openSse(url: string, headers: Record<string, string> = {}): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, agent: false }, (res) => {
      res.setEncoding('utf8');
      const messages: SseMessage[] = [];
      const waiters: (() => void)[] = [];
      let raw = '';
      const client: SseClient = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        messages,
        raw: () => raw,
        close: () => req.destroy(),
        waitFor: (pred, timeoutMs = 5_000) =>
          new Promise((ok, fail) => {
            const timer = setTimeout(
              () => fail(new Error(`SSE: mensagem esperada não chegou em ${timeoutMs} ms`)),
              timeoutMs,
            );
            const waiter = () => {
              const found = messages.find(pred);
              if (!found) return void waiters.push(waiter);
              clearTimeout(timer);
              ok(found);
            };
            waiter();
          }),
      };
      if (!String(res.headers['content-type']).startsWith('text/event-stream')) {
        let body = '';
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          try {
            client.body = JSON.parse(body);
          } catch {
            client.body = body;
          }
          resolve(client);
        });
        return;
      }
      let buffer = '';
      res.on('data', (chunk: string) => {
        raw += chunk;
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const msg: SseMessage = { event: 'message', data: '', receivedAt: Date.now() };
          let hasData = false;
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) continue;
            const i = line.indexOf(':');
            const field = i < 0 ? line : line.slice(0, i);
            const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
            if (field === 'id') msg.id = value;
            else if (field === 'event') msg.event = value;
            else if (field === 'data') {
              msg.data += (hasData ? '\n' : '') + value;
              hasData = true;
            }
          }
          if (hasData) messages.push(msg);
        }
        for (const w of waiters.splice(0)) w();
      });
      res.on('error', () => {});
      resolve(client);
    });
    // depois de resolvido (close() destrói a requisição), rejeitar não tem efeito
    req.on('error', reject);
    req.end();
  });
}
