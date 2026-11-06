/** Retenção do raw e das tabelas de operação (job `data-retention`) e compactação do histórico do raw. */
import { randomBytes } from 'node:crypto';
import { asc } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiResponse,
  applyRoles,
  closeDb,
  createDb,
  jobRequest,
  jobRun,
  llmUsage,
  llmUsageDaily,
  normalizeFailure,
  quotaLedger,
  roleName,
  tenant,
  webhookDelivery,
  webhookEndpoint,
  type Database,
} from '@galaxie/db';
import { compactRawHistory, pruneRawLive } from '../src/ops/raw-retention.js';
import { pruneOpsTables } from '../src/ops/ops-retention.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const NOW = new Date('2026-12-01T12:00:00Z');
const daysAgo = (d: number, min = 0) => new Date(NOW.getTime() - d * 86_400_000 + min * 60_000);

let seq = 0;
async function raw(
  requestHash: string,
  fetchedAt: Date,
  opts: {
    body?: string;
    status?: number;
    retention?: 'live' | 'keep';
    lastSeenAt?: Date;
    jobId?: string;
    errors?: unknown;
  } = {},
): Promise<number> {
  const body = opts.body ?? 'a';
  const [row] = await db
    .insert(apiResponse)
    .values({
      sport: 'football',
      apiVersion: 'v3',
      endpoint: '/fixtures',
      params: { n: seq++ },
      requestHash,
      statusCode: opts.status ?? 200,
      errors: opts.errors ?? [],
      body: { response: [body] },
      bodyHash: `h-${body}`,
      fetchedAt,
      lastSeenAt: opts.lastSeenAt ?? null,
      retention: opts.retention ?? 'keep',
      jobId: opts.jobId ?? null,
    })
    .returning({ id: apiResponse.id });
  return row!.id;
}

const rawIds = async () =>
  (await db.select({ id: apiResponse.id }).from(apiResponse).orderBy(asc(apiResponse.id))).map((r) => r.id);

beforeAll(async () => {
  db = await disposable.setup();
});

const rolePrefix = `t${randomBytes(4).toString('hex')}_`;

afterAll(async () => {
  await disposable.teardown();
  // os papéis são do cluster: saem depois do banco descartável (o único onde têm GRANTs)
  const cluster = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const roles = await cluster<
      { rolname: string }[]
    >`select rolname from pg_roles where rolname like ${`${rolePrefix}%`}`;
    for (const r of roles) await cluster.unsafe(`drop role if exists "${r.rolname}"`);
  } finally {
    await cluster.end({ timeout: 5 });
  }
});

describe('pruneRawLive', () => {
  beforeEach(async () => {
    await db.delete(apiResponse);
  });

  it('apaga o ao vivo com mais de 30 dias, mas a última resposta de sucesso de cada requisição fica', async () => {
    const l1 = await raw('live-all', daysAgo(40), { retention: 'live', body: 'x' });
    const l2 = await raw('live-all', daysAgo(35), { retention: 'live', body: 'y' });
    const l3 = await raw('live-all', daysAgo(31), { retention: 'live', body: 'z' }); // a última: fica
    // detalhe confirmado pelo ao vivo, velho: só ele na requisição, fica
    const d1 = await raw('fixture-9', daysAgo(60), { retention: 'live' });
    // visto de novo há 10 dias: conta pelo "visto em", fica
    const s1 = await raw('seen', daysAgo(50), { retention: 'live', lastSeenAt: daysAgo(10) });
    await raw('seen', daysAgo(5), { retention: 'live', body: 'b' });
    // erro velho do ao vivo: sai mesmo sendo o último
    const e1 = await raw('erro', daysAgo(45), { retention: 'live', status: 500 });
    // keep velho com sucesso mais novo: fica para sempre
    const k1 = await raw('daily', daysAgo(400));
    const k2 = await raw('daily', daysAgo(300), { body: 'b' });

    const plan = await pruneRawLive(db, { now: NOW, dryRun: true });
    expect(plan.deleted).toBe(3);
    expect(plan.bodyBytes).toBeGreaterThan(0);
    expect(await rawIds()).toHaveLength(9);

    const done = await pruneRawLive(db, { now: NOW, batchSize: 1, pauseMs: 0 });
    expect(done.deleted).toBe(3);
    const left = await rawIds();
    expect(left).not.toContain(l1);
    expect(left).not.toContain(l2);
    expect(left).not.toContain(e1);
    expect(left).toEqual(expect.arrayContaining([l3, d1, s1, k1, k2]));
    // idempotente
    expect((await pruneRawLive(db, { now: NOW, pauseMs: 0 })).deleted).toBe(0);
  });

  it('recusa retenção menor que 1 dia', async () => {
    await expect(pruneRawLive(db, { retentionDays: 0 })).rejects.toThrow('≥ 1 dia');
  });
});

describe('compactRawHistory', () => {
  beforeEach(async () => {
    await db.delete(apiResponse);
    await db.delete(jobRun);
  });

  it('classifica o que veio do ao vivo e junta respostas repetidas em sequência, sem perder o "visto em"', async () => {
    const [live] = await db.insert(jobRun).values({ job: 'live:run', status: 'ok' }).returning();
    const [daily] = await db.insert(jobRun).values({ job: 'sync:daily', status: 'ok' }).returning();
    const jl = `job-run:${live!.id}`;
    const jd = `job-run:${daily!.id}`;
    // A A A B B A: viram A(3) B(2) A(1)
    const a1 = await raw('r1', daysAgo(10, 0), { jobId: jl });
    await raw('r1', daysAgo(10, 1), { jobId: jl });
    await raw('r1', daysAgo(10, 2), { jobId: jl });
    const b1 = await raw('r1', daysAgo(10, 4), { jobId: jl, body: 'b' });
    await raw('r1', daysAgo(10, 5), { jobId: jl, body: 'b' });
    const a2 = await raw('r1', daysAgo(10, 6), { jobId: jl });
    // mesmo corpo com status diferente não junta
    const c1 = await raw('r2', daysAgo(9), { jobId: jd });
    const c2 = await raw('r2', daysAgo(8), { jobId: jd, status: 500 });
    // o ao vivo buscou primeiro e o sync diário repetiu o corpo: a sequência fica permanente
    const m1 = await raw('r3', daysAgo(7), { jobId: jl });
    await raw('r3', daysAgo(6), { jobId: jd });

    const plan = await compactRawHistory(db, { dryRun: true });
    expect(plan).toMatchObject({ classified: 7, merged: 4, dryRun: true });
    expect(await rawIds()).toHaveLength(10);

    const done = await compactRawHistory(db, { batchRequests: 1, classifyBatch: 2, pauseMs: 0 });
    expect(done).toMatchObject({ classified: 7, merged: 4 });
    expect(await rawIds()).toEqual([a1, b1, a2, c1, c2, m1]);
    const rows = await db.select().from(apiResponse).orderBy(asc(apiResponse.id));
    expect(rows.find((r) => r.id === a1)).toMatchObject({
      seenCount: 3,
      lastSeenAt: daysAgo(10, 2),
      retention: 'live',
    });
    expect(rows.find((r) => r.id === b1)).toMatchObject({ seenCount: 2, lastSeenAt: daysAgo(10, 5) });
    expect(rows.find((r) => r.id === a2)).toMatchObject({ seenCount: 1, lastSeenAt: null });
    expect(rows.find((r) => r.id === c1)!.retention).toBe('keep');
    expect(rows.find((r) => r.id === m1)).toMatchObject({ retention: 'keep', seenCount: 2 });

    // idempotente
    expect(await compactRawHistory(db, { pauseMs: 0 })).toMatchObject({ classified: 0, merged: 0 });
  });
});

describe('pruneOpsTables', () => {
  it('agrega o ledger de IA por dia antes de apagar o detalhe, e poda cada tabela pela sua regra', async () => {
    await db.delete(jobRun);
    const llm = (
      day: string,
      agent: string,
      cost: string,
      extra: Partial<typeof llmUsage.$inferInsert> = {},
    ) => ({
      dayUtc: day,
      agent,
      purpose: `${agent}:x`,
      provider: 'gemini',
      model: 'm',
      tier: 'fast',
      inputTokens: 10,
      outputTokens: 5,
      webSearches: 1,
      costUsd: cost,
      outcome: 'ok',
      ...extra,
    });
    await db.insert(llmUsage).values([
      llm('2026-08-01', 'wtw', '0.010000'),
      llm('2026-08-01', 'wtw', '0.020000', { budgetDay: '2026-07-31', band: 'p0' }),
      llm('2026-08-01', 'context', '0.005000'),
      llm('2026-08-02', 'wtw', '0.001000'),
      llm('2026-11-30', 'wtw', '0.500000'), // recente: fica
    ]);
    // pré-agregado parcial de uma execução interrompida: é substituído, não somado
    await db.insert(llmUsageDaily).values({
      dayUtc: '2026-08-01',
      budgetDay: '2026-08-01',
      agent: 'wtw',
      provider: 'gemini',
      model: 'm',
      tier: 'fast',
      outcome: 'ok',
      calls: 99,
      inputTokens: 0,
      outputTokens: 0,
      webSearches: 0,
    });

    const [jOld] = await db
      .insert(jobRun)
      .values([
        { job: 'events-clock', status: 'ok', startedAt: daysAgo(200) },
        { job: 'events-clock', status: 'ok', startedAt: daysAgo(150) },
        { job: 'events-clock', status: 'error', startedAt: daysAgo(100) },
        { job: 'events-clock', status: 'ok', startedAt: daysAgo(1) },
        // job que só falha há meses: a última execução e o último sucesso ficam
        { job: 'old-job', status: 'ok', startedAt: daysAgo(300) },
        { job: 'old-job', status: 'error', startedAt: daysAgo(250) },
        { job: 'old-job', status: 'error', startedAt: daysAgo(200) },
      ])
      .returning();
    await db.insert(quotaLedger).values([
      {
        api: 'football',
        dayUtc: '2026-08-01',
        priority: 'LIVE',
        endpoint: '/fixtures',
        requestHash: 'q',
        outcome: 'ok',
      },
      {
        api: 'football',
        dayUtc: '2026-11-30',
        priority: 'LIVE',
        endpoint: '/fixtures',
        requestHash: 'q',
        outcome: 'ok',
      },
    ]);
    await db.insert(jobRequest).values([
      { job: 'x', requestedBy: 'a', status: 'done', finishedAt: daysAgo(40) },
      { job: 'x', requestedBy: 'a', status: 'pending', requestedAt: daysAgo(40) },
      { job: 'x', requestedBy: 'a', status: 'done', finishedAt: daysAgo(5) },
    ]);
    // fila de tarefas: velhas e vivas ficam (pendente, em backoff, concessão viva, concessão vencida à espera de
    // quem retome); encerrada há mais de 30 dias sai, com o checkpoint
    const task = (status: string, extra: Partial<typeof jobRequest.$inferInsert> = {}) => ({
      job: 'fila:acervo',
      type: 'acervo',
      requestedBy: 'a',
      requestedAt: daysAgo(40),
      status,
      checkpoint: { feitos: 1 },
      ...extra,
    });
    await db
      .insert(jobRequest)
      .values([
        task('pending', { runAfter: daysAgo(40) }),
        task('pending', { runAfter: new Date(NOW.getTime() + 60_000), attempts: 2, lastError: 'backoff' }),
        task('running', { lockedBy: 'w', lockedUntil: new Date(NOW.getTime() + 60_000) }),
        task('running', { lockedBy: 'morto', lockedUntil: daysAgo(35) }),
        task('done', { finishedAt: daysAgo(31) }),
        task('error', { finishedAt: daysAgo(31), lastError: 'esgotou' }),
        task('done', { finishedAt: daysAgo(5) }),
      ]);
    await db.insert(normalizeFailure).values([
      { provider: 'api-sports', sport: 'football', rawId: 1, endpoint: '/f', resolvedAt: daysAgo(100) },
      { provider: 'api-sports', sport: 'football', rawId: 2, endpoint: '/f', lastFailedAt: daysAgo(100) },
    ]);

    const plan = await pruneOpsTables(db, { now: NOW, dryRun: true });
    const byKey = (r: typeof plan) => Object.fromEntries(r.rows.map((x) => [x.key, x.deleted]));
    expect(byKey(plan)).toMatchObject({
      llmUsage: 4,
      jobRun: 4,
      quotaLedger: 1,
      jobRequest: 3,
      normalizeFailure: 1,
      webhookDelivered: 0,
      webhookDead: 0,
    });

    const done = await pruneOpsTables(db, { now: NOW, batchSize: 1, pauseMs: 0 });
    expect(byKey(done)).toEqual(byKey(plan));
    expect(done.llmDaysAggregated).toBe(2);

    const daily = await db
      .select()
      .from(llmUsageDaily)
      .orderBy(llmUsageDaily.dayUtc, llmUsageDaily.agent, llmUsageDaily.budgetDay);
    expect(
      daily.map((d) => [d.dayUtc, d.budgetDay, d.band, d.agent, d.calls, Number(d.costUsd), d.inputTokens]),
    ).toEqual([
      ['2026-08-01', '2026-08-01', '', 'context', 1, 0.005, 10],
      ['2026-08-01', '2026-07-31', 'p0', 'wtw', 1, 0.02, 10],
      ['2026-08-01', '2026-08-01', '', 'wtw', 1, 0.01, 10],
      ['2026-08-02', '2026-08-02', '', 'wtw', 1, 0.001, 10],
    ]);
    expect((await db.select().from(llmUsage)).map((r) => r.dayUtc)).toEqual(['2026-11-30']);

    const runs = await db.select().from(jobRun).orderBy(jobRun.job, jobRun.startedAt);
    expect(runs.map((r) => [r.job, r.status])).toEqual([
      ['events-clock', 'ok'],
      ['old-job', 'ok'],
      ['old-job', 'error'],
    ]);
    expect(runs.some((r) => r.id === jOld!.id)).toBe(false);
    expect((await db.select().from(quotaLedger)).map((q) => q.dayUtc)).toEqual(['2026-11-30']);
    expect((await db.select().from(jobRequest)).map((r) => r.status).sort()).toEqual(
      ['done', 'pending', 'done', 'pending', 'pending', 'running', 'running'].sort(),
    );
    expect((await db.select().from(normalizeFailure)).map((r) => r.rawId)).toEqual([2]);

    // idempotente
    const again = await pruneOpsTables(db, { now: NOW, pauseMs: 0 });
    expect(again.rows.every((r) => r.deleted === 0)).toBe(true);
    expect(await db.select().from(llmUsageDaily)).toHaveLength(4);
  });
});

describe('data-retention com o papel do ingestor', () => {
  // O job roda no scheduler do ingestor com o papel galaxie_ingestor: toda tabela que a retenção poda precisa estar
  // na matriz de roles.ts (write ou prune), senão o job inteiro para em 42501 (como em 04/11 com a webhook_delivery).
  it('poda raw, ops e as entregas de webhook sem erro de permissão', async () => {
    const password = randomBytes(18).toString('hex');
    await applyRoles(disposable.url, { prefix: rolePrefix, passwords: { ingestor: password } });
    const url = new URL(disposable.url);
    url.username = roleName('ingestor', rolePrefix);
    url.password = password;
    const ingDb = createDb(url.toString(), { max: 2 });

    // uma linha velha em cada caminho que só apaga quando há o que apagar (o ledger de IA, por dia)
    await db.insert(llmUsage).values({
      dayUtc: '2026-08-01',
      agent: 'wtw',
      purpose: 'wtw:x',
      provider: 'gemini',
      model: 'm',
      tier: 'fast',
      costUsd: '0.010000',
      outcome: 'ok',
    });
    const [t] = await db
      .insert(tenant)
      .values({ slug: 'retencao-papel', name: 'Teste', plan: 'core_data', modules: ['core_data'] })
      .returning({ id: tenant.id });
    const [ep] = await db
      .insert(webhookEndpoint)
      .values({ tenantId: t!.id, url: 'https://exemplo.test/hook', secret: 'segredo' })
      .returning({ id: webhookEndpoint.id });
    await db.insert(webhookDelivery).values([
      {
        endpointId: ep!.id,
        changeId: 1,
        topic: 'event.updated',
        payload: {},
        status: 'delivered',
        deliveredAt: daysAgo(40),
        createdAt: daysAgo(40),
      },
      {
        endpointId: ep!.id,
        changeId: 2,
        topic: 'event.updated',
        payload: {},
        status: 'dead',
        lastAttemptAt: daysAgo(100),
        createdAt: daysAgo(100),
      },
      { endpointId: ep!.id, changeId: 3, topic: 'event.updated', payload: {}, status: 'pending' },
    ]);
    await raw('papel-live', daysAgo(40), { retention: 'live', body: 'p1' });
    await raw('papel-live', daysAgo(35), { retention: 'live', body: 'p2' });

    try {
      const rawReport = await pruneRawLive(ingDb, { retentionDays: 30, now: NOW });
      expect(rawReport.deleted).toBeGreaterThan(0);
      const ops = await pruneOpsTables(ingDb, { now: NOW, pauseMs: 0 });
      const byKey = Object.fromEntries(ops.rows.map((r) => [r.key, r.deleted]));
      expect(byKey).toMatchObject({ llmUsage: 1, webhookDelivered: 1, webhookDead: 1 });
      expect((await db.select().from(webhookDelivery)).map((d) => d.status)).toEqual(['pending']);
    } finally {
      await closeDb(ingDb);
    }
  });
});
