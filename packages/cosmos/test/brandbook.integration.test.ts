import { randomBytes } from 'node:crypto';
import { ledger, reservation, tenant, type Database } from '@galaxie/db';
import type { CompletionClient, CompletionRequest } from '@galaxie/llm';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  addEntry,
  BRANDBOOK_FUNCTION,
  BRANDBOOK_LIMITS,
  contrastReport,
  defaultModelFor,
  ensureWallet,
  getWallet,
  release,
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

function fakeClient(
  text: string | Error,
  during?: () => Promise<void>,
): CompletionClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    provider: 'anthropic',
    requests,
    async complete(req) {
      requests.push(req);
      await during?.();
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
    expect(r).toEqual({ ok: false, error: 'unreadable', notes: 'É uma nota fiscal.' });
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

  it('o pedido não manda temperature (os modelos atuais da Anthropic recusam)', async () => {
    const t = await newTenant();
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    const client = fakeClient(GOOD);
    await runBrandbook(db, { tenantId: t, userId: 'u1', pdf, locale: 'pt-BR', quote, settings, client }, env);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).not.toHaveProperty('temperature');
  });

  it('acerto que falha de vez: o tema montado chega mesmo assim e o custo vai para o log', async () => {
    const t = await newTenant();
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    // a reserva fecha durante a leitura (a limpeza venceu a reserva): o acerto recusa com reservation_closed
    const client = fakeClient(GOOD, async () => {
      const [open] = await db
        .select({ id: reservation.id })
        .from(reservation)
        .where(and(eq(reservation.tenantId, t), eq(reservation.status, 'open')));
      await release(db, { tenantId: t, reservationId: open!.id });
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runBrandbook(
      db,
      { tenantId: t, userId: 'u1', pdf, locale: 'pt-BR', quote, settings, client, settleBackoffMs: [1, 1] },
      env,
    );
    expect(r).toMatchObject({ ok: true, charged: 0 });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('acerto do brandbook falhou'),
      expect.objectContaining({ tenantId: t }),
    );
    spy.mockRestore();
  });

  it('leituras sem tema têm teto por dia: depois dele, nenhuma chamada ao provedor', async () => {
    const t = await newTenant();
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    const junk = '{"colors":[],"notes":"Não é um manual."}';
    for (let i = 0; i < BRANDBOOK_LIMITS.tenantWaivedPerDay; i++) {
      const r = await runBrandbook(
        db,
        { tenantId: t, userId: `u${i}`, pdf, locale: 'pt-BR', quote, settings, client: fakeClient(junk) },
        env,
      );
      expect(r).toMatchObject({ ok: false, error: 'unreadable' });
    }
    const client = fakeClient(GOOD);
    const r = await runBrandbook(
      db,
      { tenantId: t, userId: 'outra', pdf, locale: 'pt-BR', quote, settings, client },
      env,
    );
    expect(r).toEqual({ ok: false, error: 'rate_limited' });
    expect(client.requests).toHaveLength(0);
  });

  it('leituras por pessoa por hora têm teto', async () => {
    const t = await newTenant(100_000);
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    for (let i = 0; i < BRANDBOOK_LIMITS.userPerHour; i++)
      expect(
        (
          await runBrandbook(
            db,
            {
              tenantId: t,
              userId: 'rapida',
              pdf,
              locale: 'pt-BR',
              quote,
              settings,
              client: fakeClient(GOOD),
            },
            env,
          )
        ).ok,
      ).toBe(true);
    const client = fakeClient(GOOD);
    expect(
      await runBrandbook(
        db,
        { tenantId: t, userId: 'rapida', pdf, locale: 'pt-BR', quote, settings, client },
        env,
      ),
    ).toEqual({ ok: false, error: 'rate_limited' });
    expect(client.requests).toHaveLength(0);
  });

  it('duas leituras da mesma pessoa ao mesmo tempo: a trava deixa passar só uma', async () => {
    const t = await newTenant(100_000);
    const quote = (await quoteBrandbook(db, { tenantId: t, pdf, settings }, env))!;
    const slow = () => fakeClient(GOOD, () => new Promise((r) => setTimeout(r, 200)));
    const [a, b] = await Promise.all(
      [slow(), slow()].map((client) =>
        runBrandbook(
          db,
          { tenantId: t, userId: 'dupla', pdf, locale: 'pt-BR', quote, settings, client },
          env,
        ),
      ),
    );
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok)).toEqual([{ ok: false, error: 'busy' }]);
  });
});
