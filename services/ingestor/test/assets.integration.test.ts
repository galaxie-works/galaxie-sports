import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaDenylist, publicAssetUrl } from '@galaxie/apisports-client';
import { apiResponse, asset, type Database } from '@galaxie/db';
import { runAssetMirror } from '../src/assets/asset-mirror.js';
import { PgAssetStore } from '../src/assets/asset-store.js';
import { MediaFetcher } from '../src/assets/media-fetcher.js';
import { InMemoryObjectStore, objectStoreFromEnv } from '../src/assets/object-store.js';
import { disposableDb } from './db.js';
import { FakeClock, fakeMediaFetch, fakePng } from './helpers.js';

const testDb = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await testDb.setup();
}, 60_000);
afterAll(() => testDb.teardown());

const BR = 'https://media.api-sports.io/flags/br.svg';
const PALMEIRAS = 'https://media.api-sports.io/football/teams/121.png';
const PAULISTAO = 'https://media.api-sports.io/football/leagues/475.png';
const NBB = 'https://media.api-sports.io/basketball/leagues/26.png';

async function saveRaw(sport: string, endpoint: string, body: unknown) {
  await db.insert(apiResponse).values({
    provider: 'api-sports',
    sport,
    apiVersion: 'v1',
    endpoint,
    params: {},
    requestHash: randomBytes(8).toString('hex'),
    statusCode: 200,
    body,
    bodyHash: randomBytes(8).toString('hex'),
  });
}

describe('PgAssetStore', () => {
  it('descobre URLs de mídia no raw (todas as APIs, hosts espelho) e registra sem duplicar', async () => {
    const store = new PgAssetStore(db);
    await db.insert(asset).values({ kind: 'flag', sourceUrl: BR });
    await saveRaw('football', '/teams', {
      response: [
        {
          team: { id: 121, logo: PALMEIRAS },
          venue: { image: 'https://media-2.api-sports.io/football/venues/1.png' },
        },
      ],
    });
    await saveRaw('basketball', '/leagues', {
      response: [
        { id: 26, logo: NBB, country: { flag: BR } },
        { id: 475, logo: PAULISTAO },
      ],
    });

    const urls = await store.discoverFromRaw();
    expect(urls).toEqual([
      NBB,
      BR,
      PAULISTAO,
      PALMEIRAS,
      'https://media.api-sports.io/football/venues/1.png',
    ]);
    expect(await store.register(urls)).toBe(4);
    expect(await store.register(urls)).toBe(0);
    const [venue] = await db
      .select()
      .from(asset)
      .where(eq(asset.sourceUrl, 'https://media.api-sports.io/football/venues/1.png'));
    expect(venue?.kind).toBe('venue');
    expect(await store.counts()).toEqual({ total: 5, stored: 0, missing: 0, pending: 5 });
  });

  it('espelha no storage, bloqueia o Paulistão e a segunda execução não baixa nada', async () => {
    await db.insert(asset).values({ kind: 'other', sourceUrl: 'https://upload.wikimedia.org/x.svg' });
    const store = new PgAssetStore(db);
    const objects = new InMemoryObjectStore();
    const clock = new FakeClock();
    const png = fakePng(200, 180, 64);
    const media = fakeMediaFetch({
      [BR]: [{ status: 200, body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="14"/>' }],
      [PALMEIRAS]: [{ status: 200, body: png, headers: { 'content-type': 'image/png' } }],
      [NBB]: [{ status: 200, body: fakePng(64, 64) }],
      'https://media.api-sports.io/football/venues/1.png': [{ status: 404 }],
    });
    const fetcher = new MediaFetcher({ fetch: media.fetch, clock });
    const denylist = new MediaDenylist([{ url: PAULISTAO, reason: 'escudo errado' }]);

    const first = await runAssetMirror({ assets: store, objects, fetcher, denylist, clock, concurrency: 2 });
    expect(first).toMatchObject({ pending: 5, stored: 3, notFound: 1, denied: 1, failed: 0 });
    expect(media.calls.map((c) => c.url)).not.toContain(PAULISTAO);

    const [row] = await db.select().from(asset).where(eq(asset.sourceUrl, PALMEIRAS));
    expect(row).toMatchObject({
      storageKey: 'api-sports/football/teams/121.png',
      sha256: createHash('sha256').update(png).digest('hex'),
      bytes: png.length,
      width: 200,
      height: 180,
    });
    expect(row!.fetchedAt).toBeInstanceOf(Date);
    expect(publicAssetUrl(row!.storageKey!, 'http://cdn.local/assets')).toBe(
      'http://cdn.local/assets/api-sports/football/teams/121.png',
    );
    const [paulistao] = await db.select().from(asset).where(eq(asset.sourceUrl, PAULISTAO));
    expect(paulistao?.storageKey).toBeNull();
    expect(paulistao?.fetchedAt).toBeInstanceOf(Date);
    expect(await store.counts()).toEqual({ total: 6, stored: 3, missing: 2, pending: 1 }); // a Wikimedia fica de fora

    const calls = media.calls.length;
    const second = await runAssetMirror({ assets: store, objects, fetcher, denylist, clock });
    expect(second).toMatchObject({ pending: 0, stored: 0 });
    expect(media.calls.length).toBe(calls);
  });
});

/** Só roda com o RustFS/S3 local configurado (S3_ENDPOINT...); usa um prefixo descartável e apaga ao final. */
describe.skipIf(!process.env.S3_ENDPOINT)('S3ObjectStore (RustFS local)', () => {
  it('grava, lê, consulta e apaga um objeto; a URL pública serve o arquivo', async () => {
    const objects = objectStoreFromEnv();
    const key = `test-${randomBytes(6).toString('hex')}/api-sports/flags/xx.svg`;
    const body = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>');
    const sha = createHash('sha256').update(body).digest('hex');
    try {
      await objects.put(key, body, 'image/svg+xml', sha);
      expect(await objects.head(key)).toEqual({
        bytes: body.length,
        contentType: 'image/svg+xml',
        sha256: sha,
      });
      expect(new TextDecoder().decode(await objects.get(key))).toContain('<svg');
      if (process.env.ASSETS_PUBLIC_BASE_URL) {
        const res = await fetch(publicAssetUrl(key, process.env.ASSETS_PUBLIC_BASE_URL));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/svg+xml');
      }
    } finally {
      await objects.delete(key);
      objects.close();
    }
    expect(await objectStoreFromEnv().head(key)).toBeUndefined();
  });
});
