/**
 * Prévia → aprovação → execução de verdade, de ponta a ponta no Postgres: o que o painel e a CLI fazem
 * (`@galaxie/db/queue-admin`) e o que o worker faz (`takeNext` + `runTask`).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jobRequest, jobRun, type Database } from '@galaxie/db';
import { enqueue, takeNext } from '@galaxie/db/queue';
import {
  approvePreview,
  awaitingApproval,
  cancelTask,
  getTask,
  listTasks,
  reprocessTask,
  requestTask,
  taskState,
  TaskError,
} from '@galaxie/db/queue-admin';
import {
  defineTaskType,
  EXEMPLO_ECO,
  readLog,
  readPreview,
  readProgress,
  type TaskTypeDef,
} from '@galaxie/db/queue-types';
import { exemploEco, runTask, type TaskHandler } from '../src/tasks/run.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;

const ECO = 'exemplo.eco';
const APAGA = defineTaskType({
  type: 'teste.apaga',
  descricao: 'Apaga (teste)',
  params: z.object({ alvo: z.string() }),
  previa: true,
  destrutiva: true,
}) as unknown as TaskTypeDef;
const registry = [EXEMPLO_ECO as unknown as TaskTypeDef, APAGA];
const apagou: string[] = [];
const handlers: Record<string, TaskHandler> = {
  [ECO]: exemploEco,
  'teste.apaga': async ({ params, previa, save }) => {
    if (previa) {
      await save({ previa: { contagens: { apagaria: 1 }, amostra: [params.alvo] } });
      return { detail: 'prévia pronta' };
    }
    apagou.push(String(params.alvo));
    return { detail: 'apagou' };
  },
};

/** O worker: toma a próxima e roda até o fim. */
async function work(types = [ECO, 'teste.apaga']) {
  const task = await takeNext(db, 'worker-teste', types);
  expect(task).not.toBeNull();
  return { task: task!, result: await runTask(db, task!, { handlers, registry }) };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof TaskError) return err.code;
    throw err;
  }
  return 'ok';
};

beforeAll(async () => {
  db = await disposable.setup();
});
afterAll(() => disposable.teardown());
beforeEach(async () => {
  apagou.length = 0;
  await db.delete(jobRequest);
  await db.delete(jobRun);
});

describe('prévia → aprovação → execução', () => {
  it('a prévia grava o plano, o admin aprova e a real roda com previaId', async () => {
    const { id: previewId, previa } = await requestTask(
      db,
      {
        type: ECO,
        params: { mensagem: ' olá ', repeticoes: 2 },
        previa: true,
        requestedBy: 'ana@galaxie.test',
      },
      registry,
    );
    expect(previa).toBe(true);

    // a prévia roda e não aprova sozinha
    const first = await work();
    expect(first.result).toBe('done');
    const preview = await getTask(db, previewId);
    expect(preview.params).toEqual({ mensagem: 'olá', repeticoes: 2, previa: true });
    expect(readPreview(preview.checkpoint)).toMatchObject({ contagens: { lotes: 2 }, amostra: ['olá'] });
    expect(awaitingApproval(preview)).toBe(true);
    expect(await listTasks(db, { status: ['pending'] })).toEqual([]);

    // aprovação: a real entra com os mesmos params e o previaId
    const { id: realId } = await approvePreview(db, previewId, 'bia@galaxie.test', registry);
    expect(await code(approvePreview(db, previewId, 'bia@galaxie.test', registry))).toBe('ja_aprovada');

    const second = await work();
    expect(second.task.id).toBe(realId);
    expect(second.result).toBe('done');
    const real = await getTask(db, realId);
    expect(real.params).toEqual({ mensagem: 'olá', repeticoes: 2, previaId: previewId });
    expect(real.requestedBy).toBe('bia@galaxie.test');
    expect(readProgress(real.checkpoint)).toEqual({ feitos: 2, total: 2, lote: 'lote 2' });
    expect(readLog(real.checkpoint)).toEqual(['lote 1/2: olá', 'lote 2/2: olá']);
    expect(real.runs.map((r) => r.status)).toEqual(['ok']);

    const after = await getTask(db, previewId);
    expect(after.approvals).toEqual([expect.objectContaining({ id: realId, status: 'done' })]);
  });

  it('duas aprovações ao mesmo tempo criam uma execução só', async () => {
    const { id } = await requestTask(db, {
      type: ECO,
      params: { mensagem: 'x' },
      previa: true,
      requestedBy: 'a',
    });
    await work();
    const results = await Promise.all([1, 2, 3].map(() => code(approvePreview(db, id, 'a'))));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'ja_aprovada')).toHaveLength(2);
    expect(await listTasks(db, { status: ['pending'] })).toHaveLength(1);
  });

  it('só aprova prévia concluída com plano', async () => {
    const { id: real } = await requestTask(db, { type: ECO, params: { mensagem: 'x' }, requestedBy: 'a' });
    expect(await code(approvePreview(db, real, 'a'))).toBe('nao_e_previa');
    const { id: pending } = await requestTask(db, {
      type: ECO,
      params: { mensagem: 'x' },
      previa: true,
      requestedBy: 'a',
    });
    expect(await code(approvePreview(db, pending, 'a'))).toBe('previa_nao_concluida');
    expect(await code(approvePreview(db, '019a0000-0000-7000-8000-000000000000', 'a'))).toBe(
      'nao_encontrada',
    );
    expect(await code(approvePreview(db, 'nem-uuid', 'a'))).toBe('nao_encontrada');
  });
});

describe('tipo destrutivo', () => {
  it('não entra sem prévia; a real só roda aprovada', async () => {
    expect(
      await code(
        requestTask(db, { type: 'teste.apaga', params: { alvo: 'BR' }, requestedBy: 'a' }, registry),
      ),
    ).toBe('previa_obrigatoria');
    const { id } = await requestTask(
      db,
      { type: 'teste.apaga', params: { alvo: 'BR' }, previa: true, requestedBy: 'a' },
      registry,
    );
    await work();
    expect(apagou).toEqual([]);
    await approvePreview(db, id, 'admin', registry);
    await work();
    expect(apagou).toEqual(['BR']);
  });

  it('o worker recusa a destrutiva que pulou a regra pelo enqueue direto', async () => {
    const { id } = await enqueue(db, { type: 'teste.apaga', params: { alvo: 'BR' } });
    const { result } = await work();
    expect(result).toBe('error');
    expect(apagou).toEqual([]);
    const task = await getTask(db, id);
    expect(task.status).toBe('error');
    expect(task.lastError).toMatch(/destrutiva/);
  });

  it('reprocessar a execução aprovada volta como prévia, para aprovar de novo', async () => {
    const { id } = await requestTask(
      db,
      { type: 'teste.apaga', params: { alvo: 'AR' }, previa: true, requestedBy: 'a' },
      registry,
    );
    await work();
    const { id: realId } = await approvePreview(db, id, 'admin', registry);
    await work();
    const again = await reprocessTask(db, realId, 'admin', registry);
    expect(again.previa).toBe(true);
    expect((await getTask(db, again.id)).params).toEqual({ alvo: 'AR', previa: true, reprocessaDe: realId });
  });
});

describe('cancelar e reprocessar', () => {
  it('cancela só a pendente', async () => {
    const { id } = await requestTask(db, { type: ECO, params: { mensagem: 'x' }, requestedBy: 'a' });
    await cancelTask(db, id, 'admin');
    const task = await getTask(db, id);
    expect(task).toMatchObject({ status: 'canceled', detail: 'cancelada por admin' });
    expect(taskState(task)).toBe('cancelada');
    expect(await code(cancelTask(db, id, 'admin'))).toBe('nao_pendente');
    expect(await takeNext(db, 'w', [ECO])).toBeNull();
  });

  it('reprocessa a encerrada com os mesmos params, ligada à original', async () => {
    const { id } = await requestTask(db, {
      type: ECO,
      params: { mensagem: 'x', repeticoes: 1 },
      priority: 5,
      requestedBy: 'a',
    });
    expect(await code(reprocessTask(db, id, 'b'))).toBe('nao_encerrada');
    await work();
    const { id: again, previa } = await reprocessTask(db, id, 'b');
    expect(previa).toBe(false);
    const task = await getTask(db, again);
    expect(task).toMatchObject({
      params: { mensagem: 'x', repeticoes: 1, reprocessaDe: id },
      priority: 5,
      requestedBy: 'b',
      status: 'pending',
    });
    expect((await getTask(db, id)).reprocesses).toEqual([expect.objectContaining({ id: again })]);
  });

  it('a retomada continua do último lote gravado', async () => {
    const { id } = await requestTask(db, {
      type: ECO,
      params: { mensagem: 'x', repeticoes: 3 },
      requestedBy: 'a',
    });
    // a primeira tomada gravou 2 lotes e caiu (a concessão venceu)
    const first = await takeNext(db, 'w1', [ECO], { leaseMs: 1 });
    await db
      .update(jobRequest)
      .set({ checkpoint: { progresso: { feitos: 2, total: 3 }, log: ['lote 1/3: x', 'lote 2/3: x'] } })
      .where(eq(jobRequest.id, id));
    expect(first!.id).toBe(id);
    await new Promise((r) => setTimeout(r, 20));
    const { task, result } = await work([ECO]);
    expect(task.resumedFrom).toBe(first!.runId);
    expect(result).toBe('done');
    const done = await getTask(db, id);
    expect(readLog(done.checkpoint)).toEqual(['lote 1/3: x', 'lote 2/3: x', 'lote 3/3: x']);
    expect(done.runs.map((r) => [r.status, Boolean(r.resumedFrom)])).toEqual([
      ['interrupted', false],
      ['ok', true],
    ]);
  });
});
