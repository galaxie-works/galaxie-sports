import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, assetCredit, person, providerMap, type Database } from '@galaxie/db';
import type { CommonsFile, WikimediaClient } from '../src/assets/commons/client.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import { importPeoplePhotos, type PhotoMatch } from '../src/assets/wikimedia-photos.js';
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

const file = (title: string, license: string): CommonsFile => ({
  title,
  pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
  url: `https://upload.wikimedia.org/${encodeURIComponent(title)}`,
  thumbUrl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}/800px.png`,
  thumbWidth: 800,
  thumbHeight: 800,
  width: 2000,
  height: 2000,
  mime: 'image/png',
  extmetadata: {
    LicenseShortName: { value: license },
    License: { value: license.toLowerCase().replace(/ /g, '-') },
    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
    Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Fulano">Fulano</a>' },
  },
  categories: [],
});

describe('fotos de pessoas da Commons', () => {
  it('baixa, grava o crédito, liga só quem não tem foto e guarda o QID; segunda execução não muda nada', async () => {
    const noPhoto = await personWithMap('933886', 'Pedro Emanuel');
    const coach = await personWithMap('coach:2803', 'Rui Borges');
    const [existing] = await db
      .insert(asset)
      .values({ kind: 'player', sourceUrl: 'https://x/ja.png' })
      .returning();
    const hasPhoto = await personWithMap('777', 'Já Tem', existing!.id);
    const match = (personId: string, providerId: string, qid: string, image: string): PhotoMatch => ({
      candidate: {
        personId,
        providerId,
        name: '',
        fullName: null,
        birthDate: '1975-02-11',
        nationality: null,
      },
      person: { qid, birthDate: '1975-02-11', labels: [], countries: [], image },
    });
    const files = [
      file('File:Pedro Emanuel.jpg', 'CC BY-SA 4.0'),
      file('File:Rui Borges.jpg', 'CC BY-SA 4.0'),
      file('File:Ja Tem.jpg', 'CC BY-SA 4.0'),
      file('File:Nao Livre.jpg', 'CC BY-NC 2.0'),
    ];
    const downloads: string[] = [];
    const png = fakePng(800, 800, 7);
    const client = {
      imageInfo: async (titles: string[]) => files.filter((f) => titles.includes(f.title)),
      download: async (url: string) => {
        downloads.push(url);
        return { body: png, contentType: 'image/png' };
      },
    } as unknown as WikimediaClient;
    const store = new InMemoryObjectStore();
    const matches = [
      match(noPhoto, '933886', 'Q933886', 'Pedro_Emanuel.jpg'),
      match(coach, 'coach:2803', 'Q2803', 'Rui Borges.jpg'),
      match(hasPhoto, '777', 'Q777', 'Ja Tem.jpg'),
      match(noPhoto, '933886', 'Q9', 'Nao Livre.jpg'),
    ];
    const report = await importPeoplePhotos(db, store, client, matches);
    expect(report).toMatchObject({ linked: 2, notFree: 1, skipped: 1 });
    expect(downloads).toHaveLength(2);

    const [p] = await db.select().from(person).where(eq(person.id, noPhoto));
    const [a] = await db.select().from(asset).where(eq(asset.id, p!.photoAssetId!));
    expect(a).toMatchObject({
      kind: 'player',
      origin: 'commons',
      sourceUrl: 'commons://File:Pedro Emanuel.jpg',
      width: 800,
    });
    expect(a!.storageKey).toMatch(new RegExp(`^commons/people/${noPhoto}\\.[0-9a-f]{12}\\.png$`));
    const [c] = await db.select().from(assetCredit).where(eq(assetCredit.assetId, a!.id));
    expect(c).toMatchObject({
      source: 'wikimedia-commons',
      title: 'File:Pedro Emanuel.jpg',
      author: 'Fulano',
      license: 'CC BY-SA 4.0',
      shareAlike: true,
      originalWidth: 2000,
    });
    const [cp] = await db.select().from(person).where(eq(person.id, coach));
    expect((await db.select().from(asset).where(eq(asset.id, cp!.photoAssetId!)))[0]!.kind).toBe('coach');
    expect((await db.select().from(person).where(eq(person.id, hasPhoto)))[0]!.photoAssetId).toBe(
      existing!.id,
    );
    const qids = await db
      .select({ q: providerMap.providerId })
      .from(providerMap)
      .where(and(eq(providerMap.provider, 'wikidata'), eq(providerMap.entityId, noPhoto)));
    expect(qids).toEqual([{ q: 'Q933886' }]);

    // segunda execução: todos já têm foto, nada é baixado
    expect(await importPeoplePhotos(db, store, client, matches)).toMatchObject({ linked: 0, skipped: 3 });
    expect(downloads).toHaveLength(2);
  });
});
