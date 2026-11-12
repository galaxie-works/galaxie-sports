import { randomBytes } from 'node:crypto';
import { ledger, moderationCase, tenant, type Database } from '@galaxie/db';
import type { CompletionClient, CompletionRequest } from '@galaxie/llm';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEntry,
  defaultModelFor,
  ensureWallet,
  getWallet,
  IMAGE_MODERATION_FUNCTION,
  moderateImage,
  saveModerationConfig,
  upsertFunctionDef,
  type CosmosSettings,
  type ImageModerationInput,
  type ModerationCeiling,
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

// o catálogo é global no banco do arquivo: cada teste diz se a função está ligada
async function withFunction(active = true) {
  await upsertFunctionDef(db, {
    name: IMAGE_MODERATION_FUNCTION,
    minCredits: 1,
    permission: 'cosmos.moderation',
    provider: 'anthropic',
    active,
  });
}

async function newTenant(
  credits: number,
  autonomy: Record<string, string> = { hide: 'auto', mute: 'auto', suspend: 'flag', ban: 'flag' },
  images = true,
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
        images,
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

// JPEG mínimo (só a assinatura importa para o tipo)
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const image = (t: string, over: Partial<ImageModerationInput> = {}): ImageModerationInput => ({
  tenantId: t,
  kind: 'profile_photo',
  image: JPEG,
  ref: `avatar/${randomBytes(4).toString('hex')}.jpg`,
  targetType: 'profile',
  targetProfileId: null,
  module: 'profile',
  clocks,
  ...over,
});

const verdict = (category: string, severity: number) =>
  JSON.stringify([{ n: 1, category, severity, reason: 'motivo' }]);

const casesOf = (t: string) => db.select().from(moderationCase).where(eq(moderationCase.tenantId, t));
const usageOf = (t: string) =>
  db
    .select()
    .from(ledger)
    .where(and(eq(ledger.tenantId, t), eq(ledger.kind, 'usage')));

describe('moderação de imagem (#1025)', () => {
  it('imagem liberada aparece, com um lançamento no extrato e a imagem anexada ao pedido', async () => {
    await withFunction();
    const t = await newTenant(10_000);
    const client = fakeClient(verdict('none', 0));
    const o = await moderateImage(db, image(t), { client, env, settings, ceiling });
    expect(o.visible).toBe(true);
    expect(o.by).toBe('cosmos');
    expect(client.requests[0]?.attachments?.[0]?.mediaType).toBe('image/jpeg');
    expect(await casesOf(t)).toHaveLength(0);
    const usage = await usageOf(t);
    expect(usage).toHaveLength(1);
    expect(Number(usage[0]!.credits)).toBeLessThan(0);
  });

  it('imagem fora da régua não aparece: o caso guarda a referência, nunca a imagem', async () => {
    await withFunction();
    const t = await newTenant(10_000, { hide: 'flag', mute: 'flag', suspend: 'flag', ban: 'flag' });
    const input = image(t);
    const o = await moderateImage(db, input, {
      client: fakeClient(verdict('sexual', 3)),
      env,
      settings,
      ceiling,
    });
    expect(o.visible).toBe(false);
    const [c] = await casesOf(t);
    expect(c?.status).toBe('open');
    // mesmo com a escada só sinalizando, a imagem fica fora do ar até a equipe decidir
    expect(c?.hiddenAt).not.toBeNull();
    expect(c?.content).toBeNull();
    expect(JSON.stringify(c?.detail)).toContain(input.ref!);
  });

  it('saldo zerado: a imagem vai para a fila, fora do ar, sem erro e sem chamar o modelo', async () => {
    await withFunction();
    const t = await newTenant(0);
    const client = fakeClient(verdict('none', 0));
    const o = await moderateImage(db, image(t), { client, env, settings, ceiling });
    expect(o.visible).toBe(false);
    expect(o.fallback).toBe('insufficient');
    expect(client.requests).toHaveLength(0);
    const [c] = await casesOf(t);
    expect(c?.status).toBe('open');
    expect(c?.hiddenAt).not.toBeNull();
    expect(await usageOf(t)).toHaveLength(0);
  });

  it('"Moderar imagens" desligado ou arquivo que não é imagem: fila humana, sem gastar', async () => {
    await withFunction();
    const off = await newTenant(10_000, undefined, false);
    const client = fakeClient(verdict('none', 0));
    const a = await moderateImage(db, image(off), { client, env, settings, ceiling });
    expect(a.fallback).toBe('feature_off');
    const on = await newTenant(10_000);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const b = await moderateImage(db, image(on, { image: svg }), { client, env, settings, ceiling });
    expect(b.fallback).toBe('unreadable');
    expect(b.visible).toBe(false);
    expect(client.requests).toHaveLength(0);
    expect(await usageOf(on)).toHaveLength(0);
  });

  it('modelo que falha devolve a reserva e manda a imagem para a fila', async () => {
    await withFunction();
    const t = await newTenant(10_000);
    const before = await getWallet(db, t);
    const o = await moderateImage(db, image(t), {
      client: fakeClient(new Error('fora do ar')),
      env,
      settings,
      ceiling,
    });
    expect(o.fallback).toBe('failed');
    expect(o.visible).toBe(false);
    const after = await getWallet(db, t);
    expect(after?.available).toBe(before?.available);
    expect(after?.reserved).toBe(0);
  });

  it('imagem denunciada: visible null, o módulo segue o caso; liberada continua no ar', async () => {
    await withFunction();
    const t = await newTenant(10_000);
    const o = await moderateImage(db, image(t, { source: 'report' }), {
      client: fakeClient(verdict('none', 0)),
      env,
      settings,
      ceiling,
    });
    expect(o.visible).toBeNull();
    const [c] = await casesOf(t);
    expect(c?.hiddenAt).toBeNull();
  });

  it('cada imagem tem o próprio caso: duas fotos reprovadas do mesmo perfil não se misturam', async () => {
    await withFunction();
    const t = await newTenant(10_000, { hide: 'flag', mute: 'flag', suspend: 'flag', ban: 'flag' });
    const client = fakeClient(verdict('hate', 3));
    await moderateImage(db, image(t), { client, env, settings, ceiling });
    await moderateImage(db, image(t), { client, env, settings, ceiling });
    const cases = await casesOf(t);
    expect(cases).toHaveLength(2);
    expect(cases.every((c) => c.hiddenAt !== null)).toBe(true);
  });
});
