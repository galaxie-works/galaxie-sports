import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaDenylist, publicAssetUrl } from '@galaxie/apisports-client';
import {
  apiResponse,
  asset,
  event,
  eventIncident,
  footballFixture,
  person,
  providerMap,
  sport,
  type Database,
} from '@galaxie/db';
import { normalizePlayers, type ApiPlayerItem } from '@galaxie/providers';
import { runAssetMirror } from '../src/assets/asset-mirror.js';
import { PgAssetStore } from '../src/assets/asset-store.js';
import { MediaFetcher } from '../src/assets/media-fetcher.js';
import { InMemoryObjectStore, objectStoreFromEnv } from '../src/assets/object-store.js';
import { pendingPersonPhotoIds, playerPhotoUrl, registerPlayerPhotos } from '../src/assets/person-photos.js';
import { runPaletteBackfill } from '../src/assets/palette-backfill.js';
import { disposableDb } from './db.js';
import { FakeClock, fakeMediaFetch, fakePng } from './helpers.js';
import { encodePng } from './png.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';

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

describe('fotos de pessoas', () => {
  const DAY = 86_400_000;
  let fixtureSeq = 0;

  async function player(providerId: string, photoUrl?: string): Promise<string> {
    const photo = photoUrl
      ? (await db.insert(asset).values({ kind: 'player', sourceUrl: photoUrl }).returning())[0]!.id
      : null;
    const [p] = await db
      .insert(person)
      .values({ name: `Jogador ${providerId}`, photoAssetId: photo })
      .returning();
    await db.insert(providerMap).values({
      entityType: 'person',
      entityId: p!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId,
    });
    return p!.id;
  }

  async function fixture(daysAgo: number, players: number[], coach?: number): Promise<string> {
    const startsAt = new Date(Date.now() - daysAgo * DAY);
    const [e] = await db
      .insert(event)
      .values({ sport: 'football', startsAt, endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000) })
      .returning();
    const lineup = {
      coach: coach ? { id: coach, name: 'Técnico' } : null,
      startXI: players.slice(0, 1).map((id) => ({ player: { id, name: `J${id}` } })),
      substitutes: players.slice(1).map((id) => ({ player: { id, name: `J${id}` } })),
    };
    await db.insert(footballFixture).values({
      eventId: e!.id,
      providerFixtureId: 900_000 + ++fixtureSeq,
      summary: {},
      detail: { lineups: [lineup], events: [], players: [], statistics: [] },
    });
    return e!.id;
  }

  const photoOf = async (id: string) =>
    (await db.select({ photo: person.photoAssetId }).from(person).where(eq(person.id, id)))[0]!.photo;

  it('liga pela URL do id quem jogou, fora técnicos e fotos já sabidamente genéricas; prioriza os escalados recentes', async () => {
    await db
      .insert(sport)
      .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
      .onConflictDoNothing();
    const recent = await player('10');
    const old = await player('11');
    const coach = await player('12');
    const withPhoto = await player('13', 'https://media.api-sports.io/football/players/13.png');
    const scorer = await player('14');
    const nobody = await player('15');
    const knownPlaceholder = await player('16');
    await db.insert(asset).values({ kind: 'player', sourceUrl: playerPhotoUrl('16'), fetchedAt: new Date() });
    await fixture(10, [10, 12, 16]);
    await fixture(3, [13], 12);
    await fixture(400, [11]);
    const goal = await fixture(400, []);
    await db.insert(eventIncident).values({ eventId: goal, type: 'Goal', sequence: 1, personId: scorer });

    const since = new Date(Date.now() - 365 * DAY);
    const first = await registerPlayerPhotos(db, { since });
    expect(first).toEqual({ linked: [1, 0, 2], registered: 3, skippedMissing: 1 });
    const recentPhoto = await photoOf(recent);
    expect(recentPhoto).not.toBeNull();
    const [row] = await db.select().from(asset).where(eq(asset.id, recentPhoto!));
    expect(row).toMatchObject({ kind: 'player', sourceUrl: playerPhotoUrl('10') });
    expect(await photoOf(old)).not.toBeNull();
    expect(await photoOf(scorer)).not.toBeNull();
    expect(await photoOf(coach)).toBeNull();
    expect(await photoOf(nobody)).toBeNull();
    expect(await photoOf(knownPlaceholder)).toBeNull();

    expect(await registerPlayerPhotos(db, { since })).toEqual({
      linked: [0, 0, 0],
      registered: 0,
      skippedMissing: 1,
    });

    // espelho: escalados recentes do jogo mais novo para o mais velho; depois o resto, sem jogo por último
    expect(await pendingPersonPhotoIds(db, { since })).toEqual([
      await photoOf(withPhoto),
      recentPhoto,
      await photoOf(old),
      await photoOf(scorer),
    ]);

    // a foto genérica desliga a pessoa e o registro não a religa
    await new PgAssetStore(db).markMissing(recentPhoto!, new Date(), { detachPeople: true });
    expect(await photoOf(recent)).toBeNull();
    expect(await registerPlayerPhotos(db, { since })).toEqual({
      linked: [0, 0, 0],
      registered: 0,
      skippedMissing: 2,
    });
    expect(await pendingPersonPhotoIds(db, { since })).not.toContain(recentPhoto);
  });

  it('o normalizador não religa a foto de pessoa já sabidamente genérica, mas segue ligando as outras', async () => {
    const generic = playerPhotoUrl('20');
    await db.insert(asset).values({ kind: 'player', sourceUrl: generic, fetchedAt: new Date() });
    const profile = (id: number, photo: string) =>
      ({ player: { id, name: `Perfil ${id}`, photo }, statistics: [] }) as unknown as ApiPlayerItem;
    await upsertBatch(
      db,
      normalizePlayers([profile(20, generic), profile(21, playerPhotoUrl('21'))], new Date()),
    );
    const photoByProvider = async (providerId: string) => {
      const [m] = await db.select().from(providerMap).where(eq(providerMap.providerId, providerId));
      return photoOf(m!.entityId);
    };
    expect(await photoByProvider('20')).toBeNull();
    expect(await photoByProvider('21')).not.toBeNull();
  });
});

describe('cores dos times (core.asset.palette)', () => {
  it('backfill grava a paleta dos escudos PNG sem paleta; asset desvinculado perde a paleta', async () => {
    const store = new PgAssetStore(db);
    const objects = new InMemoryObjectStore();
    const crest = encodePng({
      width: 2,
      height: 1,
      colorType: 6,
      rows: [[0, 105, 55, 255, 255, 255, 255, 255]],
    });
    await objects.put('api-sports/football/teams/121.png', crest, 'image/png', 'x');

    // do teste anterior: só o escudo do Palmeiras é team_logo espelhado (o da NBB é logo de liga)
    expect(await store.paletteCandidates()).toHaveLength(1);
    expect(await runPaletteBackfill({ assets: store, objects })).toEqual({
      candidates: 1,
      saved: 1,
      monochrome: 0,
      skipped: 0,
    });
    const [row] = await db.select().from(asset).where(eq(asset.sourceUrl, PALMEIRAS));
    expect(row?.palette).toEqual({ version: 1, dominant: '#006937', secondary: null, monochrome: false });
    expect(await store.paletteCandidates()).toEqual([]);

    await store.markMissing(row!.id, new Date());
    const [gone] = await db.select().from(asset).where(eq(asset.sourceUrl, PALMEIRAS));
    expect(gone).toMatchObject({ storageKey: null, palette: null });
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
