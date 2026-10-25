import { randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  broadcastOption,
  closeDb,
  competition,
  createDb,
  event,
  runMigrations,
  sport,
  tenant,
  webhookDelivery,
  webhookEndpoint,
  type Database,
} from '@galaxie/db';
import { upsertTenant } from '../src/auth/admin.js';
import {
  createWebhookEndpoint,
  listDeadDeliveries,
  replayDeadDeliveries,
  sealWebhookSecrets,
  setWebhookActive,
  type WebhookInput,
} from '../src/webhooks/admin.js';
import { WebhookSecretBox } from '../src/webhooks/secret-box.js';
import { generateWebhookSecret, verifyWebhookSignature } from '../src/webhooks/signature.js';
import { WebhookWorker } from '../src/webhooks/worker.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  at: number;
}

let admin: postgres.Sql;
let db: Database;
let receiver: Server;
let base: string;
let worker: WebhookWorker;
let competitionId: string;
const received: Received[] = [];
/** Respostas programadas por caminho (fila); vazia → 200. */
const script: Record<string, number[]> = {};
const latencies: Record<string, number> = {};

const hits = (path: string) => received.filter((r) => r.path === path);
/** KEK do worker e da "CLI" deste teste. */
const secrets = new WebhookSecretBox([randomBytes(32).toString('base64')]);
const create = (input: WebhookInput) => createWebhookEndpoint(db, input, secrets);

async function newEvent(): Promise<string> {
  const now = Date.now();
  const [row] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId,
      startsAt: new Date(now - 10 * 60_000),
      endsAtExpected: new Date(now + 100 * 60_000),
      status: 'live',
      score: { home: 0, away: 0 },
    })
    .returning();
  return row!.id;
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'serie-a', name: 'Serie A', type: 'league', tier: 1 })
    .returning();
  competitionId = comp!.id;
  await upsertTenant(db, { slug: 'portal', name: 'Portal', plan: 'enterprise' });
  await upsertTenant(db, { slug: 'portal-ar', name: 'Portal AR', plan: 'enterprise', markets: ['AR'] });

  // servidor HTTP local que faz o papel do cliente
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      received.push({ path: req.url!, headers: req.headers, body, at: Date.now() });
      res.statusCode = script[req.url!]?.shift() ?? 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

  worker = new WebhookWorker(db, {
    baseDelayMs: 100,
    maxAttempts: 3,
    pollIntervalMs: 100,
    timeoutMs: 2_000,
    secrets,
  });
  await worker.start();
}, 60_000);

afterAll(async () => {
  await worker?.stop();
  await new Promise((r) => receiver?.close(r));
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
  if (Object.keys(latencies).length) console.log('latências webhook (ms):', latencies);
});

describe('webhooks assinados', () => {
  it('entrega a mudança com assinatura HMAC válida, idempotency key e cabeçalhos', async () => {
    const id = await newEvent();
    const ep = await create({
      tenantSlug: 'portal',
      url: `${base}/ok`,
      topics: ['score'],
      filters: { events: [id] },
    });
    const t0 = Date.now();
    await db
      .update(event)
      .set({ score: { home: 1, away: 0 } })
      .where(eq(event.id, id));
    await expect.poll(() => hits('/ok').length, { timeout: 5_000 }).toBe(1);
    const [hit] = hits('/ok');
    latencies.score = hit!.at - t0;

    expect(verifyWebhookSignature(ep.secret, hit!.body, hit!.headers['x-galaxie-signature'] as string)).toBe(
      true,
    );
    expect(
      verifyWebhookSignature('whsec_outro', hit!.body, hit!.headers['x-galaxie-signature'] as string),
    ).toBe(false);
    expect(hit!.headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'galaxie-sports-webhooks/0.1',
      'x-galaxie-event': 'event.score_changed',
      'x-galaxie-attempt': '1',
    });
    const body = JSON.parse(hit!.body);
    expect(body).toMatchObject({
      topic: 'event.score_changed',
      event_id: id,
      competition_id: competitionId,
      changed: ['score'],
      data: { score: { home: 1, away: 0 } },
    });
    expect(hit!.headers['idempotency-key']).toBe(`${ep.id}:${body.id}`);

    await expect
      .poll(
        async () => (await db.select().from(webhookDelivery).where(eq(webhookDelivery.endpointId, ep.id)))[0],
      )
      .toMatchObject({ status: 'delivered', attempts: 1, responseCode: 200 });

    // o enfileiramento é idempotente
    await worker.enqueue();
    expect(await db.select().from(webhookDelivery).where(eq(webhookDelivery.endpointId, ep.id))).toHaveLength(
      1,
    );
  });

  it('retenta com backoff exponencial após 500 e reenvia o mesmo corpo e idempotency key', async () => {
    const id = await newEvent();
    script['/flaky'] = [500, 503];
    const ep = await create({
      tenantSlug: 'portal',
      url: `${base}/flaky`,
      topics: ['status'],
      filters: { events: [id] },
    });
    await db.update(event).set({ status: 'break', statusDetail: 'HT' }).where(eq(event.id, id));
    await expect.poll(() => hits('/flaky').length, { timeout: 10_000 }).toBe(3);
    const attempts = hits('/flaky');
    expect(attempts.map((a) => a.headers['x-galaxie-attempt'])).toEqual(['1', '2', '3']);
    expect(new Set(attempts.map((a) => a.body)).size).toBe(1);
    expect(new Set(attempts.map((a) => a.headers['idempotency-key'])).size).toBe(1);
    // cada tentativa é assinada na hora do envio (t= atual) e é válida
    for (const a of attempts)
      expect(verifyWebhookSignature(ep.secret, a.body, a.headers['x-galaxie-signature'] as string)).toBe(
        true,
      );
    // ~100 ms e ~200 ms (±20%) entre as tentativas
    expect(attempts[1]!.at - attempts[0]!.at).toBeGreaterThanOrEqual(70);
    expect(attempts[2]!.at - attempts[1]!.at).toBeGreaterThanOrEqual(150);
    // o 3º POST chega ao servidor antes de o worker gravar o resultado: espera a gravação
    await expect
      .poll(
        async () =>
          (
            await db.select().from(webhookDelivery).where(eq(webhookDelivery.topic, 'event.status_changed'))
          )[0],
        { timeout: 5_000 },
      )
      .toMatchObject({ status: 'delivered', attempts: 3, responseCode: 200 });
  });

  it('após N falhas vai para a DLQ; replay recoloca na fila e entrega', async () => {
    const id = await newEvent();
    script['/down'] = [500, 500, 500];
    const ep = await create({
      tenantSlug: 'portal',
      url: `${base}/down`,
      topics: ['score'],
      filters: { events: [id] },
    });
    await db
      .update(event)
      .set({ score: { home: 0, away: 1 } })
      .where(eq(event.id, id));
    await expect
      .poll(async () => (await listDeadDeliveries(db, { endpointId: ep.id })).length, { timeout: 10_000 })
      .toBe(1);
    const [dead] = await listDeadDeliveries(db, { endpointId: ep.id });
    expect(dead).toMatchObject({ attempts: 3, responseCode: 500, lastError: 'HTTP 500' });
    expect(hits('/down')).toHaveLength(3);

    expect(await replayDeadDeliveries(db, { endpointId: ep.id })).toBe(1);
    await expect.poll(() => hits('/down').length, { timeout: 5_000 }).toBe(4);
    await expect
      .poll(async () => (await db.select().from(webhookDelivery).where(eq(webhookDelivery.id, dead!.id)))[0])
      .toMatchObject({ status: 'delivered', attempts: 1 });
  });

  it('respeita o contrato do tenant: onde assistir só para os mercados contratados', async () => {
    const id = await newEvent();
    await create({
      tenantSlug: 'portal-ar',
      url: `${base}/ar`,
      topics: ['where_to_watch'],
      filters: { events: [id] },
    });
    const option = (countryCode: string) => ({
      eventId: id,
      countryCode,
      providerName: 'Canal X',
      medium: 'free_tv' as const,
      accessModel: 'free' as const,
      status: 'confirmed' as const,
      confidence: '0.97',
      evidence: [],
      producedBy: 'editorial:teste',
    });
    await db.insert(broadcastOption).values(option('BR'));
    const t0 = Date.now();
    await db.insert(broadcastOption).values(option('AR'));
    await expect.poll(() => hits('/ar').length, { timeout: 5_000 }).toBe(1);
    latencies.where_to_watch = hits('/ar')[0]!.at - t0;
    await new Promise((r) => setTimeout(r, 300));
    expect(hits('/ar')).toHaveLength(1);
    expect(JSON.parse(hits('/ar')[0]!.body)).toMatchObject({
      topic: 'where_to_watch.changed',
      data: { countries: ['AR'] },
    });
  });

  it('webhook desativado não recebe; URL insegura é recusada no cadastro', async () => {
    const id = await newEvent();
    const ep = await create({
      tenantSlug: 'portal',
      url: `${base}/off`,
      filters: { events: [id] },
    });
    expect(await setWebhookActive(db, ep.id, false)).toBe(true);
    await db
      .update(event)
      .set({ score: { home: 2, away: 2 } })
      .where(eq(event.id, id));
    // O worker roda em segundo plano: uma rodada entre o cadastro (ativo) e a desativação pode enfileirar a
    // entrega do evento recém-criado. O que importa é que nada seja enviado: a linha, se existir, vira `dead`.
    // tick() devolve o ciclo em andamento quando há um; idle() espera também o ciclo coalescido, que já vê a
    // mudança acima — sem isso a fila "vazia" podia ser só a mudança ainda não enfileirada.
    await worker.tick();
    await worker.idle();
    const deliveries = () => db.select().from(webhookDelivery).where(eq(webhookDelivery.endpointId, ep.id));
    expect((await deliveries()).filter((d) => d.status === 'pending')).toHaveLength(0);
    expect(hits('/off')).toHaveLength(0);
    for (const d of await deliveries()) {
      expect(d).toMatchObject({ status: 'dead', lastError: 'endpoint desativado' });
    }

    await expect(create({ tenantSlug: 'portal', url: 'http://cliente.example/hook' })).rejects.toThrow(
      /https/,
    );
    await expect(create({ tenantSlug: 'nao-existe', url: `${base}/x` })).rejects.toThrow(/Tenant/);
  });

  it('segredo cifrado com a KEK no banco; legado em texto puro segue entregue e é migrado (auditoria API-9)', async () => {
    const id = await newEvent();
    const ep = await create({
      tenantSlug: 'portal',
      url: `${base}/sealed`,
      topics: ['score'],
      filters: { events: [id] },
    });
    const [stored] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, ep.id));
    expect(stored!.secret).toMatch(/^enc:v1:/);
    expect(stored!.secret).not.toContain(ep.secret.slice(6));

    // linha gravada antes da cifra: segredo em texto puro
    const legacySecret = generateWebhookSecret();
    const [tenantRow] = await db.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, 'portal'));
    const [legacy] = await db
      .insert(webhookEndpoint)
      .values({
        tenantId: tenantRow!.id,
        url: `${base}/legacy`,
        secret: legacySecret,
        topics: ['event.score_changed'],
        filters: { events: [id] },
      })
      .returning();

    await db
      .update(event)
      .set({ score: { home: 3, away: 0 } })
      .where(eq(event.id, id));
    await expect.poll(() => hits('/sealed').length + hits('/legacy').length, { timeout: 5_000 }).toBe(2);
    const sig = (h: Received) => h.headers['x-galaxie-signature'] as string;
    expect(verifyWebhookSignature(ep.secret, hits('/sealed')[0]!.body, sig(hits('/sealed')[0]!))).toBe(true);
    expect(verifyWebhookSignature(legacySecret, hits('/legacy')[0]!.body, sig(hits('/legacy')[0]!))).toBe(
      true,
    );

    // migração: cifra o legado (idempotente) e a entrega continua com o mesmo segredo
    expect((await sealWebhookSecrets(db, secrets)).sealed).toBe(1);
    expect((await sealWebhookSecrets(db, secrets)).sealed).toBe(0);
    const [migrated] = await db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, legacy!.id));
    expect(migrated!.secret).toMatch(/^enc:v1:/);
    expect(secrets.open(migrated!.secret)).toBe(legacySecret);
    await db
      .update(event)
      .set({ score: { home: 3, away: 1 } })
      .where(eq(event.id, id));
    await expect.poll(() => hits('/legacy').length, { timeout: 5_000 }).toBe(2);
    expect(verifyWebhookSignature(legacySecret, hits('/legacy')[1]!.body, sig(hits('/legacy')[1]!))).toBe(
      true,
    );
  });

  it('segredo cifrado com uma KEK que o worker não tem: nada é enviado, a entrega falha com erro explícito', async () => {
    const id = await newEvent();
    const other = new WebhookSecretBox([randomBytes(32).toString('base64')]);
    const ep = await createWebhookEndpoint(
      db,
      { tenantSlug: 'portal', url: `${base}/wrong-kek`, topics: ['score'], filters: { events: [id] } },
      other,
    );
    await db
      .update(event)
      .set({ score: { home: 4, away: 0 } })
      .where(eq(event.id, id));
    await expect
      .poll(async () => (await listDeadDeliveries(db, { endpointId: ep.id })).length, { timeout: 10_000 })
      .toBe(1);
    const [dead] = await listDeadDeliveries(db, { endpointId: ep.id });
    expect(dead!.lastError).toMatch(/^WebhookSecretError: .*KEK/);
    expect(hits('/wrong-kek')).toHaveLength(0);
    // sem KEK nenhuma, o cadastro é recusado (nunca grava texto puro)
    await expect(
      createWebhookEndpoint(db, { tenantSlug: 'portal', url: `${base}/x` }, new WebhookSecretBox([])),
    ).rejects.toThrow(/WEBHOOK_SIGNING_SECRET/);
  });
});
