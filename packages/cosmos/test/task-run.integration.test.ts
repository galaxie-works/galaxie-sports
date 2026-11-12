import { randomBytes } from 'node:crypto';
import { ledger, reservation, staffUsage, tenant, type Database } from '@galaxie/db';
import type { CompletionClient, CompletionRequest } from '@galaxie/llm';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEntry,
  ensureWallet,
  getWallet,
  parseModelJson,
  runCosmosTask,
  TASK_LIMITS,
  upsertFunctionDef,
  type CosmosSettings,
  type TaskInput,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
// preço de teste, não o da tabela da Galaxie
const settings: CosmosSettings = { dailyUsdCeiling: null, creditUsd: 0.0001 };
const FN = 'widget.test';
const env = { COSMOS_ANTHROPIC_API_KEY: 'k' };

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
  await upsertFunctionDef(db, { name: FN, minCredits: 5, permission: 'settings.manage' });
});

afterAll(async () => {
  await temp?.close();
});

async function newTenant(credits = 1000): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data', 'cosmos_ai'] })
    .returning({ id: tenant.id });
  await ensureWallet(db, row!.id);
  if (credits > 0)
    await addEntry(db, {
      tenantId: row!.id,
      kind: 'purchase',
      credits,
      idempotencyKey: `k-${randomBytes(6).toString('hex')}`,
    });
  return row!.id;
}

/** Provedor simulado: devolve o texto com uso fixo, ou falha. */
function fakeClient(text: string | Error, seen: CompletionRequest[] = []): CompletionClient {
  return {
    provider: 'fake',
    async complete(req) {
      seen.push(req);
      if (text instanceof Error) throw text;
      return {
        text,
        usage: { inputTokens: 1200, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 300 },
        final: true,
        finishReason: 'stop',
        provider: 'fake',
        model: req.model,
      };
    },
    stream() {
      throw new Error('não usado');
    },
  };
}

const input = (t: string, over: Partial<TaskInput<string[]>> = {}): TaskInput<string[]> => ({
  tenantId: t,
  userId: 'u1',
  functionName: FN,
  scope: 'builder',
  system: 'sistema',
  message: 'pedido do cliente',
  maxOutputTokens: 400,
  metadata: { mode: 'widget' },
  evaluate: async (text) => {
    const list = (parseModelJson(text)?.widgets as string[] | undefined) ?? [];
    return { usable: list.length > 0, value: list };
  },
  ...over,
});

const usage = (t: string) =>
  db
    .select()
    .from(ledger)
    .where(and(eq(ledger.tenantId, t), eq(ledger.kind, 'usage')));

describe('tarefa de uma chamada da Cosmos (#1005)', () => {
  it('resposta usável: cobra pelo uso, nunca abaixo do mínimo da função, e o extrato não leva o texto', async () => {
    const t = await newTenant();
    const seen: CompletionRequest[] = [];
    const r = await runCosmosTask(db, input(t), {
      client: fakeClient('```json\n{"widgets":["standings"]}\n```', seen),
      env,
      settings,
    });
    expect(r).toMatchObject({ ok: true, value: ['standings'] });
    expect(r.ok && r.charged).toBeGreaterThanOrEqual(5);
    expect(seen[0]).toMatchObject({ json: true, system: 'sistema', maxOutputTokens: 400 });
    const [u] = await usage(t);
    expect(u!.metadata).toMatchObject({ kind: FN, usable: true, mode: 'widget' });
    expect(JSON.stringify(u!.metadata)).not.toContain('pedido do cliente');
    const w = await getWallet(db, t);
    expect(w!.reserved).toBe(0);
  });

  it('resposta que não serve: o custo vai para o extrato sem débito', async () => {
    const t = await newTenant();
    const before = (await getWallet(db, t))!.available;
    const r = await runCosmosTask(db, input(t), { client: fakeClient('{"widgets":[]}'), env, settings });
    expect(r).toEqual({ ok: false, error: 'unreadable' });
    const w = await getWallet(db, t);
    expect(w!.available).toBe(before);
    expect(w!.reserved).toBe(0);
    expect((await usage(t))[0]!.metadata).toMatchObject({ usable: false });
  });

  it('falha no provedor: a reserva volta inteira e nada é cobrado', async () => {
    const t = await newTenant();
    const before = (await getWallet(db, t))!.available;
    const r = await runCosmosTask(db, input(t), { client: fakeClient(new Error('caiu')), env, settings });
    expect(r).toEqual({ ok: false, error: 'failed' });
    const w = await getWallet(db, t);
    expect(w).toMatchObject({ available: before, reserved: 0 });
    expect(await usage(t)).toHaveLength(0);
  });

  it('sem saldo: nem chama o provedor', async () => {
    const t = await newTenant(0);
    const seen: CompletionRequest[] = [];
    const r = await runCosmosTask(db, input(t), { client: fakeClient('{}', seen), env, settings });
    expect(r).toEqual({ ok: false, error: 'insufficient' });
    expect(seen).toHaveLength(0);
  });

  it('função fora do catálogo ou sem chave do provedor: indisponível', async () => {
    const t = await newTenant();
    expect(await runCosmosTask(db, input(t, { functionName: 'nao.existe' }), { env, settings })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(await runCosmosTask(db, input(t), { env: {}, settings })).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('limite por pessoa por minuto na função', async () => {
    const t = await newTenant();
    for (let i = 0; i < TASK_LIMITS.userPerMinute; i++)
      await runCosmosTask(db, input(t), { client: fakeClient('{"widgets":["x"]}'), env, settings });
    const r = await runCosmosTask(db, input(t), { client: fakeClient('{"widgets":["x"]}'), env, settings });
    expect(r).toEqual({ ok: false, error: 'rate_limited' });
    // outra pessoa do mesmo tenant segue
    const other = await runCosmosTask(db, input(t, { userId: 'u2' }), {
      client: fakeClient('{"widgets":["x"]}'),
      env,
      settings,
    });
    expect(other.ok).toBe(true);
  });

  it('equipe Galaxie: não reserva nem cobra; o custo fica no uso da equipe', async () => {
    const t = await newTenant(0);
    const r = await runCosmosTask(
      db,
      input(t, { userId: 'staff-1', staff: { route: '/cliente/builder#x' } }),
      {
        client: fakeClient('{"widgets":["standings"]}'),
        env,
        settings,
      },
    );
    expect(r).toMatchObject({ ok: true, charged: 0, staff: true });
    expect(await db.select().from(reservation).where(eq(reservation.tenantId, t))).toHaveLength(0);
    const [row] = await db.select().from(staffUsage).where(eq(staffUsage.tenantId, t));
    expect(row).toMatchObject({ outcome: 'ok', route: '/cliente/builder#x', inputTokens: 1200 });
  });
});
