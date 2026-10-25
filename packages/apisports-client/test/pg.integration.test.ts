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

  it('chamada em voo durante o /status não conta duas vezes no piso do fornecedor', async () => {
    let t = Date.parse('2026-10-24T10:00:00Z');
    const gov = new PgQuotaGovernor(
      db,
      () => defaultPolicy(100),
      () => new Date(t),
    );
    const ticket = await gov.acquire({
      api: 'handball',
      priority: 'DAILY',
      endpoint: '/games',
      requestHash: 's',
    });
    t += 1000;
    await gov.reconcile('handball', 1, 100, 'Free'); // o contador do fornecedor já inclui a chamada em voo
    t += 1000;
    await gov.settle(ticket, 'ok', 99);
    expect((await gov.usage('handball')).providerUsed).toBe(1);
  });
});

describe('cota esgotada informada pelo fornecedor', () => {
  /** Governor com relógio movível e um atalho para reservar como LIVE crítico. */
  function governorAt(start: string) {
    let t = Date.parse(start);
    const gov = new PgQuotaGovernor(
      db,
      () => defaultPolicy(100),
      () => new Date(t),
    );
    return {
      gov,
      at: (iso: string) => {
        t = Date.parse(iso);
      },
      live: (api: string, hash: string) =>
        gov.acquire({ api, priority: 'LIVE', endpoint: '/games', requestHash: hash, critical: true }),
    };
  }

  it('nega a API por 15 min, inclusive LIVE crítico, e depois libera uma nova tentativa', async () => {
    const { gov, at, live } = governorAt('2026-10-25T10:00:00Z');
    await gov.settle(await live('nba', 'e1'), 'quota_exhausted', 0);
    at('2026-10-25T10:05:00Z');
    await expect(live('nba', 'e2')).rejects.toBeInstanceOf(QuotaExceededError);
    at('2026-10-25T10:15:01Z');
    await expect(live('nba', 'e3')).resolves.toMatchObject({ dayUtc: '2026-10-25' });
  });

  it('"esgotada" de uma chamada do dia anterior que chega depois da meia-noite não trava o dia novo', async () => {
    const { gov, at, live } = governorAt('2026-10-25T23:59:58Z');
    const ticket = await live('mma', 'm1');
    at('2026-10-26T00:00:03Z');
    await gov.settle(ticket, 'quota_exhausted'); // resposta sem header de cota
    at('2026-10-26T00:00:30Z');
    await expect(live('mma', 'm2')).resolves.toMatchObject({ dayUtc: '2026-10-26' });
  });

  it('"esgotada" nos primeiros minutos do dia UTC (contador ainda no dia anterior) não bloqueia', async () => {
    const { gov, at, live } = governorAt('2026-10-27T00:00:10Z');
    await gov.settle(await live('volleyball', 'v1'), 'quota_exhausted', 0);
    at('2026-10-27T00:00:40Z');
    await expect(live('volleyball', 'v2')).resolves.toMatchObject({ dayUtc: '2026-10-27' });
  });

  it('"esgotada" com cota restante no header não bloqueia', async () => {
    const { gov, at, live } = governorAt('2026-10-25T12:00:00Z');
    await gov.settle(await live('afl', 'r1'), 'quota_exhausted', 37);
    at('2026-10-25T12:00:30Z');
    await expect(live('afl', 'r2')).resolves.toMatchObject({ dayUtc: '2026-10-25' });
  });
});

describe('limite por minuto entre processos', () => {
  it('dois processos com a mesma chave somam no máximo perMinute envios por minuto', async () => {
    // relógio virtual compartilhado: cada espera avança o tempo de todos (como num único servidor)
    let t = Date.parse('2026-10-23T12:00:00Z');
    const clock = {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
        await new Promise((r) => setImmediate(r));
      },
    };
    const sentAt: number[] = [];
    const fetchFn = (async () => {
      sentAt.push(t);
      return new Response(
        JSON.stringify({ get: 'teams', parameters: [], errors: [], results: 0, response: [] }),
      );
    }) as typeof globalThis.fetch;
    // cada processo tem o próprio limitador local (10/min) e o próprio Governor, sobre o mesmo banco
    const makeClient = () =>
      new ApiSportsClient({
        apiKey: 'k',
        store: new PgRawStore(db),
        governor: new PgQuotaGovernor(
          db,
          () => defaultPolicy(100, 15, 10),
          () => new Date(t),
          clock.sleep,
        ),
        fetch: fetchFn,
        clock,
        rateLimiter: new RateLimiter(10, clock),
      });
    const run = async (name: string) => {
      const client = makeClient();
      for (let i = 0; i < 12; i++) {
        await client.get({
          sport: 'football',
          endpoint: '/teams',
          params: { id: `${name}${i}` },
          priority: 'DAILY',
        });
      }
    };
    await Promise.all([run('a'), run('b')]);

    expect(sentAt).toHaveLength(24);
    // O espaçamento é medido no sent_at do ledger (o instante da reserva, logo antes do fetch). O horário
    // visto pelo fetch falso não serve: no relógio virtual, a espera do outro "processo" pode avançar o
    // tempo entre a reserva e o fetch, o que num servidor real leva milissegundos.
    const sorted = (await db.select().from(quotaLedger))
      .filter((l) => l.api === 'football' && l.dayUtc === '2026-10-23')
      .map((l) => l.sentAt.getTime())
      .sort((x, y) => x - y);
    expect(sorted).toHaveLength(24);
    // sem rajada: 1 envio a cada 6 s somando os dois processos
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(6000);
    // em qualquer janela de 60 s, no máximo 10 envios
    for (const start of sorted) {
      expect(sorted.filter((s) => s >= start && s < start + 60_000).length).toBeLessThanOrEqual(10);
    }
  });

  it('na virada da meia-noite, quem calculou o dia antes do lock ainda respeita a vaga e vê a chamada em voo', async () => {
    const policy = () => defaultPolicy(100, 15, 10);
    // B já está no dia novo e reserva às 00:00:00.100
    const b = new PgQuotaGovernor(db, policy, () => new Date('2026-10-29T00:00:00.100Z'));
    await b.acquire({ api: 'hockey', priority: 'LIVE', endpoint: '/games', requestHash: 'mid-1' });
    // A leu o relógio antes da meia-noite (dia do lock); depois dos locks o relógio já está em 00:00:00.200
    let calls = 0;
    let tA = Date.parse('2026-10-29T00:00:00.200Z');
    const waits: number[] = [];
    const a = new PgQuotaGovernor(
      db,
      policy,
      () => new Date(calls++ === 0 ? Date.parse('2026-10-28T23:59:59.900Z') : tA),
      async (ms) => {
        waits.push(ms);
        tA += ms;
      },
    );
    await expect(
      a.acquire({ api: 'hockey', priority: 'LIVE', endpoint: '/games', requestHash: 'mid-1' }),
    ).rejects.toBeInstanceOf(RequestInFlightError);
    calls = 0;
    const ticket = await a.acquire({
      api: 'hockey',
      priority: 'DAILY',
      endpoint: '/teams',
      requestHash: 'mid-2',
    });
    expect(ticket.dayUtc).toBe('2026-10-29');
    expect(Math.max(...waits)).toBeLessThanOrEqual(6000);
    const sent = (await db.select().from(quotaLedger))
      .filter((l) => l.api === 'hockey' && l.dayUtc === '2026-10-29')
      .map((l) => l.sentAt.getTime())
      .sort((x, y) => x - y);
    expect(sent).toHaveLength(2);
    expect(sent[1]! - sent[0]!).toBeGreaterThanOrEqual(6000);
  });
});
