import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardedFetch, isNotPublicError, isPublicAddress, type HostResolver } from '@galaxie/net-guard';
import { proxyRequest, type BrowserRequest } from './render.js';

/*
 * As requisições do navegador headless saem pelo `guardedFetch` dos agentes (render.ts): o DNS é resolvido
 * e conferido na conexão daqui, não no contêiner do navegador.
 */
describe('proxyRequest (requisições do navegador headless)', () => {
  let server: http.Server;
  let base = '';
  const seen: {
    method?: string | undefined;
    ua?: string | undefined;
    host?: string | undefined;
    body: string;
  }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, ua: req.headers['user-agent'], host: req.headers.host, body });
        if (req.url === '/redir') {
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
          return res.end();
        }
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('set-cookie', ['a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'b=2; Path=/']);
        res.end('<p>grade</p>');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const req = (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) =>
    ({
      url: () => url,
      method: () => init.method ?? 'GET',
      headers: () => init.headers ?? {},
      postDataBuffer: () => (init.body ? Buffer.from(init.body) : null),
    }) satisfies BrowserRequest;

  // o servidor do teste é local: só 127.0.0.1 liberado; "rebind.example" resolve para a rede da stack
  const resolve: HostResolver = async (h) =>
    h === 'rebind.example' ? [{ address: '172.30.50.10', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
  const local = guardedFetch({ allowAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip), resolve });

  it('repassa método, cabeçalhos e corpo; devolve o que vai no route.fulfill', async () => {
    const out = await proxyRequest(
      local,
      req(`${base}/plano`, {
        method: 'POST',
        headers: { 'user-agent': 'galaxie-teste', host: 'outro.example', 'content-length': '3' },
        body: 'a=1',
      }),
    );
    expect(out.status).toBe(200);
    expect(out.body.toString()).toBe('<p>grade</p>');
    expect(out.headers['content-type']).toContain('text/html');
    // cada Set-Cookie inteiro, separados por quebra de linha (o formato do route.fulfill)
    expect(out.headers['set-cookie']).toBe('a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT\nb=2; Path=/');
    expect(seen.at(-1)).toMatchObject({ method: 'POST', ua: 'galaxie-teste', body: 'a=1' });
    // o host é o da URL, não o que o navegador mandou
    expect(seen.at(-1)?.host).toBe(new URL(base).host);
  });

  it('redirecionamento volta ao navegador como 3xx (o salto seguinte passa de novo pela conferência)', async () => {
    const out = await proxyRequest(local, req(`${base}/redir`));
    expect(out.status).toBe(302);
    expect(out.headers.location).toBe('http://169.254.169.254/latest/meta-data/');
    const meta = await proxyRequest(local, req(out.headers.location!)).catch((e: unknown) => e);
    expect(isNotPublicError(meta)).toBe(true);
  });

  it('recusa nome que resolve para a rede interna e, no padrão, o loopback', async () => {
    const rebind = await proxyRequest(local, req('http://rebind.example/')).catch((e: unknown) => e);
    expect(isNotPublicError(rebind)).toBe(true);
    const loop = await proxyRequest(guardedFetch(), req(`${base}/plano`)).catch((e: unknown) => e);
    expect(isNotPublicError(loop)).toBe(true);
  });
});
