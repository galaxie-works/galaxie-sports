/**
 * Logo enviado no painel (Ajustes → Grades e ofertas), ponta a ponta: o arquivo passa pela validação e pela
 * sanitização (`uploadLogo` de `@galaxie/where-to-watch`, o mesmo que a demo chama), vai para o storage com
 * o nome no padrão dos logos, é registrado e ligado na entidade, o change feed purga as respostas em cache e
 * a API passa a servir a URL do storage — sem nenhum passo manual. Voltar ao anterior também purga.
 * Contra o Postgres e o Valkey de desenvolvimento; o storage é um em memória (o mesmo contrato `put`).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  broadcaster,
  broadcastOption,
  closeDb,
  competition,
  createDb,
  event,
  platform,
  revertCustomLogo,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import { uploadLogo, type LogoObjectStore } from '@galaxie/where-to-watch';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-logo-upload-${randomBytes(4).toString('hex')}:`;
const ASSETS = 'https://assets.exemplo.test/galaxie-sports-assets';
const ADMIN = 'admin@exemplo.test';

/** Storage em memória com o contrato do S3ObjectStore. */
class MemoryObjects implements LogoObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string; sha256: string }>();
  async put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void> {
    this.objects.set(key, { body, contentType, sha256 });
  }
}

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
let eventId: string;
let platformId: string;
const objects = new MemoryObjects();

const get = (url: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'liga-exemplo', name: 'Liga Exemplo', type: 'league', tier: 1 })
    .returning();
  const kickoff = new Date(Date.now() + 2 * 24 * 3_600_000);
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: comp!.id,
      startsAt: kickoff,
      endsAtExpected: new Date(kickoff.getTime() + 7_200_000),
    })
    .returning();
  eventId = ev!.id;
  // canal da biblioteca sem logo nenhum (nem origem): a API publica `logo: null`
  await db
    .insert(broadcaster)
    .values({ id: 'canal_exemplo', name: 'Canal Exemplo', kind: 'pay_tv', countries: ['BR'], markets: {} });
  await db.insert(broadcastOption).values({
    eventId,
    countryCode: 'BR',
    providerName: 'Canal Exemplo',
    broadcasterId: 'canal_exemplo',
    medium: 'pay_tv',
    accessModel: 'subscription',
    status: 'confirmed',
    confidence: '0.95',
    evidence: [],
    producedBy: 'editorial:teste',
  });
  const [p] = await db
    .insert(platform)
    .values({
      slug: 'br-operadora-exemplo',
      name: 'Operadora Exemplo',
      kind: 'pay_tv_operator',
      country: 'BR',
      reviewStatus: 'approved',
    })
    .returning({ id: platform.id });
  platformId = p!.id;

  const t = await upsertTenant(db, {
    slug: 'logo-upload',
    name: 'logo-upload',
    plan: 'fan_experience',
    markets: ['BR'],
  });
  key = (await createApiKey(db, t.id, { env: 'test' })).key;
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usage: false,
    assetsBaseUrl: ASSETS,
    changeFeed: { pollIntervalMs: 100 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (found.length) await redis.del(...found);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const svg = (color: string) =>
  new TextEncoder().encode(
    `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" onload="alert(1)">` +
      `<script>alert(1)</script><rect width="120" height="40" fill="${color}"/></svg>`,
  );

describe('logo enviado no painel até a URL servida pela API', () => {
  const broadcasterLogo = async () =>
    (await get('/v1/broadcasters/canal_exemplo')).json().logo as { url: string } | null;
  const wtwLogo = async () =>
    (
      (await get(`/v1/events/${eventId}/where-to-watch?country=BR`)).json().options as {
        logo: string | null;
      }[]
    )[0]!.logo;

  it('canal: grava sanitizado no storage com o nome do padrão, liga e purga o cache das respostas', async () => {
    expect(await broadcasterLogo()).toBeNull();
    expect(await wtwLogo()).toBeNull();
    // em cache: sem o purge, a API continuaria servindo `null`
    expect((await get('/v1/broadcasters/canal_exemplo')).headers['x-galaxie-cache']).toBe('HIT');
    expect((await get(`/v1/events/${eventId}/where-to-watch?country=BR`)).headers['x-galaxie-cache']).toBe(
      'HIT',
    );

    const res = await uploadLogo(db, objects, {
      target: { type: 'broadcaster', id: 'canal_exemplo' },
      body: svg('#123456'),
      by: ADMIN,
    });
    const stored = objects.objects.get(res.storageKey)!;
    const text = new TextDecoder().decode(stored.body);
    expect(stored.contentType).toBe('image/svg+xml');
    expect(text).not.toMatch(/script|onload/);
    expect(res.storageKey).toBe(
      `broadcasters/${createHash('sha256').update(stored.body).digest('hex').slice(0, 16)}.svg`,
    );

    const url = `${ASSETS}/${res.storageKey}`;
    await expect.poll(async () => (await broadcasterLogo())?.url, { timeout: 5_000, interval: 50 }).toBe(url);
    await expect.poll(wtwLogo, { timeout: 5_000, interval: 50 }).toBe(url);
  });

  it('voltar ao logo anterior também purga e a API volta a servir o anterior', async () => {
    const first = (await broadcasterLogo())!.url;
    const second = await uploadLogo(db, objects, {
      target: { type: 'broadcaster', id: 'canal_exemplo' },
      body: svg('#654321'),
      by: ADMIN,
    });
    await expect
      .poll(async () => (await broadcasterLogo())?.url, { timeout: 5_000, interval: 50 })
      .toBe(`${ASSETS}/${second.storageKey}`);
    expect(await revertCustomLogo(db, { type: 'broadcaster', id: 'canal_exemplo' }, ADMIN)).toBe(true);
    await expect
      .poll(async () => (await broadcasterLogo())?.url, { timeout: 5_000, interval: 50 })
      .toBe(first);
  });

  it('plataforma: o logo enviado sai em /v1/platforms (purga pelo trigger da grade)', async () => {
    const logo = async () =>
      ((await get('/v1/platforms?country=BR')).json().data as { id: string; logo: string | null }[]).find(
        (p) => p.id === platformId,
      )!.logo;
    expect(await logo()).toBeNull();
    expect((await get('/v1/platforms?country=BR')).headers['x-galaxie-cache']).toBe('HIT');
    // PNG de 256×256 (só a assinatura e o IHDR importam para a validação)
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 256);
    new DataView(png.buffer).setUint32(20, 256);
    const res = await uploadLogo(db, objects, {
      target: { type: 'platform', id: platformId },
      body: png,
      by: ADMIN,
    });
    expect(res.storageKey).toMatch(/^platforms\/[0-9a-f]{16}\.png$/);
    await expect.poll(logo, { timeout: 5_000, interval: 50 }).toBe(`${ASSETS}/${res.storageKey}`);
  });

  it('arquivo recusado não grava nada', async () => {
    const before = objects.objects.size;
    await expect(
      uploadLogo(db, objects, {
        target: { type: 'broadcaster', id: 'canal_exemplo' },
        body: new TextEncoder().encode('<html><script>alert(1)</script></html>'),
        by: ADMIN,
      }),
    ).rejects.toThrow();
    expect(objects.objects.size).toBe(before);
  });
});
