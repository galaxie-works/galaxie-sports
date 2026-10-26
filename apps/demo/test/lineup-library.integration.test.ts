import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  createLineupReviewRequest,
  runMigrations,
  setLineupReviewStatus,
  setTenantOperator,
  tenant,
  upsertLineupDraft,
} from '@galaxie/db';

/*
 * Pedido "Falta um canal" da operadora, contra um Postgres descartável com as migrations reais: rádio não
 * é canal de grade, então não aparece na biblioteca nem é aceito como inclusão num plano.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const SRC = 'https://operadora.exemplo/planos';

let server: typeof import('../src/lib/lineup/server');
let tenantId: string;
let planId: string;

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await runMigrations(testUrl);
  const sql = new Client({ connectionString: testUrl });
  await sql.connect();
  await sql.query(
    `insert into enrich.broadcaster (id, name, kind, countries, markets) values
       ('tv-aberta', 'TV Aberta Exemplo', 'free_tv', '{BR}', '{}'),
       ('tv-paga', 'Canal Pago Exemplo', 'pay_tv', '{BR}', '{}'),
       ('streaming', 'Streaming Exemplo', 'streaming', '{BR}', '{}'),
       ('radio', 'Rádio Exemplo', 'radio', '{BR}', '{}'),
       ('tv-ar', 'TV Argentina Exemplo', 'free_tv', '{AR}', '{}')`,
  );
  await sql.end();

  // grade publicada da operadora do tenant: um plano aprovado com um canal
  const db = createDb(testUrl, { max: 2 });
  const draft = await upsertLineupDraft(db, {
    platform: {
      name: 'Operadora Exemplo',
      kind: 'pay_tv_operator',
      country: 'BR',
      website: 'https://operadora.exemplo',
      sources: [SRC],
    },
    plans: [
      {
        name: 'Plano Exemplo',
        url: `${SRC}/exemplo`,
        sources: [`${SRC}/exemplo`],
        channels: [{ channelId: 'tv-paga', access: 'included', sources: [`${SRC}/exemplo`] }],
      },
    ],
    seenAt: new Date('2026-10-20T12:00:00Z'),
  });
  planId = draft.planIds['plano-exemplo']!;
  await setLineupReviewStatus(db, { type: 'platform', id: draft.platformId }, 'approved', 'teste');
  await setLineupReviewStatus(db, { type: 'plan', id: planId }, 'approved', 'teste');
  const [t] = await db
    .insert(tenant)
    .values({ slug: 'operadora-exemplo', name: 'Operadora Exemplo', plan: 'fan_experience', modules: [] })
    .returning({ id: tenant.id });
  tenantId = t!.id;
  await setTenantOperator(db, tenantId, { platformId: draft.platformId });
  // pedido de rádio gravado antes do filtro: continua na lista do cliente
  await createLineupReviewRequest(db, {
    tenantId,
    userId: 'u1',
    target: { type: 'plan_channel', planId, channelId: 'radio' },
    message: 'Falta esta rádio',
  });
  await closeDb(db);

  // o pool da demo lê a URL ao ser importado
  process.env.DEMO_DATABASE_URL = testUrl;
  server = await import('../src/lib/lineup/server');
});

afterAll(async () => {
  const { pool } = await import('../src/lib/auth/db');
  await pool.end();
  const { builderDb } = await import('../src/lib/builder/store');
  await closeDb(builderDb());
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('readCountryLibrary', () => {
  it('canais de TV e streamings do país, sem rádio', async () => {
    const library = await server.readCountryLibrary('BR');
    expect(library.map((e) => [e.id, e.kind])).toEqual([
      ['tv-paga', 'pay_tv'],
      ['streaming', 'streaming'],
      ['tv-aberta', 'free_tv'],
    ]);
  });
});

describe('findOperatorTarget', () => {
  it('aceita canal de TV como plan_channel e streaming como plan_service', async () => {
    expect(await server.findOperatorTarget(tenantId, 'plan_channel', `${planId}:tv-aberta`)).toEqual({
      item: null,
      adding: true,
    });
    expect(await server.findOperatorTarget(tenantId, 'plan_service', `${planId}:streaming`)).toEqual({
      item: null,
      adding: true,
    });
  });

  it('recusa rádio (e o tipo trocado)', async () => {
    expect(await server.findOperatorTarget(tenantId, 'plan_channel', `${planId}:radio`)).toBeNull();
    expect(await server.findOperatorTarget(tenantId, 'plan_service', `${planId}:radio`)).toBeNull();
    expect(await server.findOperatorTarget(tenantId, 'plan_service', `${planId}:tv-aberta`)).toBeNull();
  });
});

describe('readOperatorPortal', () => {
  it('pedido de rádio já gravado mostra o nome, não o id; a biblioteca segue sem rádio', async () => {
    const portal = await server.readOperatorPortal(tenantId);
    expect(portal.requests.map((r) => r.targetName)).toEqual(['Rádio Exemplo']);
    expect(portal.library.map((e) => e.id)).not.toContain('radio');
  });
});
