import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, fakeMediaFetch, fakePng } from '../../test/helpers.js';
import { runAssetMirror } from './asset-mirror.js';
import { InMemoryAssetStore } from './asset-store.js';
import {
  downloadToLocal,
  LOCAL_MANIFEST,
  LocalMediaSource,
  localMediaPath,
  parsePendingList,
  readLocalManifest,
  type PendingListItem,
} from './local-media.js';
import { MediaFetcher } from './media-fetcher.js';
import { InMemoryObjectStore } from './object-store.js';

const TEAM = 'https://media.api-sports.io/football/teams/121.png';
const PLAYER = 'https://media.api-sports.io/football/players/276.png';
const GONE = 'https://media.api-sports.io/football/players/999999.png';
const FLAKY = 'https://media.api-sports.io/football/coachs/40.png';
const GENERIC = 'https://media.api-sports.io/football/teams/9999.png';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'galaxie-local-media-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function list(assets: InMemoryAssetStore, urls: string[]): PendingListItem[] {
  return urls.map((url) => {
    const row = assets.byUrl(url)!;
    return { id: row.id, kind: row.kind, url };
  });
}

describe('localMediaPath', () => {
  it('organiza por tipo e caminho da URL normalizada', () => {
    expect(localMediaPath('player', 'https://media-3.api-sports.io/football/players/276.png?x=1')).toBe(
      'player/football/players/276.png',
    );
    expect(localMediaPath('flag', 'https://media.api-sports.io/flags/br.svg')).toBe('flag/flags/br.svg');
  });

  it('recusa URL fora da CDN e tipo estranho cai no tipo da URL', () => {
    expect(localMediaPath('player', 'https://example.com/a.png')).toBeUndefined();
    expect(localMediaPath('../x', TEAM)).toBe('team_logo/football/teams/121.png');
  });
});

describe('downloadToLocal', () => {
  it('baixa para a pasta, registra 404 no manifest, deixa 5xx de fora e retoma pelo manifest', async () => {
    const png = fakePng(150, 150, 40);
    const clock = new FakeClock();
    const media = fakeMediaFetch({
      [TEAM]: [{ status: 200, body: png, headers: { 'content-type': 'image/png' } }],
      [GONE]: [{ status: 404 }],
      [FLAKY]: [
        { status: 503 },
        { status: 503 },
        { status: 200, body: png, headers: { 'content-type': 'image/png' } },
      ],
    });
    const fetcher = new MediaFetcher({ fetch: media.fetch, clock, maxRetries: 1, backoffBaseMs: 10 });
    const items: PendingListItem[] = [
      { id: 'a', kind: 'team_logo', url: TEAM },
      { id: 'b', kind: 'player', url: GONE },
      { id: 'c', kind: 'coach', url: FLAKY },
      // mesma URL repetida na lista: baixa uma vez só
      { id: 'a', kind: 'team_logo', url: 'https://media-2.api-sports.io/football/teams/121.png' },
    ];

    const first = await downloadToLocal({ items, dir, fetcher, clock, delayMs: 5 });
    expect(first).toMatchObject({ listed: 4, skipped: 1, ok: 1, notFound: 1, failed: 1 });
    expect(new Uint8Array(await readFile(join(dir, 'team_logo', 'football', 'teams', '121.png')))).toEqual(
      png,
    );
    expect((await readLocalManifest(dir)).sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      expect.objectContaining({
        id: 'a',
        status: 'ok',
        file: 'team_logo/football/teams/121.png',
        contentType: 'image/png',
        bytes: png.length,
        sha256: sha(png),
      }),
      expect.objectContaining({ id: 'b', status: 'not_found', httpStatus: 404 }),
    ]);

    const callsAfterFirst = media.calls.length;
    const second = await downloadToLocal({ items, dir, fetcher, clock, delayMs: 5 });
    expect(second).toMatchObject({ skipped: 3, ok: 1, notFound: 0, failed: 0 });
    // só o que falhou foi pedido de novo
    expect(media.calls.slice(callsAfterFirst).map((c) => c.url)).toEqual([FLAKY]);
    expect((await readLocalManifest(dir)).map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('para depois de 429 seguidos e ignora linha cortada no fim do manifest', async () => {
    const clock = new FakeClock();
    await writeFile(join(dir, LOCAL_MANIFEST), '{"id":"x","status":"ok"');
    const media = fakeMediaFetch({
      [TEAM]: [{ status: 429, headers: { 'retry-after': '1' } }],
      [PLAYER]: [{ status: 429, headers: { 'retry-after': '1' } }],
      [GONE]: [{ status: 429, headers: { 'retry-after': '1' } }],
    });
    const fetcher = new MediaFetcher({ fetch: media.fetch, clock, maxRetries: 1 });
    const report = await downloadToLocal({
      items: [TEAM, PLAYER, GONE].map((url, i) => ({ id: String(i), kind: 'player', url })),
      dir,
      fetcher,
      clock,
      concurrency: 1,
      abortAfterRateLimited: 2,
    });
    expect(report.failed).toBe(2);
    expect(report.aborted).toMatch(/429/);
    expect(await readLocalManifest(dir)).toEqual([]);
  });
});

describe('downloadToLocal com erro de disco', () => {
  it('conta o item como falha e segue com os outros', async () => {
    const png = fakePng(10, 10, 3);
    const clock = new FakeClock();
    // um diretório no lugar do arquivo: o rename falha só para esse item
    await mkdir(join(dir, 'team_logo', 'football', 'teams', '121.png'), { recursive: true });
    const media = fakeMediaFetch({
      [TEAM]: [{ status: 200, body: png }],
      [PLAYER]: [{ status: 200, body: png }],
    });
    const report = await downloadToLocal({
      items: [
        { id: '1', kind: 'team_logo', url: TEAM },
        { id: '2', kind: 'player', url: PLAYER },
      ],
      dir,
      fetcher: new MediaFetcher({ fetch: media.fetch, clock }),
      clock,
      concurrency: 1,
      delayMs: 0,
    });
    expect(report).toMatchObject({ ok: 1, failed: 1 });
    expect((await readLocalManifest(dir)).map((e) => e.id)).toEqual(['2']);
  });
});

describe('LocalMediaSource + runAssetMirror (--origem-local)', () => {
  it('espelha só o que está no pacote, com a mesma regra do mirror e sem rede', async () => {
    const png = fakePng(200, 100, 7);
    const generic = fakePng(64, 64, 99);
    const clock = new FakeClock();
    const assets = new InMemoryAssetStore([TEAM, GONE, GENERIC, PLAYER]);
    const media = fakeMediaFetch({
      [TEAM]: [{ status: 200, body: png, headers: { 'content-type': 'image/png' } }],
      [GONE]: [{ status: 404 }],
      [GENERIC]: [{ status: 200, body: generic, headers: { 'content-type': 'image/png' } }],
    });
    // o pacote não tem PLAYER (fica pendente para o job agendado)
    await downloadToLocal({
      items: list(assets, [TEAM, GONE, GENERIC]),
      dir,
      fetcher: new MediaFetcher({ fetch: media.fetch, clock }),
      clock,
      delayMs: 0,
    });

    const local = await LocalMediaSource.open(dir);
    expect(local.size).toBe(3);
    const objects = new InMemoryObjectStore();
    const report = await runAssetMirror({
      assets,
      objects,
      fetcher: local,
      ids: local.ids(),
      clock,
      delayMs: 0,
      placeholderLogos: new Set([sha(generic)]),
    });
    expect(report).toMatchObject({ pending: 3, stored: 1, notFound: 1, placeholderLogos: 1, failed: 0 });
    expect(assets.byUrl(TEAM)).toMatchObject({
      storageKey: 'api-sports/football/teams/121.png',
      sha256: sha(png),
      bytes: png.length,
      width: 200,
      height: 100,
    });
    expect((await objects.head('api-sports/football/teams/121.png'))?.contentType).toBe('image/png');
    expect(assets.byUrl(GONE)!.fetchedAt).toBeInstanceOf(Date);
    expect(assets.byUrl(GENERIC)).toMatchObject({ storageKey: null });
    expect(assets.byUrl(PLAYER)).toMatchObject({ storageKey: null, fetchedAt: null });
    expect(await assets.counts()).toEqual({ total: 4, stored: 1, missing: 2, pending: 1 });
  });

  it('arquivo que não confere com o manifest e URL fora do pacote ficam pendentes', async () => {
    const png = fakePng(10, 10, 1);
    const clock = new FakeClock();
    const media = fakeMediaFetch({
      [TEAM]: [{ status: 200, body: png, headers: { 'content-type': 'image/png' } }],
    });
    await downloadToLocal({
      items: [{ id: '1', kind: 'team_logo', url: TEAM }],
      dir,
      fetcher: new MediaFetcher({ fetch: media.fetch, clock }),
      clock,
      delayMs: 0,
    });
    await writeFile(join(dir, 'team_logo', 'football', 'teams', '121.png'), 'outra coisa');

    const local = await LocalMediaSource.open(dir);
    expect(await local.get(TEAM)).toMatchObject({
      status: 'error',
      reason: expect.stringMatching(/não confere/),
    });
    expect(await local.get(PLAYER)).toMatchObject({ status: 'error', reason: 'fora do pacote local' });
  });
});

describe('parsePendingList', () => {
  it('lê o JSONL do assets:pendentes e descarta linha inválida', () => {
    const text = `${JSON.stringify({ id: '1', kind: 'player', url: PLAYER })}\r\n\n{"id":2}\n{"cortad`;
    expect(parsePendingList(text)).toEqual([{ id: '1', kind: 'player', url: PLAYER }]);
  });
});
