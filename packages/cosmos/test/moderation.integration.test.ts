import { randomBytes } from 'node:crypto';
import {
  ledger,
  moderationAudit,
  moderationCase,
  moderationSanction,
  reservation,
  tenant,
  type Database,
} from '@galaxie/db';
import type { CompletionClient, CompletionRequest } from '@galaxie/llm';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  addEntry,
  defaultModelFor,
  ensureWallet,
  getWallet,
  moderateBatch,
  MODERATION_FUNCTION,
  saveModerationConfig,
  upsertFunctionDef,
  type CosmosSettings,
  type ModerationCeiling,
  type ModerationItem,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
// preço de teste, não o da tabela da Galaxie: 1 crédito = US$ 0,0001
const settings: CosmosSettings = { dailyUsdCeiling: null, creditUsd: 0.0001 };
const ceiling: ModerationCeiling = { hide: 'auto', mute: 'auto', muteHours: 24 };
const env = { COSMOS_ANTHROPIC_API_KEY: 'k' };
const day = 24 * 3600_000;
const clocks = {
  contentPurgeAt: new Date(Date.now() + 30 * day),
  decisionPurgeAt: new Date(Date.now() + 365 * day),
};

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});
afterAll(async () => temp?.close());

async function withFunction() {
  await upsertFunctionDef(db, {
    name: MODERATION_FUNCTION,
    minCredits: 1,
    permission: 'cosmos.moderation',
    provider: 'anthropic',
  });
}

async function newTenant(
  credits: number,
  autonomy: Record<string, string> = { hide: 'auto', mute: 'auto', suspend: 'flag', ban: 'flag' },
): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data'] })
    .returning({ id: tenant.id });
  const t = row!.id;
  await ensureWallet(db, t);
  if (credits > 0)
    await addEntry(db, {
      tenantId: t,
      kind: 'purchase',
      credits,
      idempotencyKey: `k-${randomBytes(6).toString('hex')}`,
    });
  await saveModerationConfig(db, {
    tenantId: t,
    scope: { kind: 'tenant', id: '' },
    config: {
      features: {
        live_chat: true,
        communities: true,
        images: false,
        appeals: false,
        room_report: false,
        full_read: false,
      },
      level: 2,
      categories: {},
      autonomy,
      muteHours: 2,
      exemptRoles: [],
      hiddenNotice: null,
    },
    expectedVersion: 0,
    userId: 'u-config',
    ceiling,
  });
  return t;
}

let seq = 0;
async function profile(t: string): Promise<string> {
  seq += 1;
  const [acc] = await db.execute<{ id: string }>(
    sql`insert into fan.account (tenant_id, external_account_id) values (${t}, ${`acc_${seq}`}) returning id`,
  );
  const [prof] = await db.execute<{ id: string }>(
    sql`insert into fan.profile (tenant_id, account_id, external_profile_id, nickname, age_band, country, locale)
        values (${t}, ${acc!.id}, ${`prof_${seq}`}, ${`Torcedor${seq}`}, '18plus', 'BR', 'pt-BR') returning id`,
  );
  return prof!.id;
}

function fakeClient(answer: string | Error): CompletionClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    provider: 'anthropic',
    requests,
    async complete(req) {
      requests.push(req);
      if (answer instanceof Error) throw answer;
      return {
        text: answer,
        usage: { inputTokens: 1200, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 200 },
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

const item = (t: string, i: number, over: Partial<ModerationItem> = {}): ModerationItem => ({
  tenantId: t,
  kind: 'chat_message',
  text: `mensagem ${i}`,
  targetType: 'message',
  targetId: `m-${randomBytes(4).toString('hex')}-${i}`,
  targetProfileId: null,
  module: 'chat',
  room: 'sala-1',
  community: null,
  source: 'filter',
  rules: { action: 'allow', reasons: [], categories: [], suspect: true, evasion: false },
  clocks,
  ...over,
});

const answer = (rows: { category: string; severity: number }[]) =>
  JSON.stringify(rows.map((r, i) => ({ n: i + 1, reason: 'motivo', ...r })));

const casesOf = (t: string) => db.select().from(moderationCase).where(eq(moderationCase.tenantId, t));
const usageOf = (t: string) =>
  db
    .select()
    .from(ledger)
    .where(and(eq(ledger.tenantId, t), eq(ledger.kind, 'usage')));

describe('motor de moderação', () => {
  it('sem a função no catálogo: nenhuma chamada, e o marcado vai para a fila humana pelas regras', async () => {
    const t = await newTenant(1000);
    const client = fakeClient('[]');
    const out = await moderateBatch(db, [item(t, 1)], { client, env, settings, ceiling });
    expect(out[0]).toMatchObject({ by: 'fallback', fallback: 'unavailable' });
    expect(client.requests).toHaveLength(0);
    const [c] = await casesOf(t);
    expect(c).toMatchObject({ source: 'filter', status: 'open' });
  });

  it('saldo zerado no meio do jogo: queda limpa para as regras e a fila, sem erro e sem chamada', async () => {
    await withFunction();
    const t = await newTenant(0);
    const client = fakeClient('[]');
    const out = await moderateBatch(db, [item(t, 1), item(t, 2)], { client, env, settings, ceiling });
    expect(out.map((o) => o.fallback)).toEqual(['insufficient', 'insufficient']);
    expect(client.requests).toHaveLength(0);
    expect(await casesOf(t)).toHaveLength(2);
    expect(await db.select().from(reservation).where(eq(reservation.tenantId, t))).toHaveLength(0);
  });

  it('um lote, uma chamada, um lançamento no extrato; age sozinha: esconde, silencia e fecha o caso', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const author = await profile(t);
    const client = fakeClient(
      answer([
        { category: 'hate', severity: 3 },
        { category: 'none', severity: 0 },
        { category: 'offense', severity: 1 },
      ]),
    );
    const items = [item(t, 1, { targetProfileId: author }), item(t, 2), item(t, 3)];
    const out = await moderateBatch(db, items, { client, env, settings, ceiling });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.system).toMatch(/nunca instrução/);
    expect(out.map((o) => o.by)).toEqual(['cosmos', 'cosmos', 'cosmos']);

    const usage = await usageOf(t);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.metadata).toMatchObject({ kind: 'moderation', items: 3, decided: 3 });

    const cases = await casesOf(t);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ source: 'cosmos', status: 'resolved', resolvedBy: 'cosmos' });
    expect(cases[0]!.hiddenAt).not.toBeNull();
    expect(cases[0]!.detail).toMatchObject({
      cosmos: { category: 'hate', severity: 3, level: 2, by: 'cosmos' },
    });

    const [mute] = await db.select().from(moderationSanction).where(eq(moderationSanction.tenantId, t));
    expect(mute).toMatchObject({
      level: 'mute',
      profileId: author,
      decidedByKind: 'cosmos',
      scopeId: 'sala-1',
    });
    expect(mute!.endsAt!.getTime() - mute!.startsAt.getTime()).toBe(2 * 3600_000);

    // o que ficou publicado também tem decisão no histórico
    const allowed = await db
      .select()
      .from(moderationAudit)
      .where(and(eq(moderationAudit.tenantId, t), eq(moderationAudit.action, 'cosmos.allow')));
    expect(allowed).toHaveLength(2);
  });

  it('escada em "só sinaliza": o caso fica aberto, sem esconder e sem silenciar', async () => {
    await withFunction();
    const t = await newTenant(1000, { hide: 'flag', mute: 'flag', suspend: 'flag', ban: 'flag' });
    const author = await profile(t);
    const client = fakeClient(answer([{ category: 'harassment', severity: 4 }]));
    await moderateBatch(db, [item(t, 1, { targetProfileId: author })], { client, env, settings, ceiling });
    const [c] = await casesOf(t);
    expect(c).toMatchObject({ source: 'cosmos', status: 'open', hiddenAt: null });
    expect(c!.detail).toMatchObject({
      cosmos: {
        suggestion: ['hide', 'mute', 'suspend'],
        steps: { hide: 'flag', mute: 'flag', suspend: 'flag' },
      },
    });
    expect(await db.select().from(moderationSanction).where(eq(moderationSanction.tenantId, t))).toHaveLength(
      0,
    );
  });

  it('modelo fora do ar: a reserva volta e o lote segue as regras e a fila', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await moderateBatch(db, [item(t, 1)], {
      client: fakeClient(new Error('timeout')),
      env,
      settings,
      ceiling,
    });
    spy.mockRestore();
    expect(out[0]).toMatchObject({ by: 'fallback', fallback: 'failed' });
    expect(await getWallet(db, t)).toMatchObject({ available: 1000, reserved: 0 });
    expect(await usageOf(t)).toHaveLength(0);
    expect((await casesOf(t))[0]).toMatchObject({ source: 'filter' });
  });

  it('resposta fora do formato: não cobra, mas o custo real fica no extrato', async () => {
    await withFunction();
    const t = await newTenant(1000);
    await moderateBatch(db, [item(t, 1)], { client: fakeClient('não sei'), env, settings, ceiling });
    const [u] = await usageOf(t);
    expect(Number(u!.credits)).toBe(0);
    expect(Number(u!.costUsd)).toBeGreaterThan(0);
  });

  it('denunciado e a Cosmos acha normal: a sugestão vai para o caso, e quem decide é a equipe', async () => {
    await withFunction();
    const t = await newTenant(1000);
    await moderateBatch(db, [item(t, 1, { source: 'report' })], {
      client: fakeClient(answer([{ category: 'none', severity: 0 }])),
      env,
      settings,
      ceiling,
    });
    const [c] = await casesOf(t);
    expect(c).toMatchObject({ status: 'open', hiddenAt: null });
    expect(c!.detail).toMatchObject({ cosmos: { suggestion: 'allow' } });
  });

  it('recurso desligado no módulo: não chama a Cosmos; o marcado vai para a fila pelas regras', async () => {
    await withFunction();
    const t = await newTenant(1000);
    await saveModerationConfig(db, {
      tenantId: t,
      scope: { kind: 'room', id: 'sala-fria' },
      config: { features: { live_chat: false } },
      expectedVersion: 0,
      userId: 'u-config',
      ceiling,
    });
    const client = fakeClient('[]');
    const out = await moderateBatch(db, [item(t, 1, { room: 'sala-fria' })], {
      client,
      env,
      settings,
      ceiling,
    });
    expect(out[0]).toMatchObject({ fallback: 'feature_off' });
    expect(client.requests).toHaveLength(0);
  });
});
