import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  closeDb,
  createDb,
  fanAvatarPublicUrl,
  fanProfile,
  moderationCase,
  purgeModeration,
  runMigrations,
  type Database,
} from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { checkAvatar, publicAvatars, type AvatarCheckInput } from '../src/engage/fan-avatar.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { buildServer } from '../src/server.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const ADMIN_KEY = generateAdminKey();

let pg: postgres.Sql;
let db: Database;
let app: FastifyInstance;

// a moderação de verdade fica no pacote da Cosmos (moderation-image.integration.test); aqui ela só diz se libera
let verdict = true;
// segurada sem caso na fila: fica pendente para tentar de novo
let withCase = true;
const seen: { input: AvatarCheckInput; bytes: number }[] = [];
let pending: Promise<unknown>[] = [];
// segura a decisão até o teste soltar (para ver a foto ainda em análise sem depender de tempo)
let gate: Promise<void> | null = null;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
// cada foto tem a sua imagem; `same=N` aponta outra URL para a imagem da foto N (link assinado, `?v=`)
const imageOf = (u: string) => {
  const n = Number(/same=(\d+)/.exec(u)?.[1] ?? /foto-(\d+)/.exec(u)?.[1] ?? 0);
  return new Uint8Array([...png, n]);
};
const check = (database: Database, input: AvatarCheckInput) => {
  const run = checkAvatar(database, input, {
    fetch: async (u) => new Response(imageOf(String(u))),
    moderate: async (_db, image) => {
      if (gate) await gate;
      seen.push({ input, bytes: image.image.byteLength });
      return { visible: verdict, caseId: verdict || !withCase ? null : 'caso-falso' } as never;
    },
  });
  pending.push(run);
  return run;
};
const settle = async () => {
  const all = pending;
  pending = [];
  await Promise.all(all);
};

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  app = buildServer({
    db,
    usagePersist: false,
    moduleUsage: false,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: new FanTokenSigner({ secret: 's'.repeat(48) }),
    fanAvatarCheck: check,
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
  });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

async function tenantKey(slug: string): Promise<{ id: string; key: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/internal/admin/tenants',
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    payload: { slug, name: slug, plan: 'enterprise', modules: ['core_data', 'live_chat'] },
  });
  expect(res.statusCode).toBe(201);
  return { id: res.json().tenant.id, key: res.json().key.key };
}

const issue = (key: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/fans/tokens', headers: { 'x-galaxie-key': key }, payload: body });
const meOf = async (token: string) =>
  (
    await app.inject({ method: 'GET', url: '/v1/fans/me', headers: { authorization: `Bearer ${token}` } })
  ).json().data;

const base = {
  externalAccountId: 'acc_1',
  externalProfileId: 'prof_1',
  nickname: 'Torcedor_1',
  ageBand: '18plus',
  country: 'BR',
  locale: 'pt-BR',
};
const photo = (n: number) => `https://cdn.exemplo.com/foto-${n}.png`;

async function profileRow(tenantId: string, id: string) {
  const [row] = await db
    .select({ status: fanProfile.avatarStatus, ref: fanProfile.avatarRef })
    .from(fanProfile)
    .where(and(eq(fanProfile.tenantId, tenantId), eq(fanProfile.id, id)));
  return row!;
}

async function caseFor(tenantId: string, ref: string, values: { status: string; hidden: boolean }) {
  await db.insert(moderationCase).values({
    tenantId,
    source: 'filter',
    targetType: 'profile',
    targetId: ref,
    module: 'profile',
    severity: 2,
    status: values.status,
    hiddenAt: values.hidden ? new Date() : null,
  });
}

describe('foto de perfil na moderação de imagem (#1025)', () => {
  it('foto nova fica pendente, a Cosmos libera e os outros passam a ver', async () => {
    const t = await tenantKey('avatar-libera');
    verdict = true;
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const res = await issue(t.key, { ...base, avatarUrl: photo(1) });
    expect(res.statusCode).toBe(201);
    const { token, profile_id } = res.json().data;
    // o token não espera a moderação: a foto aparece só para o dono, em análise
    expect(await publicAvatars(db, t.id, [profile_id])).toEqual(new Map());
    gate = null;
    release();
    await settle();
    expect(seen.at(-1)).toMatchObject({
      input: { url: photo(1), profileId: profile_id, ageBand: '18plus' },
      bytes: png.byteLength + 1,
    });
    expect(await meOf(token)).toMatchObject({ avatar_url: photo(1), avatar_status: 'visible' });
    expect(await publicAvatars(db, t.id, [profile_id])).toEqual(new Map([[profile_id, photo(1)]]));
    // a mesma foto no próximo token não volta para a moderação
    const calls = seen.length;
    await issue(t.key, { ...base, avatarUrl: photo(1) });
    await settle();
    expect(seen.length).toBe(calls);
  });

  it('foto segurada só volta quando a equipe fecha o caso sem esconder', async () => {
    const t = await tenantKey('avatar-segura');
    verdict = false;
    const res = await issue(t.key, { ...base, avatarUrl: photo(2) });
    const { token, profile_id } = res.json().data;
    await settle();
    expect(await meOf(token)).toMatchObject({ avatar_url: photo(2), avatar_status: 'held' });
    expect(await publicAvatars(db, t.id, [profile_id])).toEqual(new Map());
    const { ref } = await profileRow(t.id, profile_id);
    // caso aberto: continua fora do ar
    await caseFor(t.id, ref!, { status: 'open', hidden: false });
    expect(await publicAvatars(db, t.id, [profile_id])).toEqual(new Map());
    // a equipe arquivou sem ação: a foto volta
    await db.update(moderationCase).set({ status: 'dismissed' }).where(eq(moderationCase.targetId, ref!));
    expect(await publicAvatars(db, t.id, [profile_id])).toEqual(new Map([[profile_id, photo(2)]]));
    // outro caso da mesma foto a tirou do ar (denúncia depois): some de novo
    await caseFor(t.id, ref!, { status: 'resolved', hidden: true });
    expect(await publicAvatars(db, t.id, [profile_id])).toEqual(new Map());
  });

  it('foto trocada no meio não recebe a decisão da anterior; sem foto, o estado some', async () => {
    const t = await tenantKey('avatar-troca');
    verdict = true;
    const first = await issue(t.key, { ...base, avatarUrl: photo(3) });
    const { profile_id } = first.json().data;
    const old = await profileRow(t.id, profile_id);
    await settle();
    // a foto muda; a decisão atrasada da anterior não vale para a nova
    verdict = false;
    await issue(t.key, { ...base, avatarUrl: photo(4) });
    const now = await profileRow(t.id, profile_id);
    expect(now.ref).not.toBe(old.ref);
    expect(now.status).toBe('pending');
    const late = await checkAvatar(
      db,
      {
        tenantId: t.id,
        profileId: profile_id,
        ref: old.ref!,
        url: photo(3),
        previous: null,
        clocks: { contentPurgeAt: new Date(), decisionPurgeAt: new Date() },
      },
      { fetch: async () => new Response(png), moderate: async () => ({ visible: true }) as never },
    );
    expect(late).toBeNull();
    await settle();
    expect((await profileRow(t.id, profile_id)).status).toBe('held');
    // sem foto no pedido: o estado sai junto
    const none = await issue(t.key, base);
    expect(await meOf(none.json().data.token)).toMatchObject({ avatar_url: null, avatar_status: null });
    expect(await profileRow(t.id, profile_id)).toEqual({ status: null, ref: null });
  });

  it('a mesma imagem numa URL nova herda a decisão, sem nova moderação', async () => {
    const t = await tenantKey('avatar-mesma');
    verdict = true;
    const first = await issue(t.key, { ...base, avatarUrl: photo(5) });
    const { profile_id } = first.json().data;
    await settle();
    const decided = await profileRow(t.id, profile_id);
    const calls = seen.length;
    // link novo para a mesma imagem
    const signed = `${photo(9)}?same=5`;
    await issue(t.key, { ...base, avatarUrl: signed });
    await settle();
    expect(seen.length).toBe(calls);
    expect(await profileRow(t.id, profile_id)).toEqual({ status: 'visible', ref: decided.ref });
    expect(await publicAvatars(db, t.id, [profile_id])).toEqual(new Map([[profile_id, signed]]));
  });

  it('o chat usa a mesma regra: pendente e segurada saem sem foto', async () => {
    const t = await tenantKey('avatar-chat');
    verdict = false;
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const { profile_id } = (await issue(t.key, { ...base, avatarUrl: photo(7) })).json().data;
    const chatUrl = async () =>
      (
        await db
          .select({ url: fanAvatarPublicUrl() })
          .from(fanProfile)
          .where(and(eq(fanProfile.tenantId, t.id), eq(fanProfile.id, profile_id)))
      )[0]!.url;
    expect(await chatUrl()).toBeNull(); // pendente
    gate = null;
    release();
    await settle();
    expect(await chatUrl()).toBeNull(); // segurada
    const { ref } = await profileRow(t.id, profile_id);
    await caseFor(t.id, ref!, { status: 'dismissed', hidden: false });
    expect(await chatUrl()).toBe(photo(7));
  });

  it('a decisão da equipe sobrevive à limpeza do caso', async () => {
    const t = await tenantKey('avatar-limpeza');
    verdict = false;
    const kept = (await issue(t.key, { ...base, avatarUrl: photo(8) })).json().data.profile_id;
    const gone = (
      await issue(t.key, {
        ...base,
        externalProfileId: 'prof_2',
        nickname: 'Torcedor_2',
        avatarUrl: photo(9),
      })
    ).json().data.profile_id;
    await settle();
    const keptRef = (await profileRow(t.id, kept)).ref!;
    const goneRef = (await profileRow(t.id, gone)).ref!;
    await caseFor(t.id, keptRef, { status: 'dismissed', hidden: false });
    await caseFor(t.id, goneRef, { status: 'resolved', hidden: true });
    await db
      .update(moderationCase)
      .set({ purgeAt: new Date(Date.now() - 1000) })
      .where(eq(moderationCase.tenantId, t.id));
    await purgeModeration(db);
    expect(await db.select().from(moderationCase).where(eq(moderationCase.tenantId, t.id))).toEqual([]);
    // arquivada sem ação: fica no ar sem o caso; tirada do ar: não volta
    expect((await profileRow(t.id, kept)).status).toBe('visible');
    expect((await profileRow(t.id, gone)).status).toBe('removed');
    expect(await publicAvatars(db, t.id, [kept, gone])).toEqual(new Map([[kept, photo(8)]]));
  });

  it('segurada sem caso na fila fica pendente para tentar de novo', async () => {
    const t = await tenantKey('avatar-sem-caso');
    verdict = false;
    withCase = false;
    try {
      const res = await issue(t.key, { ...base, avatarUrl: photo(6) });
      await settle();
      expect((await profileRow(t.id, res.json().data.profile_id)).status).toBe('pending');
    } finally {
      withCase = true;
    }
  });
});
