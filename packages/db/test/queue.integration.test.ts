import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimJobRequests,
  closeDb,
  createDb,
  jobRequest,
  jobRun,
  runMigrations,
  type Database,
} from '../src/index.js';
import {
  QUEUE_JOB_PREFIX,
  checkpoint,
  enqueue,
  finish,
  queueBackoffMs,
  release,
  renew,
  takeNext,
} from '../src/queue.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
// dois pools, como dois contêineres de worker
let workerA: Database;
let workerB: Database;

const TYPE = 'acervo';

const request = async (id: string) =>
  (await workerA.select().from(jobRequest).where(eq(jobRequest.id, id)))[0]!;
const run = async (id: string) => (await workerA.select().from(jobRun).where(eq(jobRun.id, id)))[0]!;
const expireLease = (id: string) =>
  workerA.execute(
    sql`update ops.job_request set locked_until = now() - interval '1 second' where id = ${id}`,
  );
const skipBackoff = (id: string) =>
  workerA.execute(sql`update ops.job_request set run_after = now() - interval '1 second' where id = ${id}`);

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  workerA = createDb(testUrl, { max: 8 });
  workerB = createDb(testUrl, { max: 8 });
});

afterAll(async () => {
  if (workerA) await closeDb(workerA);
  if (workerB) await closeDb(workerB);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await workerA.delete(jobRequest);
  await workerA.delete(jobRun);
});

describe('dois workers, uma tarefa', () => {
  it('o primeiro morre sem renovar; o segundo pega depois do prazo e retoma do checkpoint', async () => {
    const { id } = await enqueue(workerA, { type: TYPE, params: { pais: 'BR' } });

    const first = await takeNext(workerA, 'worker-a', [TYPE], { leaseMs: 600 });
    expect(first).toMatchObject({
      id,
      type: TYPE,
      params: { pais: 'BR' },
      attempts: 1,
      checkpoint: null,
      resumedFrom: null,
      workerId: 'worker-a',
    });
    expect(await checkpoint(workerA, first!, { feitos: 42 })).toBe(true);

    // dentro do prazo, ninguém mais pega
    expect(await takeNext(workerB, 'worker-b', [TYPE])).toBeNull();

    // worker-a morreu: não renova; o prazo vence no relógio do banco
    await sleep(800);
    const second = await takeNext(workerB, 'worker-b', [TYPE]);
    expect(second).toMatchObject({
      id,
      attempts: 2,
      checkpoint: { feitos: 42 },
      resumedFrom: first!.runId,
      workerId: 'worker-b',
    });

    // a execução do primeiro aparece como interrompida (retomada), não como falha
    expect(await run(first!.runId)).toMatchObject({
      status: 'interrupted',
      error: null,
      requestId: id,
      stats: { worker: 'worker-a', interrupted: true },
    });
    expect((await run(first!.runId)).finishedAt).not.toBeNull();
    expect(await run(second!.runId)).toMatchObject({
      job: TYPE,
      status: 'running',
      requestId: id,
      resumedFrom: first!.runId,
    });

    expect(
      await finish(workerB, second!, 'ok', 'importou tudo', { callsSpent: 7, stats: { feitos: 100 } }),
    ).toBe('done');
    const closed = await request(id);
    expect(closed).toMatchObject({
      status: 'done',
      detail: 'importou tudo',
      lockedBy: null,
      lockedUntil: null,
      runId: second!.runId,
      checkpoint: { feitos: 42 },
    });
    expect(closed.finishedAt).not.toBeNull();
    expect(await run(second!.runId)).toMatchObject({
      status: 'ok',
      callsSpent: 7,
      stats: { worker: 'worker-b', feitos: 100 },
    });
  });

  it('o worker que voltou depois de perder a concessão não mexe mais na tarefa', async () => {
    const { id } = await enqueue(workerA, { type: TYPE });
    const stale = await takeNext(workerA, 'worker-a', [TYPE]);
    await expireLease(id);
    const current = await takeNext(workerB, 'worker-b', [TYPE]);
    await checkpoint(workerB, current!, { feitos: 1 });

    expect(await renew(workerA, stale!)).toBe(false);
    expect(await checkpoint(workerA, stale!, { feitos: 999 })).toBe(false);
    expect(await finish(workerA, stale!, 'error', 'atrasado')).toBeNull();
    expect(await release(workerA, stale!)).toBe(false);

    expect(await request(id)).toMatchObject({
      status: 'running',
      lockedBy: 'worker-b',
      checkpoint: { feitos: 1 },
      runId: current!.runId,
      lastError: null,
    });
    expect((await run(stale!.runId)).status).toBe('interrupted');
  });

  it('o mesmo worker que retoma não confunde a tomada velha com a nova', async () => {
    const { id } = await enqueue(workerA, { type: TYPE });
    const stale = await takeNext(workerA, 'worker-a', [TYPE]);
    await expireLease(id);
    const current = await takeNext(workerA, 'worker-a', [TYPE]);
    expect(await renew(workerA, stale!)).toBe(false);
    expect(await renew(workerA, current!)).toBe(true);
  });

  it('renovar empurra o prazo: quem renova não perde a tarefa', async () => {
    const { id } = await enqueue(workerA, { type: TYPE });
    const task = await takeNext(workerA, 'worker-a', [TYPE], { leaseMs: 800 });
    for (let i = 0; i < 3; i++) {
      await sleep(400);
      expect(await renew(workerA, task!, { leaseMs: 800 })).toBe(true);
      expect(await takeNext(workerB, 'worker-b', [TYPE])).toBeNull();
    }
    expect((await request(id)).lockedBy).toBe('worker-a');
  });
});

describe('concorrência', () => {
  it('100 tomadas concorrentes de 100 tarefas: cada uma sai uma vez só', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add((await enqueue(workerA, { type: TYPE, params: { i } })).id);

    const taken = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        i % 2 ? takeNext(workerA, `a-${i}`, [TYPE]) : takeNext(workerB, `b-${i}`, [TYPE]),
      ),
    );

    expect(taken.every(Boolean)).toBe(true);
    expect(new Set(taken.map((t) => t!.id))).toEqual(ids);
    expect(new Set(taken.map((t) => t!.runId)).size).toBe(100);
    const runs = await workerA.select().from(jobRun);
    expect(runs).toHaveLength(100);
    expect(new Set(runs.map((r) => r.requestId))).toEqual(ids);
    expect(await takeNext(workerA, 'a-final', [TYPE])).toBeNull();
  });

  it('100 tomadas concorrentes de uma tarefa: um worker só leva', async () => {
    await enqueue(workerA, { type: TYPE });
    const taken = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        i % 2 ? takeNext(workerA, `a-${i}`, [TYPE]) : takeNext(workerB, `b-${i}`, [TYPE]),
      ),
    );
    expect(taken.filter(Boolean)).toHaveLength(1);
    expect(await workerA.select().from(jobRun)).toHaveLength(1);
  });

  it('concessão vencida disputada por vários: um só retoma, com uma execução só', async () => {
    const { id } = await enqueue(workerA, { type: TYPE });
    await takeNext(workerA, 'morto', [TYPE]);
    await expireLease(id);
    const taken = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 ? takeNext(workerA, `a-${i}`, [TYPE]) : takeNext(workerB, `b-${i}`, [TYPE]),
      ),
    );
    expect(taken.filter(Boolean)).toHaveLength(1);
    const runs = await workerA.select().from(jobRun);
    expect(runs.map((r) => r.status).sort()).toEqual(['interrupted', 'running']);
  });
});

describe('tentativas', () => {
  it('erro espera o backoff, mantém o checkpoint e esgota em max_attempts', async () => {
    const { id } = await enqueue(workerA, { type: TYPE, maxAttempts: 2 });

    const first = await takeNext(workerA, 'w', [TYPE]);
    await checkpoint(workerA, first!, { feitos: 5 });
    expect(await finish(workerA, first!, 'error', 'rede caiu')).toBe('retry');
    const waiting = await request(id);
    expect(waiting).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'rede caiu',
      lockedBy: null,
      lockedUntil: null,
      finishedAt: null,
      checkpoint: { feitos: 5 },
    });
    const wait = waiting.runAfter!.getTime() - Date.now();
    expect(wait).toBeGreaterThan(queueBackoffMs(1) - 5_000);
    expect(wait).toBeLessThanOrEqual(queueBackoffMs(1) + 1_000);
    expect(await run(first!.runId)).toMatchObject({ status: 'error', error: 'rede caiu' });

    // dentro do backoff, ninguém pega
    expect(await takeNext(workerA, 'w', [TYPE])).toBeNull();
    await skipBackoff(id);

    // nova tentativa depois de um erro recebe o checkpoint, mas não é retomada: a anterior falhou
    const second = await takeNext(workerA, 'w', [TYPE]);
    expect(second).toMatchObject({ attempts: 2, checkpoint: { feitos: 5 }, resumedFrom: null });

    expect(await finish(workerA, second!, 'error', 'rede caiu de novo')).toBe('error');
    const closed = await request(id);
    expect(closed).toMatchObject({ status: 'error', attempts: 2, lastError: 'rede caiu de novo' });
    expect(closed.finishedAt).not.toBeNull();
    await skipBackoff(id);
    expect(await takeNext(workerA, 'w', [TYPE])).toBeNull();
  });

  it('o worker que cai sempre na mesma tarefa esgota as tentativas: ela encerra em erro, sem ninguém pegar', async () => {
    const { id } = await enqueue(workerA, { type: TYPE, maxAttempts: 2 });
    await takeNext(workerA, 'w1', [TYPE]);
    await expireLease(id);
    const last = await takeNext(workerA, 'w2', [TYPE]);
    expect(last).toMatchObject({ attempts: 2 });
    await expireLease(id);

    expect(await takeNext(workerA, 'w3', [TYPE])).toBeNull();
    const closed = await request(id);
    expect(closed).toMatchObject({ status: 'error', lockedBy: null, attempts: 2 });
    expect(closed.lastError).toMatch(/concessão vencida/);
    expect(closed.finishedAt).not.toBeNull();
    expect(await run(last!.runId)).toMatchObject({ status: 'error', stats: { interrupted: true } });
  });

  it('o backoff dobra e tem teto', () => {
    expect([1, 2, 3, 4].map(queueBackoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(queueBackoffMs(50)).toBe(3_600_000);
  });
});

describe('release no SIGTERM', () => {
  it('volta para pendente com o checkpoint, devolve a tentativa e a próxima tomada retoma na hora', async () => {
    const { id } = await enqueue(workerA, { type: TYPE, maxAttempts: 1 });
    const task = await takeNext(workerA, 'saindo', [TYPE]);
    await checkpoint(workerA, task!, { feitos: 9 });

    expect(await release(workerA, task!)).toBe(true);
    expect(await request(id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      lockedBy: null,
      lockedUntil: null,
      checkpoint: { feitos: 9 },
      finishedAt: null,
    });
    expect(await run(task!.runId)).toMatchObject({
      status: 'interrupted',
      error: null,
      stats: { interrupted: true },
    });

    // deploy não gasta tentativa: mesmo com max_attempts 1, ela continua
    const next = await takeNext(workerB, 'chegando', [TYPE]);
    expect(next).toMatchObject({ attempts: 1, checkpoint: { feitos: 9 }, resumedFrom: task!.runId });
    expect(await finish(workerB, next!, 'ok')).toBe('done');
  });
});

describe('ordem e escolha', () => {
  it('maior prioridade primeiro, depois quem está pronto há mais tempo; futuro e outro tipo ficam', async () => {
    const low = await enqueue(workerA, {
      type: TYPE,
      params: 'baixa',
      runAfter: new Date(Date.now() - 60_000),
    });
    const high = await enqueue(workerA, { type: TYPE, params: 'alta', priority: 10 });
    const mid1 = await enqueue(workerA, {
      type: TYPE,
      priority: 5,
      runAfter: new Date(Date.now() - 2_000),
    });
    const mid2 = await enqueue(workerA, {
      type: TYPE,
      priority: 5,
      runAfter: new Date(Date.now() - 1_000),
    });
    const future = await enqueue(workerA, {
      type: TYPE,
      priority: 99,
      runAfter: new Date(Date.now() + 60_000),
    });
    const other = await enqueue(workerA, { type: 'outro', priority: 99 });

    const order: string[] = [];
    for (;;) {
      const task = await takeNext(workerA, 'w', [TYPE]);
      if (!task) break;
      order.push(task.id);
    }
    expect(order).toEqual([high.id, mid1.id, mid2.id, low.id]);
    expect(order).not.toContain(future.id);
    expect((await takeNext(workerA, 'w', ['outro']))?.id).toBe(other.id);
    expect(await takeNext(workerA, 'w', [])).toBeNull();
  });

  it('uma concessão vencida de outro tipo não é tocada', async () => {
    const { id } = await enqueue(workerA, { type: 'outro' });
    await takeNext(workerA, 'w', ['outro']);
    await expireLease(id);
    expect(await takeNext(workerB, 'w', [TYPE])).toBeNull();
    expect((await request(id)).status).toBe('running');
  });
});

describe('enqueue com dedupe_key', () => {
  it('enquanto a tarefa está viva não cria outra; encerrada, libera a chave', async () => {
    const first = await enqueue(workerA, { type: TYPE, dedupeKey: 'BR' });
    expect(first.created).toBe(true);
    expect(await enqueue(workerA, { type: TYPE, dedupeKey: 'BR' })).toEqual({ id: first.id, created: false });
    // outro tipo e outra chave são outras tarefas; sem chave, sempre cria
    expect((await enqueue(workerA, { type: 'outro', dedupeKey: 'BR' })).created).toBe(true);
    expect((await enqueue(workerA, { type: TYPE, dedupeKey: 'AR' })).created).toBe(true);
    expect((await enqueue(workerA, { type: TYPE })).created).toBe(true);
    expect((await enqueue(workerA, { type: TYPE })).created).toBe(true);

    let task = await takeNext(workerA, 'w', [TYPE]);
    while (task && task.id !== first.id) {
      await finish(workerA, task, 'ok');
      task = await takeNext(workerA, 'w', [TYPE]);
    }
    // em execução ainda conta como viva
    expect(await enqueue(workerA, { type: TYPE, dedupeKey: 'BR' })).toEqual({ id: first.id, created: false });
    await finish(workerA, task!, 'ok');

    const again = await enqueue(workerA, { type: TYPE, dedupeKey: 'BR' });
    expect(again.created).toBe(true);
    expect(again.id).not.toBe(first.id);
  });

  it('20 enfileiramentos simultâneos com a mesma chave criam uma tarefa só', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        enqueue(i % 2 ? workerA : workerB, { type: TYPE, dedupeKey: 'mesma' }),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });
});

describe('convivência com os pedidos de "rodar agora"', () => {
  it('o scheduler não pega nem expira tarefa da fila, mesmo com o nome de um job agendado', async () => {
    const task = await enqueue(workerA, { type: 'daily-sync' });
    const [manual] = await workerA
      .insert(jobRequest)
      .values({ job: 'daily-sync', requestedBy: 'admin' })
      .returning({ id: jobRequest.id });
    await workerA.execute(
      sql`update ops.job_request set requested_at = now() - interval '1 hour' where id = ${task.id}`,
    );

    const claimed = await claimJobRequests(workerA, ['daily-sync']);
    expect(claimed.map((c) => c.id)).toEqual([manual!.id]);
    expect(await request(task.id)).toMatchObject({
      status: 'pending',
      job: `${QUEUE_JOB_PREFIX}daily-sync`,
      type: 'daily-sync',
    });
  });

  it('a fila não pega pedido de "rodar agora" (sem type)', async () => {
    await workerA.insert(jobRequest).values({ job: TYPE, requestedBy: 'admin' });
    expect(await takeNext(workerA, 'w', [TYPE])).toBeNull();
  });

  it('o pedido de "rodar agora" continua nascendo sem as colunas da fila', async () => {
    const [row] = await workerA.insert(jobRequest).values({ job: 'x', requestedBy: 'a' }).returning();
    expect(row).toMatchObject({ type: null, priority: 0, attempts: 0, maxAttempts: 3, runAfter: null });
  });
});
