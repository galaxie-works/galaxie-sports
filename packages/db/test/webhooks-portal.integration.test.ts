import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  runMigrations,
  tenant,
  webhookDelivery,
  webhookEndpoint,
  type Database,
} from '../src/index.js';
import {
  createTenantWebhook,
  deleteTenantWebhook,
  listTenantWebhookDeliveries,
  listTenantWebhooks,
  MAX_WEBHOOKS_PER_TENANT,
  readWebhookControls,
  replayTenantWebhookDead,
  rotateTenantWebhookSecret,
  sealWebhookSecrets,
  setWebhookDelivery,
  setWebhookRejectPlaintext,
  webhookAdminOverview,
  sendTenantWebhookTest,
  setTenantWebhookActive,
  WEBHOOK_TEST_TOPIC,
  WebhookControlError,
  WebhookPortalError,
  WebhookSecretBox,
} from '../src/webhooks.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;
let tenantA: string;
let tenantB: string;
let trial: string;
const box = new WebhookSecretBox(['k'.repeat(32)]);
const input = (url: string) => ({ url, topics: [], filters: {}, description: null });

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  const rows = await db
    .insert(tenant)
    .values([
      { slug: 'portal-a', name: 'Portal A', plan: 'core_data', modules: ['core_data'] },
      { slug: 'portal-b', name: 'Portal B', plan: 'core_data', modules: ['core_data'] },
      { slug: 'avaliacao', name: 'Avaliação', plan: 'trial', modules: ['core_data'] },
    ])
    .returning({ id: tenant.id });
  [tenantA, tenantB, trial] = rows.map((r) => r.id) as [string, string, string];
});

afterAll(async () => {
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('webhooks no portal do cliente', () => {
  it('cadastra com o segredo cifrado (só aparece no retorno) e lista só os do tenant', async () => {
    const { id, secret } = await createTenantWebhook(db, tenantA, input('https://a.example/hook'), box);
    expect(secret).toMatch(/^whsec_/);
    const [row] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, id));
    expect(row!.secret.startsWith('enc:v1:')).toBe(true);
    expect(box.open(row!.secret, id)).toBe(secret);
    expect((await listTenantWebhooks(db, tenantA)).map((w) => w.id)).toEqual([id]);
    expect(await listTenantWebhooks(db, tenantB)).toEqual([]);
  });

  it('recusa sem KEK, no trial e acima do teto', async () => {
    await expect(
      createTenantWebhook(db, tenantB, input('https://b.example/hook'), new WebhookSecretBox([])),
    ).rejects.toMatchObject({ code: 'no_kek' });
    await expect(createTenantWebhook(db, trial, input('https://t.example/hook'), box)).rejects.toMatchObject({
      code: 'plan',
    });
    for (let i = 0; i < MAX_WEBHOOKS_PER_TENANT; i++)
      await createTenantWebhook(db, tenantB, input(`https://b.example/${i}`), box);
    const err = await createTenantWebhook(db, tenantB, input('https://b.example/x'), box).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookPortalError);
    expect(err.code).toBe('limit');
  });

  it('outro tenant não rotaciona, desativa, testa, reenvia nem apaga', async () => {
    const [mine] = await listTenantWebhooks(db, tenantA);
    expect(await rotateTenantWebhookSecret(db, tenantB, mine!.id, box)).toBeNull();
    expect(await setTenantWebhookActive(db, tenantB, mine!.id, false)).toBe(false);
    expect(await sendTenantWebhookTest(db, tenantB, mine!.id)).toBeNull();
    expect(await listTenantWebhookDeliveries(db, tenantB, mine!.id)).toEqual([]);
    expect(await deleteTenantWebhook(db, tenantB, mine!.id)).toBe(false);
    expect((await listTenantWebhooks(db, tenantA))[0]!.active).toBe(true);
  });

  it('rotação troca o segredo e o antigo deixa de abrir', async () => {
    const [mine] = await listTenantWebhooks(db, tenantA);
    const [before] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, mine!.id));
    const fresh = await rotateTenantWebhookSecret(db, tenantA, mine!.id, box);
    const [after] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, mine!.id));
    expect(fresh).toMatch(/^whsec_/);
    expect(box.open(after!.secret, mine!.id)).toBe(fresh);
    expect(box.open(before!.secret, mine!.id)).not.toBe(fresh);
  });

  it('teste entra na fila com change_id negativo; desativado não testa; DLQ volta para a fila', async () => {
    const [mine] = await listTenantWebhooks(db, tenantA);
    const id = await sendTenantWebhookTest(db, tenantA, mine!.id, new Date('2026-11-02T00:00:00Z'));
    const [d] = await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, id!));
    expect(d).toMatchObject({ topic: WEBHOOK_TEST_TOPIC, status: 'pending', attempts: 0 });
    expect(d!.changeId).toBeLessThan(0);
    expect(d!.payload).toMatchObject({ topic: WEBHOOK_TEST_TOPIC, test: true });

    await db
      .update(webhookDelivery)
      .set({ status: 'dead', attempts: 10, lastError: 'HTTP 500', lastAttemptAt: new Date() })
      .where(eq(webhookDelivery.id, id!));
    let [w] = await listTenantWebhooks(db, tenantA);
    expect(w).toMatchObject({ pending: 0, dead: 1, lastError: 'HTTP 500' });
    expect(await replayTenantWebhookDead(db, tenantB, mine!.id)).toBe(0);
    expect(await replayTenantWebhookDead(db, tenantA, mine!.id)).toBe(1);
    [w] = await listTenantWebhooks(db, tenantA);
    expect(w).toMatchObject({ pending: 1, dead: 0 });
    const deliveries = await listTenantWebhookDeliveries(db, tenantA, mine!.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: 'pending', attempts: 0, lastError: null });

    // tenant suspenso ou que passou a trial: o worker não enviaria, então o teste nem entra na fila
    await db.update(tenant).set({ status: 'suspended' }).where(eq(tenant.id, tenantA));
    expect(await sendTenantWebhookTest(db, tenantA, mine!.id)).toBeNull();
    await db.update(tenant).set({ status: 'active', plan: 'trial' }).where(eq(tenant.id, tenantA));
    expect(await sendTenantWebhookTest(db, tenantA, mine!.id)).toBeNull();
    await db.update(tenant).set({ plan: 'core_data' }).where(eq(tenant.id, tenantA));

    expect(await setTenantWebhookActive(db, tenantA, mine!.id, false)).toBe(true);
    expect(await sendTenantWebhookTest(db, tenantA, mine!.id)).toBeNull();
  });

  it('apagar leva o histórico junto', async () => {
    const [mine] = await listTenantWebhooks(db, tenantA);
    expect(await deleteTenantWebhook(db, tenantA, mine!.id)).toBe(true);
    expect(await listTenantWebhooks(db, tenantA)).toEqual([]);
    expect(await db.select().from(webhookDelivery).where(eq(webhookDelivery.endpointId, mine!.id))).toEqual(
      [],
    );
  });
});

describe('controle da operação (Ajustes → Webhooks)', () => {
  it('não recusa texto puro com legado no banco; cifrar libera; histórico e padrão do env', async () => {
    const [legacy] = await db
      .insert(webhookEndpoint)
      .values({ tenantId: tenantB, url: 'https://legado.example/hook', secret: 'whsec_legado' })
      .returning({ id: webhookEndpoint.id });
    let o = await webhookAdminOverview(db);
    expect(o.plaintextSecrets).toBe(1);
    expect(o.worker).toMatchObject({ alive: false, kekConfigured: null, reportedAt: null });
    expect(o.controls).toEqual({ deliveryEnabled: true, rejectPlaintext: false });

    const err = await setWebhookRejectPlaintext(db, true, 'teste').catch((e) => e);
    expect(err).toBeInstanceOf(WebhookControlError);
    expect(err.code).toBe('plaintext_left');

    await expect(sealWebhookSecrets(db, new WebhookSecretBox([]))).rejects.toMatchObject({ code: 'no_kek' });
    expect(await sealWebhookSecrets(db, box)).toMatchObject({ sealed: 1, failed: [] });
    const [row] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, legacy!.id));
    expect(box.open(row!.secret, legacy!.id)).toBe('whsec_legado');

    await setWebhookRejectPlaintext(db, true, 'teste');
    await setWebhookDelivery(db, false, 'teste');
    o = await webhookAdminOverview(db);
    expect(o.plaintextSecrets).toBe(0);
    expect(o.controls).toEqual({ deliveryEnabled: false, rejectPlaintext: true });

    // o painel desligou explicitamente: vale mesmo com o env do worker pedindo recusa
    await setWebhookRejectPlaintext(db, false, 'teste');
    await setWebhookDelivery(db, true, 'teste');
    expect(await readWebhookControls(db, { WEBHOOK_REJECT_PLAINTEXT_SECRETS: 'true' })).toEqual({
      deliveryEnabled: true,
      rejectPlaintext: false,
    });
    const log = await db.execute<{ key: string; n: number }>(
      sql`select key, count(*)::int as n from ops.runtime_setting_log group by key order by key`,
    );
    expect([...log]).toEqual([
      { key: 'WEBHOOK_DELIVERY', n: 2 },
      { key: 'WEBHOOK_REJECT_PLAINTEXT_SECRETS', n: 2 },
    ]);
  });
});
