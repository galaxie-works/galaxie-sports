import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  creditPoints,
  debitBalance,
  revertPoints,
  runMigrations,
  type Database,
} from '@galaxie/db';
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

describe('carteira de pontos (#938)', () => {
  const wallet = (token: string, path = '', query = '') =>
    app.inject({
      method: 'GET',
      url: `/v1/fans/me/wallet${path}${query}`,
      headers: { authorization: `Bearer ${token}` },
    });

  it('mostra Pontos, Saldo e o extrato do programa, com estorno e resgate', async () => {
    const t = await tenantKey('wallet-a', ['core_data', 'gamification']);
    const { token, profile_id } = (await issue(t.key, { ...base, externalProfileId: 'prof_w1' })).json().data;
    expect((await wallet(token)).json()).toEqual({ data: [] });
    const k = { tenantId: t.id, profileId: profile_id, programCountry: 'BR' };
    for (let i = 0; i < 3; i += 1)
      await creditPoints(db, {
        ...k,
        amount: 10,
        reason: 'prediction',
        source: 'gamification',
        sourceEvent: `p${i}`,
      });
    await revertPoints(db, { ...k, reason: 'prediction', source: 'gamification', sourceEvent: 'p1' });
    await debitBalance(db, { ...k, amount: 5, source: 'gamification', sourceEvent: 'r1' });
    const w = await wallet(token);
    expect(w.statusCode).toBe(200);
    expect(w.headers['cache-control']).toBe('no-store');
    expect(w.json()).toEqual({ data: [{ program_country: 'BR', points: 20, balance: 15 }] });
    const page1 = await wallet(token, '/ledger', '?limit=3');
    expect(page1.statusCode).toBe(200);
    const body = page1.json();
    expect(body.program_country).toBe('BR');
    expect(body.data.map((e: { reason: string }) => e.reason)).toEqual(['redeem', 'revert', 'prediction']);
    expect(body.data[1].reverts_id).not.toBeNull();
    const page2 = (await wallet(token, '/ledger', `?limit=3&before=${body.next_before}`)).json();
    expect(page2.data).toHaveLength(2);
    expect(page2.next_before).toBeNull();
    expect((await wallet(token, '/ledger', '?limit=0')).statusCode).toBe(400);
  });

  it('menor de 13 recebe 403; outro cliente não vê a carteira', async () => {
    const t = await tenantKey('wallet-b', ['core_data', 'gamification']);
    const kid = (await issue(t.key, { ...base, externalProfileId: 'prof_kid', ageBand: 'under13' })).json()
      .data;
    expect((await wallet(kid.token)).statusCode).toBe(403);
    const adult = (await issue(t.key, { ...base, externalProfileId: 'prof_w2' })).json().data;
    await creditPoints(db, {
      tenantId: t.id,
      profileId: adult.profile_id,
      programCountry: 'BR',
      amount: 7,
      reason: 'poll',
      source: 'communities',
      sourceEvent: 'e1',
    });
    const other = await tenantKey('wallet-c', ['core_data', 'gamification']);
    const theirs = (await issue(other.key, { ...base, externalProfileId: 'prof_w2' })).json().data;
    expect((await wallet(theirs.token)).json()).toEqual({ data: [] });
    expect((await wallet(adult.token)).json().data[0].points).toBe(7);
    // exclusão do Perfil leva a carteira e o extrato junto
    await app.inject({
      method: 'DELETE',
      url: '/v1/fans/acc_100/profiles/prof_w2',
      headers: { 'x-galaxie-key': t.key },
    });
    const sql = postgres(testUrl, { max: 1 });
    const left = await sql`select
      (select count(*)::int from fan.wallet where profile_id = ${adult.profile_id}) as w,
      (select count(*)::int from fan.points_ledger where profile_id = ${adult.profile_id}) as l`;
    await sql.end();
    expect(left[0]).toEqual({ w: 0, l: 0 });
  });
});
