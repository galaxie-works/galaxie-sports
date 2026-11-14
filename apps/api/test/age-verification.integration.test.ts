import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson } from '@galaxie/engage';
import { closeDb, createDb, runMigrations, type Database } from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { MemoryModuleUsageMeter } from '../src/engage/module-usage.js';
import { buildServer } from '../src/server.js';
import { DiditClient } from '../src/age-verification/didit.js';
import { sweepAgeVerifications } from '../src/age-verification/service.js';

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
// segredo fictício montado na hora (o gitleaks lê literal com cara de chave como segredo)
const SECRET = ['segredo', 'webhook', 'teste'].join('-');
const WORKFLOW = 'wf-idade';

let pg: postgres.Sql;
let sql: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
const meter = new MemoryModuleUsageMeter();

/** O Didit de mentira: sessões criadas, a decisão que cada uma devolve e os apagamentos. */
const didit = {
  seq: 0,
  sessions: new Map<string, { vendorData: string; callback?: string; decision: Record<string, unknown> }>(),
  deleted: [] as string[],
  decisionCalls: 0,
};
const fakeFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const u = new URL(url);
  if (init.method === 'POST' && u.pathname === '/v3/session/') {
    const body = JSON.parse(String(init.body));
    const id = `00000000-0000-4000-8000-${String(++didit.seq).padStart(12, '0')}`;
    didit.sessions.set(id, {
      vendorData: body.vendor_data,
      callback: body.callback,
      decision: { status: 'Not Started' },
    });
    return Response.json(
      { session_id: id, url: `https://verify.didit.test/s/${id}`, expires_at: '2099-01-01T00:00:00Z' },
      { status: 201 },
    );
  }
  const m = /^\/v3\/session\/([\w-]+)\/(decision|delete)\/$/.exec(u.pathname);
  const s = m ? didit.sessions.get(m[1]!) : undefined;
  if (!m || !s) return new Response(null, { status: 404 });
  if (m[2] === 'decision') {
    didit.decisionCalls += 1;
    return Response.json({ session_id: m[1], workflow_id: WORKFLOW, ...s.decision });
  }
  didit.deleted.push(m[1]!);
  return Response.json({ session_id: m[1], face_retention_outcome: 'deleted' });
};

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usagePersist: false,
    moduleUsage: meter,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: new FanTokenSigner({ secret: 's'.repeat(48) }),
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
    ageVerification: {
      apiKey: 'chave-didit',
      workflowId: WORKFLOW,
      webhookSecrets: [SECRET],
      baseUrl: 'https://didit.test',
      fetch: fakeFetch,
    },
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
  await sql?.end();
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

let fanSeq = 0;
async function fanToken(key: string, extra: Record<string, unknown> = {}) {
  fanSeq += 1;
  const body = {
    externalAccountId: `acc_${fanSeq}`,
    externalProfileId: `prof_${fanSeq}`,
    nickname: `Torcedor_${fanSeq}`,
    ageBand: '18plus',
    country: 'BR',
    locale: 'pt-BR',
    ...extra,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fans/tokens',
    headers: { 'x-galaxie-key': key },
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return { token: res.json().data.token as string, profileId: res.json().data.profile_id as string, body };
}

const consent = { givenAt: new Date(Date.now() - 60_000).toISOString(), textVersion: 'v1' };
const start = (token: string, payload: object = { returnUrl: 'https://cliente.test/volta', consent }) =>
  app.inject({
    method: 'POST',
    url: '/v1/fans/me/age-verification',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
const latest = (token: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/fans/me/age-verification',
    headers: { authorization: `Bearer ${token}` },
  });

let eventSeq = 0;
function webhook(sessionId: string, opts: { eventId?: string; secret?: string; vendorData?: string } = {}) {
  const s = didit.sessions.get(sessionId);
  const payload = {
    event_id: opts.eventId ?? `evt-${++eventSeq}`,
    webhook_type: 'status.updated',
    session_id: sessionId,
    status: String(s?.decision.status ?? 'Approved'),
    vendor_data: opts.vendorData ?? s?.vendorData ?? null,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const sig = createHmac('sha256', opts.secret ?? SECRET)
    .update(canonicalJson(payload))
    .digest('hex');
  return app.inject({
    method: 'POST',
    url: '/webhooks/didit/age-verification',
    headers: {
      'content-type': 'application/json',
      'x-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-signature-v2': sig,
    },
    payload: JSON.stringify(payload),
  });
}

const sessionOf = async (verificationId: string) =>
  (
    (await sql`select provider_session_id from fan.age_verification where id = ${verificationId}`) as unknown as [
      { provider_session_id: string },
    ]
  )[0].provider_session_id;
const profileRow = async (profileId: string) =>
  (
    (await sql`select age_assurance, age_assurance_provider from fan.profile where id = ${profileId}`) as unknown as [
      { age_assurance: string; age_assurance_provider: string | null },
    ]
  )[0];
const waitPurge = async (sessionId: string) => {
  for (let i = 0; i < 50 && !didit.deleted.includes(sessionId); i++)
    await new Promise((r) => setTimeout(r, 20));
};

describe('verificação de idade da Galaxie (#1109)', () => {
  it('abre a sessão, aplica a aprovação pelo rosto, mede, apaga no provedor e mantém no próximo token', async () => {
    const t = await tenantKey('idade-a', ['core_data', 'live_chat', 'age_verification']);
    const fan = await fanToken(t.key);
    const res = await start(fan.token);
    expect(res.statusCode).toBe(201);
    const started = res.json().data;
    expect(started).toMatchObject({
      status: 'pending',
      method: null,
      url: expect.stringMatching(/^https:\/\//),
    });
    const sessionId = await sessionOf(started.verification_id);
    // a referência que foi ao provedor é o id da verificação, nunca o do torcedor
    expect(didit.sessions.get(sessionId)!.vendorData).toBe(started.verification_id);

    didit.sessions.get(sessionId)!.decision = {
      status: 'Approved',
      liveness_checks: [{ status: 'Approved', age_estimation: 29.5 }],
      face_matches: null,
    };
    const hook = await webhook(sessionId, { eventId: 'evt-aprovada' });
    expect(hook.statusCode).toBe(200);
    expect(hook.json()).toMatchObject({ outcome: 'applied' });
    expect(await profileRow(fan.profileId)).toEqual({
      age_assurance: 'estimated',
      age_assurance_provider: 'galaxie:didit',
    });
    expect((await latest(fan.token)).json().data).toMatchObject({ status: 'approved', method: 'estimated' });
    const usage = await meter.read(new Date().toISOString().slice(0, 7));
    expect(usage.find((u) => u.tenantId === t.id && u.metric === 'age_checks_estimate')?.value).toBe(1);
    await waitPurge(sessionId);
    expect(didit.deleted).toContain(sessionId);

    // o mesmo evento de novo: nada muda e não mede duas vezes
    const calls = didit.decisionCalls;
    expect((await webhook(sessionId, { eventId: 'evt-aprovada' })).json()).toMatchObject({
      outcome: 'duplicate',
    });
    expect(didit.decisionCalls).toBe(calls);
    // evento novo de sessão já decidida: não reabre
    expect((await webhook(sessionId)).json()).toMatchObject({ outcome: 'final' });

    // o cliente pede outro token só com `self`: a comprovação da Galaxie fica
    await app.inject({
      method: 'POST',
      url: '/v1/fans/tokens',
      headers: { 'x-galaxie-key': t.key },
      payload: fan.body,
    });
    expect(await profileRow(fan.profileId)).toMatchObject({ age_assurance: 'estimated' });
    // a faixa desce: a comprovação de adulto não fica
    await app.inject({
      method: 'POST',
      url: '/v1/fans/tokens',
      headers: { 'x-galaxie-key': t.key },
      payload: { ...fan.body, ageBand: '16_17' },
    });
    expect(await profileRow(fan.profileId)).toMatchObject({ age_assurance: 'self' });
  });

  it('documento aprovado mede como documento; aprovação manual de quem tem 15 estimados não comprova', async () => {
    const t = await tenantKey('idade-b', ['core_data', 'live_chat', 'age_verification']);
    const a = await fanToken(t.key);
    const sa = await sessionOf((await start(a.token)).json().data.verification_id);
    didit.sessions.get(sa)!.decision = {
      status: 'Approved',
      liveness_checks: [{ status: 'Approved', age_estimation: 18.4 }],
      id_verifications: [{ status: 'Approved', date_of_birth: '2000-01-01' }],
      face_matches: [{ status: 'Approved' }],
    };
    expect((await webhook(sa)).statusCode).toBe(200);
    expect(await profileRow(a.profileId)).toMatchObject({ age_assurance: 'verified' });

    const b = await fanToken(t.key);
    const sb = await sessionOf((await start(b.token)).json().data.verification_id);
    didit.sessions.get(sb)!.decision = {
      status: 'Approved',
      liveness_checks: [{ status: 'Approved', age_estimation: 15.1 }],
    };
    expect((await webhook(sb)).statusCode).toBe(200);
    expect(await profileRow(b.profileId)).toMatchObject({ age_assurance: 'self' });
    expect((await latest(b.token)).json().data).toMatchObject({ status: 'review', method: null });

    const usage = await meter.read(new Date().toISOString().slice(0, 7));
    expect(usage.find((u) => u.tenantId === t.id && u.metric === 'age_checks_document')?.value).toBe(1);
    expect(usage.find((u) => u.tenantId === t.id && u.metric === 'age_checks_estimate')?.value).toBe(1);
  });

  it('webhook sem assinatura válida, de sessão que não é nossa ou com a referência trocada não muda nada', async () => {
    const t = await tenantKey('idade-c', ['core_data', 'live_chat', 'age_verification']);
    const fan = await fanToken(t.key);
    const sid = await sessionOf((await start(fan.token)).json().data.verification_id);
    didit.sessions.get(sid)!.decision = {
      status: 'Approved',
      liveness_checks: [{ status: 'Approved', age_estimation: 40 }],
    };
    expect((await webhook(sid, { secret: 'outro' })).statusCode).toBe(401);
    expect((await webhook(sid, { vendorData: 'outra-ref' })).json()).toMatchObject({ outcome: 'unknown' });
    didit.sessions.set('99999999-0000-4000-8000-000000000000', { vendorData: 'x', decision: {} });
    expect((await webhook('99999999-0000-4000-8000-000000000000')).json()).toMatchObject({
      outcome: 'unknown',
    });
    expect(await profileRow(fan.profileId)).toMatchObject({ age_assurance: 'self' });
  });

  it('sem o módulo 403, menor de 13 não faz, consentimento no corpo é obrigatório e o dia tem limite', async () => {
    const without = await tenantKey('idade-d', ['core_data', 'live_chat']);
    expect((await start((await fanToken(without.key)).token)).statusCode).toBe(403);
    const t = await tenantKey('idade-e', ['core_data', 'live_chat', 'age_verification']);
    expect((await start((await fanToken(t.key, { ageBand: 'under13' })).token)).statusCode).toBe(403);
    const fan = await fanToken(t.key);
    expect((await start(fan.token, { returnUrl: 'https://cliente.test/volta' })).statusCode).toBe(400);
    expect((await start(fan.token, { returnUrl: 'http://cliente.test', consent })).statusCode).toBe(400);
    // em paralelo: o limite vale sob a trava, nem uma a mais
    const codes = (await Promise.all(Array.from({ length: 7 }, () => start(fan.token)))).map(
      (r) => r.statusCode,
    );
    expect(codes.filter((c) => c === 201)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
    expect((await latest(fan.token)).json().data).toMatchObject({ status: 'pending' });
  });

  it('só origem e caminho do returnUrl vão ao provedor', async () => {
    const t = await tenantKey('idade-g', ['core_data', 'live_chat', 'age_verification']);
    const fan = await fanToken(t.key);
    const res = await start(fan.token, {
      returnUrl: 'https://cliente.test/volta?email=a%40b.test&token=x#perfil',
      consent,
    });
    expect(res.statusCode).toBe(201);
    const sid = await sessionOf(res.json().data.verification_id);
    expect(didit.sessions.get(sid)?.callback).toBe('https://cliente.test/volta');
  });

  it('a varredura expira a pendente vencida e apaga no provedor o que ficou decidido sem apagar', async () => {
    const t = await tenantKey('idade-h', ['core_data', 'live_chat', 'age_verification']);
    const fan = await fanToken(t.key);
    const a = await start(fan.token);
    const b = await start(fan.token);
    const sidA = await sessionOf(a.json().data.verification_id);
    const sidB = await sessionOf(b.json().data.verification_id);
    await sql`update fan.age_verification set expires_at = now() - interval '1 hour' where provider_session_id = ${sidA}`;
    // decidida e não apagada (o apagamento logo depois do webhook falhou)
    await sql`update fan.age_verification set status = 'declined', decided_at = now() where provider_session_id = ${sidB}`;
    const client = new DiditClient(
      { apiKey: 'chave-didit', workflowId: WORKFLOW, baseUrl: 'https://didit.test' },
      fakeFetch,
    );
    const r = await sweepAgeVerifications(db, client, new Date());
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(didit.deleted).toEqual(expect.arrayContaining([sidA, sidB]));
    const rows = (await sql`select provider_session_id, status, purged_at from fan.age_verification
      where provider_session_id in (${sidA}, ${sidB})`) as unknown as Array<{
      provider_session_id: string;
      status: string;
      purged_at: Date | null;
    }>;
    expect(rows.every((x) => x.purged_at !== null)).toBe(true);
    expect(rows.find((x) => x.provider_session_id === sidA)?.status).toBe('expired');
  });

  it('o cliente não manda comprovação com o prefixo da Galaxie', async () => {
    const t = await tenantKey('idade-f', ['core_data', 'live_chat']);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/fans/tokens',
      headers: { 'x-galaxie-key': t.key },
      payload: {
        externalAccountId: 'acc_x',
        externalProfileId: 'prof_x',
        nickname: 'Torcedor_x',
        ageBand: '18plus',
        country: 'BR',
        locale: 'pt-BR',
        ageAssurance: { method: 'verified', at: '2026-11-01', provider: 'galaxie:didit' },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
