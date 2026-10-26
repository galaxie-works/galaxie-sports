import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { RealtimeChange } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import type { TenantContext } from '../auth/authenticator.js';
import { problems } from '../errors.js';
import { registerCors } from '../security/cors.js';
import { registerSecurityHeaders } from '../security/headers.js';
import type { ChangeStream } from './change-stream.js';
import type { ConnectionLimiter } from './connection-limiter.js';
import { streamRoutes } from './sse.js';

const ctx: TenantContext = {
  tenantId: 't-1',
  slug: 'tv',
  plan: 'enterprise',
  keyId: 'k-1',
  keyKind: 'secret',
  env: 'live',
  modules: ['core_data'],
  markets: [],
  sports: [],
  rateLimitPerMinute: 100,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Limiter que registra as chamadas; `acquire` pode ficar pendente até `release()` do teste. */
function spyLimiter(gate?: Promise<boolean>) {
  const calls = { acquire: 0, renew: 0, release: [] as string[] };
  const limiter: ConnectionLimiter = {
    acquire: async () => {
      calls.acquire += 1;
      return gate ?? true;
    },
    renew: async () => {
      calls.renew += 1;
    },
    release: async (_t, id) => {
      calls.release.push(id);
    },
  };
  return { limiter, calls };
}

let app: FastifyInstance | undefined;
const subscribers = new Set<(c: RealtimeChange) => void>();

async function harness(options: {
  limiter: ConnectionLimiter;
  reauthenticate?: (maxAgeMs?: number) => Promise<TenantContext>;
  cors?: boolean;
}): Promise<string> {
  app = Fastify();
  registerSecurityHeaders(app);
  if (options.cors) registerCors(app, { origins: ['https://app.exemplo.test'] });
  app.decorateRequest('tenant', null);
  app.decorateRequest('reauthenticate', null);
  // faz o papel do hook de autenticação do server.ts
  app.addHook('onRequest', async (request) => {
    request.tenant = ctx;
    request.reauthenticate = options.reauthenticate ?? null;
  });
  const stream = {
    subscribe: (fn: (c: RealtimeChange) => void) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    latestId: async () => 0,
  } as unknown as ChangeStream;
  await app.register(async (instance) => {
    await streamRoutes(instance, {
      db: {} as Database,
      stream,
      limiter: options.limiter,
      options: { heartbeatMs: 30 },
    });
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/stream`;
}

function connect(url: string, headers: Record<string, string> = {}) {
  let body = '';
  let ended = false;
  let res: IncomingMessage | undefined;
  const req: ClientRequest = httpRequest(url, { headers, agent: false }, (r) => {
    res = r;
    r.setEncoding('utf8');
    r.on('data', (c: string) => (body += c));
    r.on('end', () => (ended = true));
    r.on('close', () => (ended = true));
  });
  req.on('error', () => {});
  req.end();
  return { req, body: () => body, ended: () => ended, res: () => res };
}

afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  subscribers.clear();
});

describe('GET /v1/stream — ciclo de vida da conexão', () => {
  it('cliente que cai durante o acquire não deixa lease, heartbeat nem ouvinte (auditoria API-8)', async () => {
    let open!: (v: boolean) => void;
    const gate = new Promise<boolean>((r) => (open = r));
    const { limiter, calls } = spyLimiter(gate);
    const url = await harness({ limiter });
    const c = connect(url);
    await expect.poll(() => calls.acquire).toBe(1);
    c.req.destroy();
    await sleep(50);
    open(true);
    await expect.poll(() => calls.release.length).toBe(1);
    await sleep(150); // ~5 heartbeats
    expect(calls.renew).toBe(0);
    expect(subscribers.size).toBe(0);
  });

  it('headers de segurança e CORS na resposta SSE, apesar do hijack (auditoria API-11)', async () => {
    const { limiter } = spyLimiter();
    const url = await harness({ limiter, cors: true });
    const c = connect(url, { origin: 'https://app.exemplo.test' });
    await expect.poll(() => c.res()).toBeDefined();
    const h = c.res()!.headers;
    expect(h['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(h).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'access-control-allow-origin': 'https://app.exemplo.test',
      vary: 'Origin',
    });
    expect(h['content-security-policy']).toContain("default-src 'none'");
    c.req.destroy();

    const other = connect(url, { origin: 'https://atacante.test' });
    await expect.poll(() => other.res()).toBeDefined();
    expect(other.res()!.headers['access-control-allow-origin']).toBeUndefined();
    other.req.destroy();
  });

  it('revalida a chave no heartbeat: revogada → access_revoked e fim do stream (auditoria API-12)', async () => {
    const { limiter, calls } = spyLimiter();
    let revoked = false;
    let dbDown = true;
    const url = await harness({
      limiter,
      reauthenticate: async () => {
        if (dbDown) throw new Error('banco fora');
        if (revoked) throw problems.invalidKey('Chave revogada.');
        return ctx;
      },
    });
    const c = connect(url);
    await expect.poll(() => c.body()).toContain('event: ready');
    // erro que não é de acesso (banco fora): o stream continua
    await expect.poll(() => calls.renew).toBeGreaterThanOrEqual(2);
    expect(c.ended()).toBe(false);
    dbDown = false;
    await sleep(60);
    expect(c.ended()).toBe(false);
    revoked = true;
    await expect.poll(() => c.ended()).toBe(true);
    expect(c.body()).toMatch(
      /event: access_revoked\ndata: \{"code":"INVALID_KEY".*"detail":"Chave revogada\."\}/,
    );
    await expect.poll(() => calls.release.length).toBe(1);
    expect(subscribers.size).toBe(0);
  });

  it('revalidação lenta não se sobrepõe; o cache usado tem no máximo 60 s − heartbeat', async () => {
    const { limiter, calls } = spyLimiter();
    const ages: (number | undefined)[] = [];
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const url = await harness({
      limiter,
      reauthenticate: async (maxAgeMs) => {
        ages.push(maxAgeMs);
        await slow;
        return ctx;
      },
    });
    const c = connect(url);
    await expect.poll(() => c.body()).toContain('event: ready');
    await expect.poll(() => calls.renew).toBeGreaterThanOrEqual(5);
    expect(ages).toEqual([60_000 - 30]);
    release();
    await expect.poll(() => ages.length).toBeGreaterThan(1);
    c.req.destroy();
  });

  it('módulo retirado do plano também encerra o stream', async () => {
    const { limiter } = spyLimiter();
    let modules: TenantContext['modules'] = ['core_data'];
    const url = await harness({ limiter, reauthenticate: async () => ({ ...ctx, modules }) });
    const c = connect(url);
    await expect.poll(() => c.body()).toContain('event: ready');
    modules = [];
    await expect.poll(() => c.ended()).toBe(true);
    expect(c.body()).toContain('"code":"MODULE_NOT_IN_PLAN"');
  });
});
