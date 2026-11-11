import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MODERATION_LISTS, normalizeDomain, normalizeTerm } from '@galaxie/engage';
import { eq, isNull } from 'drizzle-orm';
import { closeDb, createDb, fanProfile, moderationList, runMigrations, type Database } from '@galaxie/db';
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
const me = (token: string, method: 'GET' | 'PATCH' = 'GET', payload?: object) =>
  app.inject({
    method,
    url: '/v1/fans/me',
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

const base = {
  externalAccountId: 'acc_100',
  externalProfileId: 'prof_100',
  nickname: 'Tricolor_77',
  ageBand: '18plus',
  country: 'br',
  locale: 'pt-BR',
};

describe('identidade do torcedor (#937)', () => {
  it('emite o token, lê o Perfil e atualiza no próximo pedido sem duplicar', async () => {
    const t = await tenantKey('fans-a', ['core_data', 'live_chat']);
    const first = await issue(t.key, { ...base, holderAdult: 'yes' });
    expect(first.statusCode).toBe(201);
    const { token, profile_id, expires_in } = first.json().data;
    expect(token).toMatch(/^gft_/);
    expect(expires_in).toBe(900);
    const read = await me(token);
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toMatchObject({
      profile_id,
      nickname: 'Tricolor_77',
      country: 'BR',
      age_band: '18plus',
      holder_adult: 'yes',
      capabilities: ['read', 'predict', 'write', 'redeem'],
    });
    // o mesmo Perfil, com Apelido novo e outra faixa: atualiza, não cria outro
    const again = await issue(t.key, { ...base, nickname: 'Tricolor_78', ageBand: '13_17' });
    expect(again.json().data.profile_id).toBe(profile_id);
    const after = await me(again.json().data.token);
    expect(after.json().data).toMatchObject({
      nickname: 'Tricolor_78',
      age_band: '13_17',
      holder_adult: 'unknown',
      capabilities: ['read', 'predict'],
    });
    const sql = postgres(testUrl, { max: 1 });
    const count = await sql`select count(*)::int as n from fan.profile where tenant_id = ${t.id}`;
    await sql.end();
    expect(count[0]!.n).toBe(1);
  });

  it('Apelido passa pelo filtro de moderação (#969): ofensa, aposta e lista do cliente recusam', async () => {
    const t = await tenantKey('fans-mod', ['core_data', 'live_chat']);
    for (const nickname of ['m4c4c0', 'bet365', 'porra']) {
      const r = await issue(t.key, { ...base, externalProfileId: `mod_${nickname}`, nickname });
      expect(r.statusCode, nickname).toBe(400);
      expect(r.json()).toMatchObject({ code: 'INVALID_PARAMS', errors: [{ path: 'nickname' }] });
    }
    expect(
      (await issue(t.key, { ...base, externalProfileId: 'mod_ok', nickname: 'Macaense_10' })).statusCode,
    ).toBe(201);
    // lista do cliente acrescenta termo (vale depois do cache de 60 s; aqui, um cliente novo)
    const t2 = await tenantKey('fans-mod-2', ['core_data', 'live_chat']);
    await db
      .insert(moderationList)
      .values({ tenantId: t2.id, list: 'hate', locale: 'pt', terms: ['gamba'], updatedBy: 'teste' });
    const r = await issue(t2.key, { ...base, externalProfileId: 'mod_gamba', nickname: 'Gambá' });
    expect(r.statusCode).toBe(400);
    // Apelido que já estava gravado não é filtrado de novo: a lista nova não tranca o login de quem já tem
    const ok = await issue(t2.key, { ...base, externalProfileId: 'mod_antigo', nickname: 'Tricolor' });
    expect(ok.statusCode).toBe(201);
    await db
      .update(fanProfile)
      .set({ nickname: 'Gambá' })
      .where(eq(fanProfile.id, ok.json().data.profile_id));
    expect(
      (await issue(t2.key, { ...base, externalProfileId: 'mod_antigo', nickname: 'Gambá' })).statusCode,
    ).toBe(201);
    // mudar para um Apelido que o filtro pega continua recusado
    expect(
      (await issue(t2.key, { ...base, externalProfileId: 'mod_antigo', nickname: 'm4c4c0' })).statusCode,
    ).toBe(400);
  });

  it('as listas iniciais gravadas pela migration 0091 são as de DEFAULT_MODERATION_LISTS', async () => {
    const rows = await db.select().from(moderationList).where(isNull(moderationList.tenantId));
    const got = Object.fromEntries(rows.map((r) => [`${r.list}:${r.locale}`, r.terms]));
    const d = DEFAULT_MODERATION_LISTS;
    const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];
    const want: Record<string, string[]> = {
      'allowed_domains:all': uniq(d.allowedDomains!.map(normalizeDomain)),
      'bet_domains:all': uniq(d.betDomains!.map(normalizeDomain)),
      'exceptions:all': uniq(d.exceptions!.map(normalizeTerm)),
    };
    for (const [cat, byLocale] of Object.entries(d.terms))
      for (const [loc, terms] of Object.entries(byLocale ?? {}))
        want[`${cat}:${loc}`] = uniq(terms!.map(normalizeTerm));
    expect(got).toEqual(want);
  });

  it('nenhuma coluna de e-mail, documento, telefone ou nascimento no schema fan', async () => {
    const sql = postgres(testUrl, { max: 1 });
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_schema = 'fan'`;
    await sql.end();
    const names = cols.map((c) => c.column_name).join(' ');
    expect(names).not.toMatch(/mail|cpf|document|phone|birth|password/);
  });

  it('PATCH muda visibilidade e time do coração, mesclando a visibilidade', async () => {
    const t = await tenantKey('fans-b', ['core_data', 'communities']);
    const { token } = (await issue(t.key, base)).json().data;
    const team = '0190f1c0-0000-7000-8000-00000000c0de';
    const a = await me(token, 'PATCH', { visibility: { avatar: 'private' }, favoriteTeamId: team });
    expect(a.statusCode).toBe(200);
    const b = await me(token, 'PATCH', { visibility: { badges: 'private' } });
    expect(b.json().data).toMatchObject({
      favorite_team_id: team,
      visibility: { avatar: 'private', badges: 'private' },
    });
    // o torcedor não troca Apelido nem faixa
    const bad = await me(token, 'PATCH', { nickname: 'outro' });
    expect(bad.statusCode).toBe(400);
  });

  it('exclusão anonimiza o Perfil, derruba o token na hora e é idempotente', async () => {
    const t = await tenantKey('fans-c', ['core_data', 'gamification']);
    const { token, profile_id } = (await issue(t.key, base)).json().data;
    const del = () =>
      app.inject({
        method: 'DELETE',
        url: '/v1/fans/acc_100/profiles/prof_100',
        headers: { 'x-galaxie-key': t.key },
      });
    expect((await del()).statusCode).toBe(204);
    expect((await me(token)).statusCode).toBe(401);
    expect((await del()).statusCode).toBe(204);
    const sql = postgres(testUrl, { max: 1 });
    const [row] = await sql`
      select external_profile_id, nickname, avatar_url, deleted_at from fan.profile where id = ${profile_id}`;
    const log = await sql`select requested_by from fan.erasure_log where profile_id = ${profile_id}`;
    await sql.end();
    expect(row).toMatchObject({ external_profile_id: null, nickname: null, avatar_url: null });
    expect(row!.deleted_at).not.toBeNull();
    expect(log).toHaveLength(1);
    expect(log[0]!.requested_by).toMatch(/^key:/);
    // o torcedor volta: Perfil novo, sem nada do antigo
    const back = await issue(t.key, base);
    expect(back.json().data.profile_id).not.toBe(profile_id);
  });

  it('o mesmo id externo em dois clientes vira dois Perfis; um cliente não exclui o do outro', async () => {
    const a = await tenantKey('fans-d', ['core_data', 'live_chat']);
    const b = await tenantKey('fans-e', ['core_data', 'live_chat']);
    const pa = (await issue(a.key, base)).json().data;
    const pb = (await issue(b.key, base)).json().data;
    expect(pa.profile_id).not.toBe(pb.profile_id);
    await app.inject({
      method: 'DELETE',
      url: '/v1/fans/acc_100/profiles/prof_100',
      headers: { 'x-galaxie-key': b.key },
    });
    expect((await me(pa.token)).statusCode).toBe(200);
    expect((await me(pb.token)).statusCode).toBe(401);
  });

  it('o banco recusa Perfil apontando para Conta de outro cliente', async () => {
    const a = await tenantKey('fans-f', ['core_data', 'live_chat']);
    const b = await tenantKey('fans-g', ['core_data', 'live_chat']);
    await issue(a.key, { ...base, externalAccountId: 'acc_f' });
    const sql = postgres(testUrl, { max: 1, onnotice: () => {} });
    const [acc] = await sql`select id from fan.account where tenant_id = ${a.id}`;
    await expect(
      sql`insert into fan.profile (tenant_id, account_id, external_profile_id, nickname, age_band, country, locale)
          values (${b.id}, ${acc!.id}, 'x', 'x', '18plus', 'BR', 'pt-BR')`,
    ).rejects.toThrow(/profile_account_fk/);
    await sql.end();
  });
});
