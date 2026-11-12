import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySanction,
  closeDb,
  createDb,
  decideAppeal,
  listQueue,
  readAudit,
  runMigrations,
  type Database,
} from '@galaxie/db';
import { sql } from 'drizzle-orm';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { buildServer } from '../src/server.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-test-${randomBytes(4).toString('hex')}:`;
const ADMIN_KEY = generateAdminKey();

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usagePersist: false,
    moduleUsage: false,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: new FanTokenSigner({ secret: 's'.repeat(48) }),
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
  });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

async function tenantKey(slug: string, modules: string[]): Promise<{ id: string; key: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/internal/admin/tenants',
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    payload: { slug, name: slug, plan: 'enterprise', modules },
  });
  expect(res.statusCode).toBe(201);
  return { id: res.json().tenant.id, key: res.json().key.key };
}

const issue = (key: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/fans/tokens', headers: { 'x-galaxie-key': key }, payload: body });
const fan = async (key: string, n: number, ageBand = '18plus') => {
  const res = await issue(key, {
    externalAccountId: `acc_${n}`,
    externalProfileId: `prof_${n}`,
    nickname: `Torcedor${n}`,
    ageBand,
    country: 'br',
    locale: 'pt-BR',
    // o Brasil pede comprovação estimada para os recursos sociais (ficha do #1104, portão do #1106)
    ageAssurance: { method: 'estimated', at: '2026-11-01' },
  });
  expect(res.statusCode).toBe(201);
  return { token: res.json().data.token as string, profileId: res.json().data.profile_id as string };
};
const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });
const day = 24 * 3600_000;
const clocks = () => ({
  contentPurgeAt: new Date(Date.now() + 30 * day),
  decisionPurgeAt: new Date(Date.now() + 365 * day),
});

describe('moderação do torcedor (#953)', () => {
  it('denúncia entra na fila, não conta duas vezes e oculta com três denunciantes', async () => {
    const t = await tenantKey('mod-a', ['core_data', 'live_chat']);
    const author = await fan(t.key, 1);
    const reporters = [await fan(t.key, 2), await fan(t.key, 3), await fan(t.key, 4)];
    const report = (token: string) =>
      call(token, 'POST', '/v1/moderation/reports', {
        targetType: 'message',
        targetId: 'msg_1',
        targetProfileId: author.profileId,
        module: 'chat',
        room: 'jogo-1',
        reason: 'harassment',
        note: 'xingou',
      });
    const first = await report(reporters[0]!.token);
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ hidden: false, duplicate: false });
    expect((await report(reporters[0]!.token)).json().data.duplicate).toBe(true);
    await report(reporters[1]!.token);
    const third = await report(reporters[2]!.token);
    expect(third.json().data.hidden).toBe(true);
    const [c] = await listQueue(db, t.id);
    expect(c).toMatchObject({
      id: first.json().data.case_id,
      reportCount: 3,
      module: 'chat',
      room: 'jogo-1',
    });
    expect(c!.content).toBeNull();

    const self = await call(author.token, 'POST', '/v1/moderation/reports', {
      targetType: 'profile',
      targetId: author.profileId,
      module: 'profile',
      reason: 'spam',
    });
    expect(self.statusCode).toBe(409);
    const notUuid = await call(author.token, 'POST', '/v1/moderation/reports', {
      targetType: 'profile',
      targetId: 'nao-e-uuid',
      module: 'profile',
      reason: 'spam',
    });
    expect(notUuid.statusCode).toBe(400);
    const bad = await call(author.token, 'POST', '/v1/moderation/reports', {
      targetType: 'message',
      targetId: 'msg_2',
      module: 'chat',
      reason: 'spam',
      content: 'texto do torcedor',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('menor de 13 não denuncia nem bloqueia', async () => {
    const t = await tenantKey('mod-b', ['core_data', 'live_chat']);
    const kid = await fan(t.key, 10, 'under13');
    const other = await fan(t.key, 11);
    expect((await call(kid.token, 'PUT', `/v1/fans/me/blocks/${other.profileId}`)).statusCode).toBe(403);
    expect(
      (
        await call(kid.token, 'POST', '/v1/moderation/reports', {
          targetType: 'message',
          targetId: 'm',
          module: 'chat',
          reason: 'spam',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('bloqueia, lista e desbloqueia; não bloqueia a si nem Perfil de outro cliente', async () => {
    const t = await tenantKey('mod-c', ['core_data', 'live_chat']);
    const other = await tenantKey('mod-d', ['core_data', 'live_chat']);
    const a = await fan(t.key, 20);
    const b = await fan(t.key, 21);
    const outsider = await fan(other.key, 22);
    expect((await call(a.token, 'PUT', `/v1/fans/me/blocks/${b.profileId}`)).statusCode).toBe(204);
    expect((await call(a.token, 'PUT', `/v1/fans/me/blocks/${b.profileId}`)).statusCode).toBe(204);
    expect((await call(a.token, 'PUT', `/v1/fans/me/blocks/${a.profileId}`)).statusCode).toBe(409);
    expect((await call(a.token, 'PUT', `/v1/fans/me/blocks/${outsider.profileId}`)).statusCode).toBe(404);
    const list = await call(a.token, 'GET', '/v1/fans/me/blocks');
    expect(list.json().data.map((x: { profile_id: string }) => x.profile_id)).toEqual([b.profileId]);
    expect((await call(a.token, 'DELETE', `/v1/fans/me/blocks/${b.profileId}`)).statusCode).toBe(204);
    expect((await call(a.token, 'GET', '/v1/fans/me/blocks')).json().data).toEqual([]);
  });

  it('punição aparece para o torcedor; apela uma vez e, depois da Cosmos, vai à Galaxie', async () => {
    const t = await tenantKey('mod-e', ['core_data', 'live_chat']);
    const f = await fan(t.key, 30);
    const s = await applySanction(db, {
      tenantId: t.id,
      profileId: f.profileId,
      accountId: null,
      level: 'mute',
      hidden: false,
      scope: 'place',
      scopeId: 'jogo-1',
      reason: 'flood',
      caseId: null,
      actor: { id: 'user:mod1', kind: 'person' },
      endsAt: new Date(Date.now() + day),
      clocks: clocks(),
    });
    const hidden = await applySanction(db, {
      tenantId: t.id,
      profileId: f.profileId,
      accountId: null,
      level: 'mute',
      hidden: true,
      scope: 'place',
      scopeId: 'jogo-1',
      reason: 'flood',
      caseId: null,
      actor: { id: 'user:mod', kind: 'person' },
      endsAt: new Date(Date.now() + day),
      clocks: clocks(),
    });
    const list = await call(f.token, 'GET', '/v1/fans/me/sanctions');
    expect(list.json().data.map((x: { id: string }) => x.id)).toEqual([s.id]);
    expect(list.json().data[0]).toMatchObject({ level: 'mute', active: true, appeals: [] });

    const url = `/v1/fans/me/sanctions/${s.id}/appeals`;
    expect((await call(f.token, 'POST', url, { statement: 'x'.repeat(1001) })).statusCode).toBe(400);
    const ap1 = await call(f.token, 'POST', url, { statement: 'não fui eu' });
    expect(ap1.statusCode).toBe(201);
    expect(ap1.json().data).toMatchObject({ stage: 1, route: 'team' });
    expect((await call(f.token, 'POST', url, {})).statusCode).toBe(409);
    expect((await call(f.token, 'POST', `/v1/fans/me/sanctions/${hidden.id}/appeals`, {})).statusCode).toBe(
      404,
    );

    const decided = await decideAppeal(db, {
      tenantId: t.id,
      appealId: ap1.json().data.appeal_id,
      decision: 'upheld',
      actor: { id: 'cosmos', kind: 'cosmos' },
      note: null,
      clocks: clocks(),
    });
    expect(decided).toBe('decided');
    const ap2 = await call(f.token, 'POST', url, { statement: 'quero uma pessoa' });
    expect(ap2.statusCode).toBe(201);
    expect(ap2.json().data).toMatchObject({ stage: 2, route: 'galaxie' });
    expect((await call(f.token, 'POST', url, {})).statusCode).toBe(409);
    const after = await call(f.token, 'GET', '/v1/fans/me/sanctions');
    expect(after.json().data[0].appeals.map((a: { stage: number }) => a.stage)).toEqual([1, 2]);
    expect((await readAudit(db, t.id, { subjectProfileId: f.profileId })).length).toBeGreaterThanOrEqual(5);
  });

  it('a exclusão do torcedor apaga o conteúdo dele na moderação', async () => {
    const t = await tenantKey('mod-f', ['core_data', 'live_chat']);
    const a = await fan(t.key, 40);
    const b = await fan(t.key, 41);
    await call(a.token, 'PUT', `/v1/fans/me/blocks/${b.profileId}`);
    await call(a.token, 'POST', '/v1/moderation/reports', {
      targetType: 'profile',
      targetId: b.profileId,
      module: 'profile',
      reason: 'harassment',
      note: 'me persegue',
    });
    const del = await app.inject({
      method: 'DELETE',
      url: '/v1/fans/acc_40/profiles/prof_40',
      headers: { 'x-galaxie-key': t.key },
    });
    expect(del.statusCode).toBe(204);
    const blocks = await db.execute(
      // bloqueios caem com o Perfil excluído
      sql`select count(*)::int as n from engage.fan_block where blocker_profile_id = ${a.profileId}`,
    );
    expect((blocks as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
    const reports = await db.execute(
      sql`select note from engage.moderation_report where reporter_profile_id = ${a.profileId}`,
    );
    expect((reports as unknown as Array<{ note: string | null }>)[0]!.note).toBeNull();
  });
});
