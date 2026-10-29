import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiResponse,
  closeDb,
  createDb,
  quotaLedger,
  quotaSnapshot,
  runMigrations,
  type Database,
} from '@galaxie/db';
import { and, eq } from 'drizzle-orm';
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
    const gov = new PgQuotaGovernor(db, () => defaultPolicy(100, 15), now);
    const attempts = await Promise.allSettled(
      Array.from({ length: 80 }, (_, i) =>
        gov.acquire({ api: 'basketball', priority: 'DAILY', endpoint: '/games', requestHash: `h${i}` }),
      ),
    );
    const granted = attempts.filter((a) => a.status === 'fulfilled').length;
    const denied = attempts.filter(
      (a) => a.status === 'rejected' && a.reason instanceof QuotaExceededError,
    ).length;
    // fatia de 40 + 20 de folga: abaixo de 85 só ficam protegidos os 25 do ao vivo que a reserva de 15 não cobre
    expect(granted).toBe(60);
    expect(denied).toBe(20);
    expect((await gov.usage('basketball')).used.DAILY).toBe(60);
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
    const gov = new PgQuotaGovernor(db, () => defaultPolicy(100, 15), now);
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
  /** Governor com relógio movível e um atalho para reservar como LIVE. */
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
        gov.acquire({ api, priority: 'LIVE', endpoint: '/games', requestHash: hash }),
    };
  }

  it('nega a API por 15 min, inclusive o ao vivo, e depois libera uma nova tentativa', async () => {
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

  it('a sonda depois da janela, se vier esgotada de novo, volta a bloquear por mais 15 min', async () => {
    const { gov, at, live } = governorAt('2026-10-30T10:00:00Z');
    await gov.settle(await live('nba', 'p1'), 'quota_exhausted', 0);
    at('2026-10-30T10:15:01Z');
    await gov.settle(await live('nba', 'p2'), 'quota_exhausted', 0);
    at('2026-10-30T10:29:00Z');
    await expect(live('nba', 'p3')).rejects.toBeInstanceOf(QuotaExceededError);
    // o operador vê o motivo no relatório (CLI `quota`)
    expect((await gov.usage('nba')).providerExhausted).toBe(true);
    at('2026-10-30T10:30:02Z');
    await expect(live('nba', 'p4')).resolves.toMatchObject({ dayUtc: '2026-10-30' });
    expect((await gov.usage('nba')).providerExhausted).toBeUndefined();
  });

  it('fronteira da carência do começo do dia: 00:04:59 não bloqueia, 00:05:01 bloqueia', async () => {
    const { gov, at, live } = governorAt('2026-10-31T00:04:59Z');
    await gov.settle(await live('baseball', 'g1'), 'quota_exhausted', 0);
    at('2026-10-31T00:05:01Z');
    const probe = await live('baseball', 'g2');
    await gov.settle(probe, 'quota_exhausted', 0);
    at('2026-10-31T00:06:00Z');
    await expect(live('baseball', 'g3')).rejects.toBeInstanceOf(QuotaExceededError);
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

  it('sent_at no futuro (relógio de outro processo adiantado): cada espera fica no espaçamento', async () => {
    const policy = () => defaultPolicy(100, 15, 10);
    // B tem o relógio 30 s adiantado
    const b = new PgQuotaGovernor(db, policy, () => new Date('2026-11-01T12:00:30Z'));
    await b.acquire({ api: 'rugby', priority: 'DAILY', endpoint: '/games', requestHash: 'skew-1' });
    let tA = Date.parse('2026-11-01T12:00:00Z');
    const waits: number[] = [];
    const a = new PgQuotaGovernor(
      db,
      policy,
      () => new Date(tA),
      async (ms) => {
        waits.push(ms);
        tA += ms;
      },
    );
    await a.acquire({ api: 'rugby', priority: 'DAILY', endpoint: '/games', requestHash: 'skew-2' });
    expect(Math.max(...waits)).toBeLessThanOrEqual(6000);
    // a espera total acompanha o adiantamento: A só reserva 6 s depois do sent_at de B
    expect(tA).toBeGreaterThanOrEqual(Date.parse('2026-11-01T12:00:36Z'));
  });

  it('pedido idêntico em voo é recusado na hora, sem esperar a vaga do minuto', async () => {
    const policy = () => defaultPolicy(100, 15, 10);
    const clock = () => new Date('2026-11-02T12:00:00Z');
    const req = { api: 'formula-1', priority: 'DAILY', endpoint: '/races', requestHash: 'dup' } as const;
    await new PgQuotaGovernor(db, policy, clock).acquire(req);
    const waits: number[] = [];
    const second = new PgQuotaGovernor(db, policy, clock, async (ms) => {
      waits.push(ms);
    });
    await expect(second.acquire(req)).rejects.toBeInstanceOf(RequestInFlightError);
    expect(waits).toEqual([]);
  });
});

describe('conta compartilhada entre dev e produção', () => {
  function governorAt(start: string, policy = () => defaultPolicy(75_000, 25)) {
    let t = Date.parse(start);
    const waits: number[] = [];
    const make = () =>
      new PgQuotaGovernor(
        db,
        policy,
        () => new Date(t),
        async (ms) => {
          waits.push(ms);
          t += ms;
        },
      );
    return {
      make,
      waits,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }
  const snapshotOf = async (api: string, day: string) =>
    (
      await db
        .select()
        .from(quotaSnapshot)
        .where(and(eq(quotaSnapshot.api, api), eq(quotaSnapshot.dayUtc, day)))
    )[0];

  it('o header de cota de cada resposta vira piso em ops.quota_snapshot, sem apagar o plano do /status', async () => {
    const { make, advance } = governorAt('2026-11-02T12:00:00Z');
    const gov = make();
    await gov.reconcile('football', 30_000, 75_000, 'Ultra');
    advance(1000);
    const t1 = await gov.acquire({
      api: 'football',
      priority: 'DAILY',
      endpoint: '/fixtures',
      requestHash: 'h1',
    });
    advance(1000);
    // headers reais: a outra ponta gastou 27.000 desde o /status
    await gov.settle(t1, 'ok', 18_000, 75_000);
    expect(await snapshotOf('football', '2026-11-02')).toMatchObject({ providerUsed: 57_000, plan: 'Ultra' });
    await expect(
      gov.acquire({ api: 'football', priority: 'DAILY', endpoint: '/fixtures', requestHash: 'h2' }),
    ).rejects.toThrow(/reserva do ao vivo/);
    const live = await gov.acquire({
      api: 'football',
      priority: 'LIVE',
      endpoint: '/fixtures',
      requestHash: 'h3',
    });

    // a gravação é espaçada por processo: um header de 1 s depois não disputa o lock de novo
    advance(1000);
    await gov.settle(live, 'ok', 10_000, 75_000);
    expect((await snapshotOf('football', '2026-11-02'))!.providerUsed).toBe(57_000);

    // a conciliação horária segue valendo: a leitura atrasada do /status não baixa o piso
    advance(60_000);
    await gov.reconcile('football', 50_000, 75_000, 'Ultra');
    expect((await gov.usage('football', '2026-11-02')).providerUsed).toBe(57_001);
  });

  it('um 429 pausa a API para os outros processos do mesmo banco, com volta automática', async () => {
    const { make, waits, advance } = governorAt('2026-11-03T12:00:00Z', () => defaultPolicy(100));
    const [jobA, liveB] = [make(), make()];
    const ticket = await jobA.acquire({
      api: 'nba',
      priority: 'BOOTSTRAP',
      endpoint: '/players',
      requestHash: 'a',
    });
    // o 429 demorou 20 s para voltar: a pausa conta da chegada da resposta, não do envio
    advance(20_000);
    await jobA.settle(ticket, 'rate_limited');
    advance(5_000);
    expect((await liveB.usage('nba', '2026-11-03')).pausedUntil).toBe('2026-11-03T12:00:50.000Z');
    await liveB.acquire({ api: 'nba', priority: 'LIVE', endpoint: '/games', requestHash: 'b' });
    expect(waits).toEqual([25_000]);
    // outra API não espera
    await liveB.acquire({ api: 'rugby', priority: 'LIVE', endpoint: '/games', requestHash: 'c' });
    expect(waits).toEqual([25_000]);
  });
});

describe('PgRawStore: dedupe pelo hash do corpo', () => {
  const base = {
    provider: 'api-sports',
    sport: 'handball',
    apiVersion: 'v1',
    endpoint: '/games',
    params: { live: 'all' },
    requestHash: 'dedupe-h1',
    page: 1,
    statusCode: 200,
    results: 1,
    errors: [],
    quotaRemaining: 900,
    jobId: 'job-run:x',
  };
  const at = (min: number) => new Date(Date.UTC(2026, 9, 21, 15, min));
  const rows = () =>
    db
      .select()
      .from(apiResponse)
      .where(eq(apiResponse.requestHash, 'dedupe-h1'))
      .orderBy(apiResponse.fetchedAt);

  it('corpo igual ao último da requisição só estende o "visto em"; corpo novo vira linha', async () => {
    const store = new PgRawStore(db);
    const scope = { provider: 'api-sports', sport: 'handball', endpoint: '/games' };
    const a = { ...base, body: { response: ['a'] }, bodyHash: 'ha', retention: 'live' as const };
    expect(await store.save({ ...a, fetchedAt: at(0) })).toBe('inserted');
    expect(await store.save({ ...a, fetchedAt: at(1), quotaRemaining: 899 })).toBe('seen');
    expect(await store.save({ ...a, fetchedAt: at(2), quotaRemaining: null })).toBe('seen');
    let r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ fetchedAt: at(0), lastSeenAt: at(2), seenCount: 3, quotaRemaining: 899 });
    expect(r[0]!.retention).toBe('live');

    // o frescor conta pelo "visto em": com TTL de 30 s, às 15:02:20 ainda é hit (chegou de novo às 15:02)
    const hit = await store.findFresh('dedupe-h1', 30_000, new Date(at(2).getTime() + 20_000), scope);
    expect(hit?.fetchedAt).toEqual(at(2));
    expect(
      await store.findFresh('dedupe-h1', 30_000, new Date(at(2).getTime() + 40_000), scope),
    ).toBeUndefined();

    // corpo diferente: linha nova; e A de novo depois de B também é linha nova (compara só com a última)
    expect(await store.save({ ...a, body: { response: ['b'] }, bodyHash: 'hb', fetchedAt: at(3) })).toBe(
      'inserted',
    );
    expect(await store.save({ ...a, fetchedAt: at(4) })).toBe('inserted');
    // mesmo corpo com outro status não é a mesma resposta
    expect(await store.save({ ...a, statusCode: 500, fetchedAt: at(5) })).toBe('inserted');
    r = await rows();
    expect(r.map((x) => [x.bodyHash, x.statusCode, x.seenCount])).toEqual([
      ['ha', 200, 3],
      ['hb', 200, 1],
      ['ha', 200, 1],
      ['ha', 500, 1],
    ]);
    // sem `retention`, a gravação é `keep`
    await store.save({ ...base, requestHash: 'dedupe-h2', body: {}, bodyHash: 'hk', fetchedAt: at(0) });
    const [k] = await db.select().from(apiResponse).where(eq(apiResponse.requestHash, 'dedupe-h2'));
    expect(k).toMatchObject({ retention: 'keep', seenCount: 1, lastSeenAt: null });
  });

  it('o cliente grava o que o ao vivo busca como live e o resto como keep', async () => {
    const body = JSON.stringify({
      get: 'games',
      parameters: [],
      errors: [],
      results: 0,
      paging: { current: 1, total: 1 },
      response: [],
    });
    const client = new ApiSportsClient({
      apiKey: 'k',
      store: new PgRawStore(db),
      governor: new PgQuotaGovernor(db, () => defaultPolicy(100), now),
      fetch: (async () => new Response(body)) as typeof globalThis.fetch,
      clock: { now: () => now().getTime(), sleep: async () => {} },
      rateLimiter: new RateLimiter(10),
    });
    await client.get({ sport: 'rugby', endpoint: '/games', params: { live: 'all' }, priority: 'LIVE' });
    await client.get({
      sport: 'rugby',
      endpoint: '/games',
      params: { date: '2026-10-21' },
      priority: 'DAILY',
    });
    const r = await db
      .select({ params: apiResponse.params, retention: apiResponse.retention })
      .from(apiResponse)
      .where(eq(apiResponse.sport, 'rugby'));
    expect(r.find((x) => 'live' in x.params)?.retention).toBe('live');
    expect(r.find((x) => 'date' in x.params)?.retention).toBe('keep');
  });
});
