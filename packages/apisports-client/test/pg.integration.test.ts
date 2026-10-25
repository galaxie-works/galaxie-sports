import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiResponse, closeDb, createDb, quotaLedger, runMigrations, type Database } from '@galaxie/db';
import { ApiSportsClient } from '../src/client.js';
import { QuotaExceededError, RequestInFlightError } from '../src/errors.js';
import { PgQuotaGovernor } from '../src/quota/pg-governor.js';
import { defaultPolicy } from '../src/quota/policy.js';
import { RateLimiter } from '../src/rate-limiter.js';
import { PgRawStore } from '../src/raw-store.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;
const now = () => new Date('2026-10-21T15:00:00Z');

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 20 });
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('PgQuotaGovernor', () => {
  it('sob concorrência, nunca concede além do orçamento', async () => {
    const gov = new PgQuotaGovernor(db, () => defaultPolicy(100), now);
    const attempts = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        gov.acquire({ api: 'basketball', priority: 'DAILY', endpoint: '/games', requestHash: `h${i}` }),
      ),
    );
    const granted = attempts.filter((a) => a.status === 'fulfilled').length;
    const denied = attempts.filter(
      (a) => a.status === 'rejected' && a.reason instanceof QuotaExceededError,
    ).length;
    // fatia de 40 + 5 de folga (a fatia do ADHOC não é protegida); DAILY e LIVE somam 80 protegidos
    expect(granted).toBe(45);
    expect(denied).toBe(15);
    expect((await gov.usage('basketball')).used.DAILY).toBe(45);
  });

  it('release devolve a reserva; settle registra o desfecho', async () => {
    const gov = new PgQuotaGovernor(db, () => defaultPolicy(100), now);
    const t1 = await gov.acquire({ api: 'hockey', priority: 'LIVE', endpoint: '/games', requestHash: 'a' });
    const t2 = await gov.acquire({ api: 'hockey', priority: 'LIVE', endpoint: '/games', requestHash: 'b' });
    await gov.release(t1);
    await gov.settle(t2, 'ok', 98);
    expect((await gov.usage('hockey')).used.LIVE).toBe(1);
  });

  it('plano do dia libera folga para o bootstrap; reconcile usa o contador do fornecedor como piso', async () => {
    const gov = new PgQuotaGovernor(db, () => defaultPolicy(100), now);
    await gov.plan('rugby', '2026-10-21', { LIVE: 0, DAILY: 10 });
    let n = 0;
    for (;;) {
      try {
        await gov.acquire({ api: 'rugby', priority: 'BOOTSTRAP', endpoint: '/games', requestHash: `b${n}` });
        n += 1;
      } catch {
        break;
      }
    }
    expect(n).toBe(75); // 100 − 15 de reserva − 10 protegidos para o DAILY

    await gov.reconcile('mma', 84, 100, 'Free');
    await gov.reconcile('mma', 80, 100, 'Free'); // leitura atrasada não regride o piso
    expect((await gov.usage('mma')).providerUsed).toBe(84);
    await gov.acquire({ api: 'mma', priority: 'DAILY', endpoint: '/fights', requestHash: 'x' });
    await expect(
      gov.acquire({ api: 'mma', priority: 'DAILY', endpoint: '/fights', requestHash: 'y' }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe('ApiSportsClient + Postgres', () => {
  it('grava raw e ledger e reaproveita a resposta do banco', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          get: 'leagues',
          parameters: [],
          errors: [],
          results: 1,
          paging: { current: 1, total: 1 },
          response: [{ league: { id: 71 } }],
        }),
        { headers: { 'x-ratelimit-requests-remaining': '99' } },
      );
    }) as typeof globalThis.fetch;

    const makeClient = () =>
      new ApiSportsClient({
        apiKey: 'k',
        store: new PgRawStore(db),
        governor: new PgQuotaGovernor(db, () => defaultPolicy(100), now),
        fetch: fetchFn,
        clock: { now: () => now().getTime(), sleep: async () => {} },
        rateLimiter: new RateLimiter(10),
      });

    const first = await makeClient().get({
      sport: 'volleyball',
      endpoint: '/leagues',
      priority: 'DAILY',
      jobId: 'job-1',
    });
    // outro processo (novo cliente) encontra a resposta no raw e não chama o fornecedor
    const second = await makeClient().get({ sport: 'volleyball', endpoint: '/leagues', priority: 'DAILY' });

    expect(first.source).toBe('network');
    expect(second.source).toBe('cache');
    expect(calls).toHaveLength(1);

    const raws = await db.select().from(apiResponse);
    const raw = raws.find((r) => r.sport === 'volleyball');
    expect(raw).toMatchObject({
      endpoint: '/leagues',
      apiVersion: 'v1',
      results: 1,
      quotaRemaining: 99,
      jobId: 'job-1',
    });

    const ledger = (await db.select().from(quotaLedger)).filter((l) => l.api === 'volleyball');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ outcome: 'ok', remainingAfter: 99, priority: 'DAILY' });

    // a busca filtra pelas colunas iniciais do índice (provider, sport, endpoint), não só pelo hash
    const store = new PgRawStore(db);
    const scope = { provider: 'api-sports', sport: 'volleyball', endpoint: '/leagues' };
    expect(await store.findFresh(first.requestHash, Infinity, now(), scope)).toBeDefined();
    expect(
      await store.findFresh(first.requestHash, Infinity, now(), { ...scope, endpoint: '/teams' }),
    ).toBeUndefined();
  });
});

describe('revisão: concorrência entre processos e leituras atrasadas', () => {
  it('dois processos pedindo a mesma coisa ao mesmo tempo geram uma única chamada ao fornecedor', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      calls.push(String(input));
      await new Promise((r) => setTimeout(r, 300));
      return new Response(
        JSON.stringify({
          get: 'teams',
          parameters: [],
          errors: [],
          results: 1,
          paging: { current: 1, total: 1 },
          response: [{ id: 1 }],
        }),
      );
    }) as typeof globalThis.fetch;
    const makeClient = () =>
      new ApiSportsClient({
        apiKey: 'k',
        store: new PgRawStore(db),
        governor: new PgQuotaGovernor(db, () => defaultPolicy(100)),
        fetch: fetchFn,
        rateLimiter: new RateLimiter(600),
      });
    const req = {
      sport: 'handball',
      endpoint: '/teams',
      params: { country: 'Brazil' },
      priority: 'DAILY',
    } as const;
    const [a, b] = await Promise.all([makeClient().get(req), makeClient().get(req)]);
    expect(calls).toHaveLength(1);
    expect([a.source, b.source].sort()).toEqual(['cache', 'network']);
  });

  it('reconcile com leitura atrasada não reduz o piso de uso', async () => {
    let t = Date.parse('2026-10-21T16:00:00Z');
    const gov = new PgQuotaGovernor(
      db,
      () => defaultPolicy(100),
      () => new Date(t),
    );
    await gov.reconcile('baseball', 10, 100, 'Free');
    for (let i = 0; i < 5; i++) {
      t += 1000;
      await gov.acquire({ api: 'baseball', priority: 'DAILY', endpoint: '/games', requestHash: `r${i}` });
    }
    expect((await gov.usage('baseball')).providerUsed).toBe(15);
    t += 1000;
    await gov.reconcile('baseball', 10, 100, 'Free');
    expect((await gov.usage('baseball')).providerUsed).toBe(15);
  });

  it('chamada em voo reservada antes da meia-noite UTC ainda bloqueia a mesma requisição depois dela', async () => {
    let t = Date.parse('2026-10-21T23:59:00Z');
    const gov = new PgQuotaGovernor(
      db,
      () => defaultPolicy(100),
      () => new Date(t),
    );
    const req = { api: 'afl', priority: 'DAILY', endpoint: '/games', requestHash: 'midnight' } as const;
    const ticket = await gov.acquire(req);
    t = Date.parse('2026-10-22T00:01:00Z');
    await expect(gov.acquire(req)).rejects.toBeInstanceOf(RequestInFlightError);
    // o mesmo hash em outra API não é a mesma requisição (o hash inclui o esporte)
    await expect(gov.acquire({ ...req, api: 'nba' })).resolves.toMatchObject({ dayUtc: '2026-10-22' });
    await gov.settle(ticket, 'ok');
    await expect(gov.acquire(req)).resolves.toMatchObject({ dayUtc: '2026-10-22' });
  });

  it('limite reconciliado do fornecedor vira teto da política', async () => {
    const gov = new PgQuotaGovernor(db, () => defaultPolicy(7500), now);
    await gov.reconcile('american-football', 0, 100, 'Free');
    const report = await gov.usage('american-football');
    expect(report.dailyLimit).toBe(100);
    expect(report.budget.DAILY).toBe(40);
  });
});
