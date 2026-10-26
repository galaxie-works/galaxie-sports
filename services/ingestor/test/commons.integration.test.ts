/**
 * Acervo de fotos da F1 (assets:commons): a importação confere a licença de novo na Commons, grava no storage
 * com a nossa nomenclatura e registra asset, crédito e vínculo com o piloto; é idempotente, tira a foto
 * rejeitada na curadoria e recusa a que perdeu a licença livre. A Commons é falsa (fetch injetado).
 */
import { deflateSync } from 'node:zlib';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  assetCredit,
  participant,
  participantPhoto,
  providerMap,
  sport,
  type Database,
} from '@galaxie/db';
import { WikimediaClient } from '../src/assets/commons/client.js';
import { importCommons } from '../src/assets/commons/import.js';
import type { CommonsManifest, ManifestPhoto } from '../src/assets/commons/manifest.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;
let sennaId: string;

/** PNG 2×2 válido (o leitor de dimensões precisa do cabeçalho). */
function png(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** Commons falsa: imageinfo com a licença de cada arquivo e a miniatura em PNG. */
function fakeCommons(licenses: Record<string, string>) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === 'upload.wikimedia.org')
      return new Response(png(), { headers: { 'content-type': 'image/png' } });
    const titles = (url.searchParams.get('titles') ?? '').split('|');
    const pages = titles.map((title) => ({
      title,
      imageinfo: [
        {
          url: `https://upload.wikimedia.org/${encodeURIComponent(title)}`,
          descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
          thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}`,
          width: 1600,
          height: 1200,
          mime: 'image/jpeg',
          extmetadata: {
            License: { value: licenses[title] },
            LicenseShortName: { value: licenses[title]?.toUpperCase() },
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Fotografo">Fotógrafo</a>' },
            DateTimeOriginal: { value: '1988-07-10' },
          },
        },
      ],
    }));
    return Response.json({ query: { pages } });
  }) as typeof fetch;
}

const photo = (
  file: string,
  role: ManifestPhoto['role'],
  over: Partial<ManifestPhoto> = {},
): ManifestPhoto => ({
  file,
  role,
  season: 1988,
  rank: role === 'portrait' ? 0 : 1,
  match: 'auto',
  selected_by: 'rules',
  page_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(file)}`,
  license: 'CC BY 2.0',
  license_url: null,
  author: 'Fotógrafo',
  author_url: null,
  credit: null,
  attribution_required: true,
  share_alike: false,
  date: '1988-07-10',
  width: 1600,
  height: 1200,
  ...over,
});

const manifest = (photos: ManifestPhoto[]): CommonsManifest => ({
  schema_version: 1,
  acervo: { id: 'commons-f1', name: 'teste', source: 'https://commons.wikimedia.org', revision: 'teste' },
  generated_at: '2026-10-23T00:00:00Z',
  entries: [
    {
      target: 'driver/ayrton-senna',
      kind: 'driver',
      f1db_id: 'ayrton-senna',
      name: 'Ayrton Senna',
      wikidata: null,
      category: 'Ayrton Senna',
      photos,
    },
  ],
});

const client = (licenses: Record<string, string>) =>
  new WikimediaClient({ fetch: fakeCommons(licenses), minIntervalMs: 0, sleep: async () => {} });

beforeAll(async () => {
  db = await testDb.setup();
  await db.insert(sport).values({ slug: 'formula-1', name: { 'pt-BR': 'Fórmula 1' } });
  const [p] = await db
    .insert(participant)
    .values({ sport: 'formula-1', kind: 'driver', name: 'Ayrton Senna' })
    .returning({ id: participant.id });
  sennaId = p!.id;
  await db.insert(providerMap).values({
    entityType: 'participant',
    entityId: sennaId,
    provider: 'f1db',
    sport: 'formula-1',
    providerId: 'driver-ayrton-senna',
  });
}, 120_000);

afterAll(() => testDb.teardown());

describe('importação do acervo de fotos', () => {
  const licenses = { 'File:Senna retrato.jpg': 'cc-by-2.0', 'File:Senna 1988.jpg': 'cc-by-sa-4.0' };
  const store = new InMemoryObjectStore();

  it('grava no storage, registra o crédito e liga ao piloto', async () => {
    const r = await importCommons(
      db,
      store,
      client(licenses),
      manifest([photo('File:Senna retrato.jpg', 'portrait'), photo('File:Senna 1988.jpg', 'action')]),
    );
    expect(r).toMatchObject({ photos: 2, stored: 2, linked: 2, skipped: [] });
    const keys = [...store.objects.keys()];
    expect(keys.every((k) => k.startsWith(`commons/f1/drivers/${sennaId}.`))).toBe(true);
    const credits = await db.select().from(assetCredit);
    expect(credits.map((c) => [c.license, c.author, c.shareAlike]).sort()).toEqual([
      ['CC-BY-2.0', 'Fotógrafo', false],
      ['CC-BY-SA-4.0', 'Fotógrafo', true],
    ]);
    const assets = await db
      .select({ origin: asset.origin, kind: asset.kind, width: asset.width })
      .from(asset);
    expect(assets.every((a) => a.origin === 'commons' && a.kind === 'driver' && a.width === 2)).toBe(true);
    // a API purga (e a demo revalida) as fotos e a carreira do piloto: `team:<id>`
    const changes = await db.execute<{ topic: string; payload: { tags: string[] } }>(
      sql`select topic, payload from ops.change_feed where entity_type = 'team' and entity_id = ${sennaId}`,
    );
    expect(changes.map((c) => [c.topic, c.payload.tags])).toEqual([['catalog', ['asset']]]);
  });

  it('o mesmo manifesto de novo não baixa nem regrava', async () => {
    const r = await importCommons(
      db,
      store,
      client(licenses),
      manifest([photo('File:Senna retrato.jpg', 'portrait'), photo('File:Senna 1988.jpg', 'action')]),
    );
    expect(r).toMatchObject({ stored: 0, unchanged: 2, linked: 2, unlinked: 0 });
  });

  it('foto que muda de papel (retrato → ação) não fica nos dois', async () => {
    const r = await importCommons(
      db,
      store,
      client(licenses),
      manifest([
        photo('File:Senna retrato.jpg', 'action', { rank: 2 }),
        photo('File:Senna 1988.jpg', 'action'),
      ]),
    );
    expect(r.unlinked).toBe(1);
    const links = await db.select().from(participantPhoto).where(eq(participantPhoto.participantId, sennaId));
    expect(links.map((l) => l.role).sort()).toEqual(['action', 'action']);
  });

  it('foto rejeitada na curadoria sai do piloto (o asset fica)', async () => {
    const r = await importCommons(
      db,
      store,
      client(licenses),
      manifest([
        photo('File:Senna retrato.jpg', 'portrait'),
        photo('File:Senna 1988.jpg', 'action', { match: 'rejected' }),
      ]),
    );
    // a rejeitada e o papel antigo (ação) do retrato, que voltou a ser retrato
    expect(r.unlinked).toBe(2);
    const links = await db.select().from(participantPhoto).where(eq(participantPhoto.participantId, sennaId));
    expect(links.map((l) => l.role)).toEqual(['portrait']);
    expect(Number((await db.execute<{ n: string }>(sql`select count(*) as n from core.asset`))[0]!.n)).toBe(
      2,
    );
  });

  it('licença que deixou de ser livre na Commons é recusada na importação', async () => {
    const r = await importCommons(
      db,
      store,
      client({ ...licenses, 'File:Senna retrato.jpg': 'cc-by-nc-2.0' }),
      manifest([photo('File:Senna retrato.jpg', 'portrait')]),
    );
    expect(r.skipped).toEqual([
      { key: 'driver/ayrton-senna', file: 'File:Senna retrato.jpg', reason: 'licença: não comercial (NC)' },
    ]);
    // nenhuma foto válida no manifesto: o retrato sai também
    const links = await db.select().from(participantPhoto).where(eq(participantPhoto.participantId, sennaId));
    expect(links).toEqual([]);
  });
});

describe('galeria protegida da descoberta vazia', () => {
  const licenses = { 'File:Senna retrato.jpg': 'cc-by-2.0' };
  const store = new InMemoryObjectStore();
  const links = () =>
    db
      .select({ role: participantPhoto.role })
      .from(participantPhoto)
      .where(eq(participantPhoto.participantId, sennaId));
  /** Commons que não devolve nenhum arquivo (fora do ar ou resposta vazia). */
  const emptyCommons = new WikimediaClient({
    fetch: (async () => Response.json({ query: { pages: [] } })) as typeof fetch,
    minIntervalMs: 0,
    sleep: async () => {},
  });

  it('entrada com `photos: []` (a descoberta não achou nada) não apaga a galeria; só a rejeição explícita', async () => {
    await importCommons(db, store, client(licenses), manifest([photo('File:Senna retrato.jpg', 'portrait')]));
    expect(await links()).toEqual([{ role: 'portrait' }]);

    const empty = manifest([]);
    empty.entries[0]!.category = null;
    const r = await importCommons(db, store, client(licenses), empty);
    expect(r.unlinked).toBe(0);
    expect(r.skipped).toEqual([
      {
        key: 'driver/ayrton-senna',
        reason: 'entrada sem fotos no manifesto: as 1 foto(s) já vinculada(s) ficam',
      },
    ]);
    expect(await links()).toEqual([{ role: 'portrait' }]);

    // a Commons não devolveu nenhum dos arquivos: também fica
    const down = await importCommons(
      db,
      store,
      emptyCommons,
      manifest([photo('File:Senna retrato.jpg', 'portrait')]),
    );
    expect(down.unlinked).toBe(0);
    expect(down.skipped.at(-1)?.reason).toMatch(/não devolveu nenhum dos arquivos/);
    expect(await links()).toEqual([{ role: 'portrait' }]);

    // a curadoria rejeitou a foto: aí sai
    const rejected = await importCommons(
      db,
      store,
      client(licenses),
      manifest([photo('File:Senna retrato.jpg', 'portrait', { match: 'rejected' })]),
    );
    expect(rejected.unlinked).toBe(1);
    expect(await links()).toEqual([]);
  });

  it('arquivo apagado na Commons (página `missing`) sai do piloto: a proteção é só para resposta sem página', async () => {
    await importCommons(db, store, client(licenses), manifest([photo('File:Senna retrato.jpg', 'portrait')]));
    expect(await links()).toEqual([{ role: 'portrait' }]);
    const deleted = new WikimediaClient({
      fetch: (async () =>
        Response.json({
          query: { pages: [{ title: 'File:Senna retrato.jpg', missing: true }] },
        })) as typeof fetch,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    const r = await importCommons(
      db,
      store,
      deleted,
      manifest([photo('File:Senna retrato.jpg', 'portrait')]),
    );
    expect(r.skipped).toEqual([
      { key: 'driver/ayrton-senna', file: 'File:Senna retrato.jpg', reason: 'arquivo apagado na Commons' },
    ]);
    expect(r.unlinked).toBe(1);
    expect(await links()).toEqual([]);
  });
});

describe('carro de destaque do piloto', () => {
  const licenses = { 'File:Senna retrato.jpg': 'cc-by-2.0', 'File:MP4-4 Suzuka 1988.jpg': 'cc-by-2.0' };
  const store = new InMemoryObjectStore();
  const car = (photos: ManifestPhoto[]) => ({
    target: 'car/mclaren/1988',
    kind: 'car' as const,
    f1db_id: 'mclaren',
    name: 'McLaren 1988',
    season: 1988,
    wikidata: null,
    category: 'McLaren MP4/4',
    photos,
  });
  const withHighlight = (carPhotos: ManifestPhoto[], highlight: boolean): CommonsManifest => {
    const m = manifest([photo('File:Senna retrato.jpg', 'portrait')]);
    m.entries[0]!.highlight_car = highlight
      ? { target: 'car/mclaren/1988', season: 1988, reason: 'título de 1988', match: 'auto' }
      : null;
    m.entries.push(car(carPhotos));
    return m;
  };
  const highlightOf = () =>
    db
      .select({
        role: participantPhoto.role,
        season: participantPhoto.seasonYear,
        assetId: participantPhoto.assetId,
      })
      .from(participantPhoto)
      .where(and(eq(participantPhoto.participantId, sennaId), eq(participantPhoto.role, 'highlight_car')));

  beforeAll(async () => {
    const [mclaren] = await db
      .insert(participant)
      .values({ sport: 'formula-1', kind: 'constructor', name: 'McLaren' })
      .returning({ id: participant.id });
    await db.insert(providerMap).values({
      entityType: 'participant',
      entityId: mclaren!.id,
      provider: 'f1db',
      sport: 'formula-1',
      providerId: 'mclaren',
    });
  });

  // a foto com a nota do Gemini para o fundo (`hero`): sem ela, o carro não vai ao fundo
  const scored = () => [photo('File:MP4-4 Suzuka 1988.jpg', 'car', { rank: 0, hero: 0.8 })];

  it('a foto do carro de destaque com a nota do fundo também fica no piloto, com a temporada', async () => {
    const plan = await importCommons(
      db,
      new InMemoryObjectStore(),
      client(licenses),
      withHighlight(scored(), true),
      { plan: true },
    );
    expect(plan.highlights).toBe(1);
    const r = await importCommons(db, store, client(licenses), withHighlight(scored(), true));
    expect(r.highlights).toBe(1);
    const [carAsset] = await db
      .select({ id: asset.id })
      .from(asset)
      .where(eq(asset.sourceUrl, 'commons://File:MP4-4 Suzuka 1988.jpg'));
    expect(await highlightOf()).toEqual([{ role: 'highlight_car', season: 1988, assetId: carAsset!.id }]);
  });

  it('carro sem a nota do Gemini não vai ao fundo (nem a primeira foto compatível): o vínculo sai', async () => {
    const semNota = withHighlight([photo('File:MP4-4 Suzuka 1988.jpg', 'car', { rank: 0 })], true);
    const plan = await importCommons(db, new InMemoryObjectStore(), client(licenses), semNota, {
      plan: true,
    });
    expect(plan.highlights).toBe(0);
    expect(plan.withoutHighlight).toEqual(['driver/ayrton-senna']);
    const r = await importCommons(db, store, client(licenses), semNota);
    expect(r.highlights).toBe(0);
    expect(await highlightOf()).toEqual([]);
    // com a nota de novo, volta
    await importCommons(db, store, client(licenses), withHighlight(scored(), true));
    expect(await highlightOf()).toHaveLength(1);
  });

  it('licença que virou CC BY-SA na Commons: a foto não vai ao fundo, mesmo com o manifesto dizendo que não', async () => {
    await importCommons(db, store, client(licenses), withHighlight(scored(), true));
    expect(await highlightOf()).toHaveLength(1);
    const bySa = { ...licenses, 'File:MP4-4 Suzuka 1988.jpg': 'cc-by-sa-2.0' };
    const plan = await importCommons(db, store, client(bySa), withHighlight(scored(), true), { plan: true });
    expect(plan.highlights).toBe(0);
    const r = await importCommons(db, store, client(bySa), withHighlight(scored(), true));
    expect(r.highlights).toBe(0);
    expect(r.withoutHighlight).toEqual(['driver/ayrton-senna']);
    expect(await highlightOf()).toEqual([]);
    // só o piloto (--so driver/...): o carro não é conferido de novo e vale o crédito gravado (CC BY-SA), não
    // o manifesto
    const onlyDriver = await importCommons(db, store, client(licenses), withHighlight(scored(), true), {
      only: new Set(['driver/ayrton-senna']),
    });
    expect(onlyDriver.highlights).toBe(0);
    // a licença voltou a ser CC BY na Commons: o carro conferido de novo volta ao fundo
    const back = await importCommons(db, store, client(licenses), withHighlight(scored(), true));
    expect(back.highlights).toBe(1);
    expect(await highlightOf()).toHaveLength(1);
  });

  it('sem destaque no manifesto, o vínculo sai', async () => {
    const r = await importCommons(db, store, client(licenses), withHighlight(scored(), false));
    expect(r.highlights).toBe(0);
    expect(await highlightOf()).toEqual([]);
  });
});
