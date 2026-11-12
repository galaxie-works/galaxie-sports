import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MODERATION_LISTS, normalizeDomain, normalizeTerm } from '@galaxie/engage';
import { eq, isNull } from 'drizzle-orm';
import {
  closeDb,
  createDb,
  creditPoints,
  debitBalance,
  fanProfile,
  moderationList,
  revertPoints,
  runMigrations,
  type Database,
} from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanAgeGate } from '../src/engage/age-gate.js';
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
  // o Brasil pede comprovação estimada para os recursos sociais (ficha do #1104, portão do #1106)
  ageAssurance: { method: 'estimated', at: '2026-11-01' },
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
      // 13 no Brasil sem a autorização do responsável: o portão (#1106) não libera nada
      capabilities: [],
    });
    const sql = postgres(testUrl, { max: 1 });
    const count = await sql`select count(*)::int as n from fan.profile where tenant_id = ${t.id}`;
    await sql.end();
    expect(count[0]!.n).toBe(1);
  });

  it('faixa fina, comprovação e responsável (#1105): o estado sai da ficha do país', async () => {
    const t = await tenantKey('fans-idade', ['core_data', 'live_chat']);
    const teen = {
      ...base,
      externalProfileId: 'prof_teen',
      ageBand: '14_15',
      ageAssurance: { method: 'estimated', at: '2026-11-01', provider: 'Estimador X' },
      guardian: { status: 'granted', linkedAccount: true },
    };
    const res = await issue(t.key, teen);
    expect(res.statusCode).toBe(201);
    const read = (await me(res.json().data.token)).json().data;
    expect(read).toMatchObject({
      age_band: '13_17',
      age_band_detail: '14_15',
      age_assurance: { method: 'estimated', at: '2026-11-01T00:00:00.000Z' },
      guardian: { status: 'granted', linked_account: true },
      age_status: 'read_only',
      capabilities: ['read', 'predict'],
    });
    // sem vínculo, no Brasil (vínculo abaixo de 16), falta o responsável
    const unlinked = await issue(t.key, { ...teen, guardian: { status: 'granted' } });
    expect((await me(unlinked.json().data.token)).json().data.age_status).toBe('needs_guardian');
    // autorização declarada pelo cliente (sem consentId) fica na auditoria, uma vez
    const sql = postgres(testUrl, { max: 1 });
    const rows = await sql`select action, reason from engage.moderation_audit
      where tenant_id = ${t.id} and action = 'guardian.declared'`;
    // faixa larga antiga vale como 13; adulto declarado no Brasil precisa comprovar
    const legacy = await issue(t.key, { ...base, externalProfileId: 'prof_legacy', ageBand: '13_17' });
    const adult = await issue(t.key, { ...base, externalProfileId: 'prof_adult', ageAssurance: undefined });
    await sql.end();
    expect(rows).toEqual([{ action: 'guardian.declared', reason: 'autorização declarada pelo cliente' }]);
    expect((await me(legacy.json().data.token)).json().data).toMatchObject({
      age_band: '13_17',
      age_band_detail: '13',
      age_status: 'needs_guardian',
    });
    expect((await me(adult.json().data.token)).json().data.age_status).toBe('needs_verification');
  });

  it('faixa que desce de adulto congela e vai para a fila de moderação (#1105)', async () => {
    const t = await tenantKey('fans-desce', ['core_data', 'live_chat']);
    const who = {
      ...base,
      externalProfileId: 'prof_desce',
      ageAssurance: { method: 'verified', at: '2026-11-01' },
    };
    const first = await issue(t.key, who);
    const profileId = first.json().data.profile_id;
    expect((await me(first.json().data.token)).json().data.age_status).toBe('can_write');
    await issue(t.key, { ...who, ageBand: '14_15' });
    // o cliente sobe de novo para adulto: continua sem escrever nem resgatar até a correção da faixa
    const back = await issue(t.key, who);
    expect((await me(back.json().data.token)).json().data).toMatchObject({
      age_band: '13_17',
      age_band_detail: '18plus',
      // congelado vale a faixa larga gravada (13): no Brasil, sem responsável
      age_status: 'needs_guardian',
      capabilities: [],
    });
    const sql = postgres(testUrl, { max: 1 });
    const cases = await sql`select source, target_type, target_id, reasons, detail from engage.moderation_case
      where tenant_id = ${t.id}`;
    await sql.end();
    expect(cases).toEqual([
      {
        source: 'filter',
        target_type: 'profile',
        target_id: profileId,
        reasons: ['age_band_downgrade'],
        detail: { filter: { from: '18plus', to: '14_15' } },
      },
    ]);
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

  it('as listas iniciais gravadas pela migration 0093 são as de DEFAULT_MODERATION_LISTS', async () => {
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

describe('portão de idade (#1106)', () => {
  const wallet = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/fans/me/wallet', headers: { authorization: `Bearer ${token}` } });
  const teen = {
    ...base,
    externalProfileId: 'prof_portao',
    ageBand: '14_15',
    guardian: { status: 'granted', linkedAccount: true },
  };

  it('recusa com o motivo e o próximo passo; o /me continua aberto para o cliente ver o estado', async () => {
    const t = await tenantKey('fans-portao', ['core_data', 'live_chat']);
    const token = (await issue(t.key, { ...teen, guardian: undefined })).json().data.token as string;
    const res = await wallet(token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'FAN_AGE_RESTRICTED',
      age_gate: { reason: 'guardian_consent', next: 'guardian_consent' },
    });
    expect((await me(token)).statusCode).toBe(200);
    // com a autorização e o vínculo, o token antigo já passa: o portão relê o Perfil, não o token
    await issue(t.key, teen);
    expect((await wallet(token)).statusCode).toBe(200);
    // adulto sem a comprovação que o Brasil pede
    const adult = (
      await issue(t.key, { ...base, externalProfileId: 'prof_portao_a', ageAssurance: undefined })
    ).json().data.token as string;
    expect((await wallet(adult)).json().age_gate).toEqual({ reason: 'age_assurance', next: 'verify_age' });
    // a recusa entra na métrica por motivo, capacidade e país, sem o torcedor
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toMatch(
      /galaxie_fan_age_denied_total\{reason="guardian_consent",capability="read",country="BR"\} [1-9]/,
    );
    expect(metrics.body).not.toContain('prof_portao');
  });

  it('revogação da autorização corta o token em uso na hora neste processo e no prazo do cache nos outros', async () => {
    const t = await tenantKey('fans-revoga', ['core_data', 'live_chat']);
    const first = (await issue(t.key, teen)).json().data;
    expect((await wallet(first.token)).statusCode).toBe(200);
    // o cliente avisa a revogação pedindo outro token: o antigo para de valer na próxima ação
    await issue(t.key, { ...teen, guardian: { status: 'revoked', linkedAccount: true } });
    expect((await wallet(first.token)).json().age_gate).toEqual({
      reason: 'guardian_consent',
      next: 'guardian_consent',
    });

    // outro processo, com o Perfil no cache: a revogação gravada no banco vale quando o cache vence
    await issue(t.key, teen);
    let clock = 1_000_000;
    const other = new FanAgeGate(db, { now: () => clock });
    const fan = { tenantId: t.id, profileId: first.profile_id as string, country: 'BR' };
    expect((await other.check(fan, 'read')).allowed).toBe(true);
    await db.update(fanProfile).set({ guardianStatus: 'revoked' }).where(eq(fanProfile.id, fan.profileId));
    expect((await other.check(fan, 'read')).allowed).toBe(true);
    clock += 5_001;
    expect(await other.check(fan, 'read')).toMatchObject({ allowed: false, reason: 'guardian_consent' });
  });

  it('a ficha do país que mudou vale na próxima ação, sem esperar o token vencer', async () => {
    const t = await tenantKey('fans-ficha', ['core_data', 'live_chat']);
    const token = (await issue(t.key, { ...base, externalProfileId: 'prof_ficha', country: 'us' })).json()
      .data.token as string;
    expect((await wallet(token)).statusCode).toBe(200);
    // o cliente endurece a ficha dos EUA: comprovação verificada para os recursos sociais
    const sql = postgres(testUrl, { max: 1 });
    await sql`insert into engage.tenant_country (tenant_id, country, is_primary, hardening, updated_by)
      values (${t.id}, 'US', true, ${sql.json({ ageAssuranceMin: { social: 'verified' } })}, 'teste')
      on conflict (tenant_id, country) do update set hardening = excluded.hardening`;
    await sql.end();
    await new Promise((r) => setTimeout(r, 5_100));
    expect((await wallet(token)).json().age_gate).toEqual({ reason: 'age_assurance', next: 'verify_age' });
  });
});

describe('padrão protetivo para menores (#1107)', () => {
  it('menor não guarda foto própria, fica privado e não abre o Perfil; adulto escolhe', async () => {
    const t = await tenantKey('fans-menor', ['core_data', 'live_chat']);
    const teen = {
      ...base,
      externalProfileId: 'prof_menor',
      ageBand: '16_17',
      avatarUrl: 'https://cdn.exemplo.com/foto.jpg',
      locale: 'es-AR',
    };
    const token = (await issue(t.key, teen)).json().data.token as string;
    const read = (await me(token)).json().data;
    expect(read.avatar_url).toBeNull();
    expect(read.visibility).toEqual({
      avatar: 'private',
      favorite_team: 'private',
      level: 'private',
      badges: 'private',
    });
    expect(read.minor_protections.map((p: { id: string }) => p.id)).toContain('no_marketing');
    expect(read.minor_protections[0].title).toMatch(/apodo/);
    const open = await me(token, 'PATCH', { visibility: { level: 'public' } });
    expect(open.statusCode).toBe(403);
    expect(open.json().age_gate).toEqual({ reason: 'adult_only' });
    // fechar o que já é fechado pode
    expect((await me(token, 'PATCH', { visibility: { level: 'private' } })).statusCode).toBe(200);

    const adult = (await issue(t.key, { ...teen, externalProfileId: 'prof_maior', ageBand: '18plus' })).json()
      .data.token as string;
    const a = (await me(adult)).json().data;
    expect(a.avatar_url).toBe('https://cdn.exemplo.com/foto.jpg');
    expect(a.minor_protections).toEqual([]);
    expect((await me(adult, 'PATCH', { visibility: { level: 'public' } })).json().data.visibility.level).toBe(
      'public',
    );
    // a faixa desce: o que estava aberto volta ao padrão na gravação, e nada reabre sozinho depois
    await issue(t.key, { ...teen, externalProfileId: 'prof_maior', ageBand: '16_17' });
    const [row] = await db
      .select({ visibility: fanProfile.visibility, avatarUrl: fanProfile.avatarUrl })
      .from(fanProfile)
      .where(eq(fanProfile.externalProfileId, 'prof_maior'));
    expect(row).toEqual({ visibility: {}, avatarUrl: null });
    // foto gravada antes do #1107 num Perfil de menor não sai no /me
    await db
      .update(fanProfile)
      .set({ avatarUrl: 'https://cdn.exemplo.com/antiga.jpg' })
      .where(eq(fanProfile.externalProfileId, 'prof_menor'));
    expect((await me(token)).json().data.avatar_url).toBeNull();
  });
});

describe('mudança de faixa (#1110)', () => {
  const wallet = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/fans/me/wallet', headers: { authorization: `Bearer ${token}` } });
  const audits = async (tenantId: string, action: string) => {
    const sql = postgres(testUrl, { max: 1 });
    const rows = await sql`select rules, reason from engage.moderation_audit
      where tenant_id = ${tenantId} and action = ${action} order by created_at`;
    await sql.end();
    return rows.map((r) => ({ rules: r.rules, reason: r.reason }));
  };

  it('aniversários no Brasil: 13 → 14_15 → 16_17 → 18plus, sem pedir o que não precisa nem abrir o Perfil', async () => {
    const t = await tenantKey('fans-aniversario', ['core_data', 'live_chat']);
    const who = { ...base, externalProfileId: 'prof_aniv' };
    const guardian = { status: 'granted', linkedAccount: true };
    const t13 = (await issue(t.key, { ...who, ageBand: '13', guardian })).json().data.token as string;
    expect((await wallet(t13)).statusCode).toBe(200);
    // 14_15 sem a autorização: o Brasil ainda pede abaixo de 16
    const t14 = (await issue(t.key, { ...who, ageBand: '14_15' })).json().data.token as string;
    expect((await wallet(t14)).json().age_gate).toEqual({
      reason: 'guardian_consent',
      next: 'guardian_consent',
    });
    // 16_17: a autorização e o vínculo deixam de ser exigidos; escrever e resgatar continuam fechados
    const t16 = (await issue(t.key, { ...who, ageBand: '16_17' })).json().data.token as string;
    expect((await wallet(t16)).statusCode).toBe(200);
    expect((await me(t16)).json().data.capabilities).not.toContain('write');
    // 18: escreve e resgata, mas o Perfil continua fechado até o torcedor escolher (#1107)
    const t18 = (await issue(t.key, { ...who, ageBand: '18plus' })).json().data.token as string;
    const adult = (await me(t18)).json().data;
    expect(adult.capabilities).toEqual(expect.arrayContaining(['write', 'redeem']));
    expect(adult.visibility).toEqual({});
    expect(adult.minor_protections).toEqual([]);
    // a auditoria guarda só a troca de faixa, nunca uma data
    expect(await audits(t.id, 'age.band_changed')).toEqual([
      { rules: { from: '13', to: '14_15' }, reason: null },
      { rules: { from: '14_15', to: '16_17' }, reason: null },
      { rules: { from: '16_17', to: '18plus' }, reason: null },
    ]);
  });

  it('a faixa congelada só volta a adulto com uma comprovação feita depois do congelamento', async () => {
    const t = await tenantKey('fans-corrige', ['core_data', 'live_chat']);
    const who = {
      ...base,
      externalProfileId: 'prof_corrige',
      ageAssurance: { method: 'verified', at: '2026-11-01' },
    };
    await issue(t.key, who);
    await issue(t.key, { ...who, ageBand: '14_15' });
    // o token volta a dizer adulto com a comprovação antiga: continua congelado
    const old = (await issue(t.key, who)).json().data.token as string;
    expect((await me(old)).json().data.age_band).toBe('13_17');
    // declaração não basta, mesmo nova
    const self = (
      await issue(t.key, { ...who, ageAssurance: { method: 'self', at: new Date().toISOString() } })
    ).json().data.token as string;
    expect((await me(self)).json().data.age_band).toBe('13_17');
    // verificação nova: volta a adulto, e o caso sai da fila da equipe do cliente
    const fresh = (
      await issue(t.key, { ...who, ageAssurance: { method: 'verified', at: new Date().toISOString() } })
    ).json().data.token as string;
    expect((await me(fresh)).json().data).toMatchObject({ age_band: '18plus', age_status: 'can_write' });
    const sql = postgres(testUrl, { max: 1 });
    const cases = await sql`select status, resolved_by from engage.moderation_case where tenant_id = ${t.id}`;
    await sql.end();
    expect(cases).toEqual([{ status: 'resolved', resolved_by: expect.stringMatching(/^key:/) }]);
    expect(await audits(t.id, 'age.unfrozen')).toEqual([
      { rules: { method: 'verified' }, reason: 'age.reassured' },
    ]);
    // e descer de novo congela de novo
    await issue(t.key, { ...who, ageBand: '16_17' });
    const again = (await issue(t.key, who)).json().data.token as string;
    expect((await me(again)).json().data.age_band).toBe('13_17');
  });

  it('mudar de país aplica a ficha nova: a autorização que o Brasil dispensa aos 16 o México pede', async () => {
    const t = await tenantKey('fans-pais', ['core_data', 'live_chat']);
    const who = { ...base, externalProfileId: 'prof_pais', ageBand: '16_17' };
    expect((await wallet((await issue(t.key, who)).json().data.token)).statusCode).toBe(200);
    const mx = (await issue(t.key, { ...who, country: 'mx', locale: 'es-MX' })).json().data.token as string;
    expect((await wallet(mx)).json().age_gate).toEqual({
      reason: 'guardian_consent',
      next: 'guardian_consent',
    });
  });
});
