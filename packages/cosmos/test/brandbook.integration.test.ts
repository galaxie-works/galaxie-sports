import { randomBytes } from 'node:crypto';
import { ledger, reservation, tenant, type Database } from '@galaxie/db';
import type { CompletionClient, CompletionRequest } from '@galaxie/llm';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  addEntry,
  BRANDBOOK_FUNCTION,
  contrastReport,
  defaultModelFor,
  ensureWallet,
  getWallet,
  quoteBrandbook,
  runBrandbook,
  upsertFunctionDef,
  type CosmosSettings,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
// preço de teste, não o da tabela da Galaxie: 1 crédito = US$ 0,0001
const settings: CosmosSettings = { dailyUsdCeiling: null, creditUsd: 0.0001 };
const env = { COSMOS_ANTHROPIC_API_KEY: 'k' };
const pdf = new TextEncoder().encode('%PDF-1.7\n/Type /Page /Type /Page\n');

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
  await upsertFunctionDef(db, {
    name: BRANDBOOK_FUNCTION,
    minCredits: 60,
    permission: 'cosmos.assistant.ask',
    provider: 'anthropic',
  });
});
afterAll(async () => temp?.close());

async function newTenant(credits = 1000): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data'] })
    .returning({ id: tenant.id });
  await ensureWallet(db, row!.id);
  await addEntry(db, {
    tenantId: row!.id,
    kind: 'purchase',
    credits,
    idempotencyKey: `k-${randomBytes(6).toString('hex')}`,
  });
  return row!.id;
}

function fakeClient(text: string | Error): CompletionClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    provider: 'anthropic',
    requests,
    async complete(req) {
      requests.push(req);
      if (text instanceof Error) throw text;
      return {
        text,
        usage: { inputTokens: 5000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 400 },
        final: true,
        finishReason: 'stop',
        provider: 'anthropic',
        model: defaultModelFor('anthropic'),
      };
    },
    stream() {
      throw new Error('não usado');
    },
  };
}

const GOOD = JSON.stringify({
  colors: [
    { hex: '#e30613', role: 'primary' },
    { hex: '#ffffff', role: 'background' },
  ],
  primary: '#e30613',
  bodyFont: 'Inter',
  radius: 6,
  density: 'compact',
  notes: 'Vermelho da página 3.',
});

describe('tema a partir do brandbook', () => {
  it('estimativa nunca abaixo do mínimo da função; sem a chave da Cosmos no provedor, indisponível', async () => {
    const t = await newTenant();
    const q = await quoteBrandbook(db, { tenantId: t, pdf, settings }, env);
    expect(q).toMatchObject({ pages: 2, provider: 'anthropic' });
    expect(q!.credits).toBeGreaterThanOrEqual(60);
    expect(await quoteBrandbook(db, { tenantId: t, pdf, settings }, {})).toBeNull();
  });

  it('lê com o PDF anexado, monta os temas no AA e cobra no máximo o que foi mostrado', async () => {
    const t = await newTenant();
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    const client = fakeClient(GOOD);
    const r = await runBrandbook(
      db,
      { tenantId: t, userId: 'u1', pdf, locale: 'pt-BR', quote, settings, client },
      env,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(client.requests[0]!.attachments?.[0]).toMatchObject({ mediaType: 'application/pdf' });
    expect(Buffer.from(client.requests[0]!.attachments![0]!.data, 'base64').subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    for (const theme of [r.themes.light, r.themes.dark])
      expect(contrastReport(theme).every((p) => p.pass)).toBe(true);
    expect(r.charged).toBeLessThanOrEqual(quote.credits);
    expect(r.charged).toBeGreaterThanOrEqual(60);
    const w = await getWallet(db, t);
    expect(w!.available).toBe(1000 - r.charged);
    expect(w!.reserved).toBe(0);
  });

  it('provedor falhou: a reserva volta inteira', async () => {
    const t = await newTenant();
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runBrandbook(
      db,
      {
        tenantId: t,
        userId: 'u1',
        pdf,
        locale: 'pt-BR',
        quote,
        settings,
        client: fakeClient(new Error('fora')),
      },
      env,
    );
    spy.mockRestore();
    expect(r).toEqual({ ok: false, error: 'failed' });
    const w = await getWallet(db, t);
    expect(w).toMatchObject({ available: 1000, reserved: 0 });
    const [res] = await db.select().from(reservation).where(eq(reservation.tenantId, t));
    expect(res!.status).toBe('released');
  });

  it('não era um manual de marca: não cobra, mas o custo real fica no extrato', async () => {
    const t = await newTenant();
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    const r = await runBrandbook(
      db,
      {
        tenantId: t,
        userId: 'u1',
        pdf,
        locale: 'pt-BR',
        quote,
        settings,
        client: fakeClient('{"colors":[],"notes":"É uma nota fiscal."}'),
      },
      env,
    );
    expect(r).toEqual({ ok: false, error: 'unreadable' });
    expect(await getWallet(db, t)).toMatchObject({ available: 1000, reserved: 0 });
    const [usage] = await db
      .select()
      .from(ledger)
      .where(and(eq(ledger.tenantId, t), eq(ledger.kind, 'usage')));
    expect(Number(usage!.credits)).toBe(0);
    expect(Number(usage!.costUsd)).toBeGreaterThan(0);
  });

  it('sem saldo: nenhuma chamada ao provedor', async () => {
    const t = await newTenant(10);
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    const client = fakeClient(GOOD);
    const r = await runBrandbook(
      db,
      { tenantId: t, userId: 'u1', pdf, locale: 'pt-BR', quote, settings, client },
      env,
    );
    expect(r).toEqual({ ok: false, error: 'insufficient' });
    expect(client.requests).toHaveLength(0);
  });

  it('a função só aceita provedor que lê PDF', async () => {
    await expect(
      upsertFunctionDef(db, {
        name: BRANDBOOK_FUNCTION,
        minCredits: 60,
        permission: 'cosmos.assistant.ask',
        provider: 'deepseek',
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
});
