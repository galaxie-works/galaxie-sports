import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  guardedFetch,
  hostIsPublic,
  isNotPublicError,
  isPublicAddress,
  isPublicHttpUrl,
  type HostResolver,
} from './index.js';

describe('isPublicAddress / isPublicHttpUrl', () => {
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.30.50.1',
    '192.168.1.34',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fd00:ec2::254',
    'fe80::1',
    '64:ff9b::a9fe:a9fe',
  ])('recusa %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it('aceita endereços públicos', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('filtra nome interno, credencial e protocolo', () => {
    expect(isPublicHttpUrl('https://example.com/a')).toBe(true);
    expect(isPublicHttpUrl('http://localhost:8080/')).toBe(false);
    expect(isPublicHttpUrl('http://postgres:5432/')).toBe(false);
    expect(isPublicHttpUrl('http://api.internal/')).toBe(false);
    expect(isPublicHttpUrl('http://[::1]/')).toBe(false);
    expect(isPublicHttpUrl('https://user:pw@example.com/')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
  });
});

describe('hostIsPublic', () => {
  const dns: Record<string, string[]> = {
    'public.example': ['93.184.216.34'],
    'rebind.example': ['93.184.216.34', '10.0.0.5'],
    'meta.example': ['169.254.169.254'],
  };
  const resolve: HostResolver = async (h) => {
    const all = dns[h];
    if (!all) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    return all.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };

  it('exige que todos os endereços sejam públicos', async () => {
    expect(await hostIsPublic('public.example', resolve)).toBe(true);
    expect(await hostIsPublic('rebind.example', resolve)).toBe(false);
    expect(await hostIsPublic('meta.example', resolve)).toBe(false);
    expect(await hostIsPublic('nao-existe.example', resolve)).toBe(false);
    expect(await hostIsPublic('localhost', resolve)).toBe(false);
    expect(await hostIsPublic('[::1]', resolve)).toBe(false);
    expect(await hostIsPublic('8.8.8.8', resolve)).toBe(true);
  });
});

describe('guardedFetch', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.setHeader('content-type', 'text/plain');
        res.end('olá');
      } else if (req.url === '/gz') {
        res.setHeader('content-encoding', 'gzip');
        res.end(zlib.gzipSync(Buffer.from('comprimido')));
      } else if (req.url === '/redir-ok') {
        res.writeHead(302, { location: '/ok' });
        res.end();
      } else if (req.url === '/redir-meta') {
        res.writeHead(301, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      } else if (req.url === '/redir-nome') {
        res.writeHead(302, { location: 'http://interno.example/' });
        res.end();
      } else if (req.url === '/ua') {
        res.end(req.headers['user-agent'] ?? '');
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // o servidor do teste é local: só 127.0.0.1 liberado; "interno.example" resolve para 10.0.0.9
  const allowLocal = (ip: string) => ip === '127.0.0.1' || isPublicAddress(ip);
  const resolve: HostResolver = async (h) =>
    h === 'interno.example' ? [{ address: '10.0.0.9', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
  const f = guardedFetch({ allowAddress: allowLocal, resolve });

  it('busca, descomprime e repassa os cabeçalhos', async () => {
    const res = await f(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('olá');
    expect(await (await f(`${base}/gz`)).text()).toBe('comprimido');
    expect(await (await f(`${base}/ua`, { headers: { 'user-agent': 'galaxie-teste' } })).text()).toBe(
      'galaxie-teste',
    );
  });

  it('segue redirecionamento permitido e para no 3xx com redirect manual', async () => {
    expect(await (await f(`${base}/redir-ok`)).text()).toBe('olá');
    const manual = await f(`${base}/redir-ok`, { redirect: 'manual' });
    expect(manual.status).toBe(302);
    expect(manual.headers.get('location')).toBe('/ok');
  });

  it('recusa redirecionamento para metadados da nuvem e para nome que resolve em IP privado', async () => {
    const meta = await f(`${base}/redir-meta`).catch((e: unknown) => e);
    expect(isNotPublicError(meta)).toBe(true);
    const nome = await f(`${base}/redir-nome`).catch((e: unknown) => e);
    expect(isNotPublicError(nome)).toBe(true);
  });

  it('no padrão (só públicos) recusa o loopback', async () => {
    const err = await guardedFetch()(`${base}/ok`).catch((e: unknown) => e);
    expect(isNotPublicError(err)).toBe(true);
    const named = await guardedFetch({ resolve })('http://qualquer.example/ok').catch((e: unknown) => e);
    expect(isNotPublicError(named)).toBe(true);
  });
});
