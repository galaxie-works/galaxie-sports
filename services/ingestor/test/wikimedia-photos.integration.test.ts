import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, person, providerMap, type Database } from '@galaxie/db';
import { PgAssetStore } from '../src/assets/asset-store.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import {
  mirrorWikimediaPhotos,
  saveWikimediaPhotos,
  type CommonsImage,
  type PhotoMatch,
} from '../src/assets/wikimedia-photos.js';
import { disposableDb } from './db.js';
import { fakePng } from './helpers.js';

const testDb = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await testDb.setup();
}, 60_000);
afterAll(() => testDb.teardown());

async function personWithMap(providerId: string, name: string, photoAssetId: string | null = null) {
  const [p] = await db.insert(person).values({ name, photoAssetId }).returning();
  await db
    .insert(providerMap)
    .values({ entityType: 'person', entityId: p!.id, provider: 'api-sports', sport: 'football', providerId });
  return p!.id;
}

const image = (file: string): CommonsImage => ({
  file,
  thumbUrl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(file)}/400px.jpg`,
  descriptionUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  author: 'Fulano',
  mime: 'image/png',
});

describe('fotos do Wikimedia', () => {
  it('grava licença e autor, liga só quem não tem foto, guarda o QID e espelha', async () => {
    const noPhoto = await personWithMap('933886', 'Pedro Emanuel');
    const coach = await personWithMap('coach:2803', 'Rui Borges');
    const [existing] = await db
      .insert(asset)
      .values({ kind: 'player', sourceUrl: 'https://x/ja.png' })
      .returning();
    const hasPhoto = await personWithMap('777', 'Já Tem', existing!.id);
    const match = (personId: string, providerId: string, qid: string, file: string): PhotoMatch => ({
      candidate: {
        personId,
        providerId,
        name: '',
        fullName: null,
        birthDate: '1975-02-11',
        nationality: null,
      },
      person: { qid, birthDate: '1975-02-11', labels: [], countries: [], image: file },
    });
    const images = new Map([
      ['Pedro.jpg', image('Pedro.jpg')],
      ['Rui.jpg', image('Rui.jpg')],
      ['JaTem.jpg', image('JaTem.jpg')],
    ]);
    const report = await saveWikimediaPhotos(
      db,
      [
        match(noPhoto, '933886', 'Q933886', 'Pedro.jpg'),
        match(coach, 'coach:2803', 'Q2803', 'Rui.jpg'),
        match(hasPhoto, '777', 'Q777', 'JaTem.jpg'),
        match(noPhoto, '933886', 'Q9', 'SemLicenca.jpg'),
      ],
      images,
    );
    expect(report).toEqual({ linked: 2, notFree: 1, skipped: 1 });

    const [p] = await db.select().from(person).where(eq(person.id, noPhoto));
    const [a] = await db.select().from(asset).where(eq(asset.id, p!.photoAssetId!));
    expect(a).toMatchObject({
      kind: 'player',
      origin: 'wikimedia',
      license: 'CC BY-SA 4.0',
      author: 'Fulano',
      attributionUrl: 'https://commons.wikimedia.org/wiki/File:Pedro.jpg',
    });
    const [c] = await db.select().from(person).where(eq(person.id, coach));
    expect((await db.select().from(asset).where(eq(asset.id, c!.photoAssetId!)))[0]!.kind).toBe('coach');
    expect((await db.select().from(person).where(eq(person.id, hasPhoto)))[0]!.photoAssetId).toBe(
      existing!.id,
    );
    const qids = await db
      .select({ q: providerMap.providerId })
      .from(providerMap)
      .where(and(eq(providerMap.provider, 'wikidata'), eq(providerMap.entityId, noPhoto)));
    expect(qids).toEqual([{ q: 'Q933886' }]);

    // espelho: baixa só as duas novas (quem já tinha foto não ganha asset)
    const objects = new InMemoryObjectStore();
    const png = fakePng(400, 400, 7);
    const fake = (async () =>
      new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch;
    const mirrored = await mirrorWikimediaPhotos(db, new PgAssetStore(db), objects, {
      fetch: fake,
      sleep: async () => {},
    });
    expect(mirrored).toMatchObject({ stored: 2, failed: 0 });
    const [stored] = await db.select().from(asset).where(eq(asset.id, p!.photoAssetId!));
    expect(stored!.storageKey).toMatch(/^wikimedia\/people\/[0-9a-f]{64}\.png$/);
    expect(stored).toMatchObject({ width: 400, height: 400, license: 'CC BY-SA 4.0' });
    // idempotente
    expect(
      await mirrorWikimediaPhotos(db, new PgAssetStore(db), objects, { fetch: fake, sleep: async () => {} }),
    ).toMatchObject({
      stored: 0,
    });
  });
});
