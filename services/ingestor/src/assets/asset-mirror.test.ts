import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MediaDenylist } from '@galaxie/apisports-client';
import { FakeClock, fakeMediaFetch, fakePng } from '../../test/helpers.js';
import { loadMediaDenylist, runAssetMirror } from './asset-mirror.js';
import { InMemoryAssetStore } from './asset-store.js';
import { MediaFetcher } from './media-fetcher.js';
import { InMemoryObjectStore } from './object-store.js';

const BR = 'https://media.api-sports.io/flags/br.svg';
const TEAM = 'https://media.api-sports.io/football/teams/121.png';
const GONE = 'https://media.api-sports.io/football/players/999999.png';
const PAULISTAO = 'https://media.api-sports.io/football/leagues/475.png';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect/></svg>';

function setup(routes: Parameters<typeof fakeMediaFetch>[0], urls: string[]) {
  const clock = new FakeClock();
  const media = fakeMediaFetch(routes);
  const assets = new InMemoryAssetStore(urls);
  const objects = new InMemoryObjectStore();
  const fetcher = new MediaFetcher({ fetch: media.fetch, clock, backoffBaseMs: 100 });
  return { clock, media, assets, objects, fetcher };
}

describe('runAssetMirror', () => {
  it('espelha, registra 404 sem repetir e a segunda execução não baixa nada', async () => {
    const png = fakePng(150, 150, 40);
    const { clock, media, assets, objects, fetcher } = setup(
      {
        [BR]: [{ status: 200, body: SVG, headers: { 'content-type': 'image/svg+xml' } }],
        [TEAM]: [{ status: 200, body: png, headers: { 'content-type': 'image/png' } }],
        [GONE]: [{ status: 404 }],
      },
      [BR, TEAM, GONE],
    );

    const first = await runAssetMirror({ assets, objects, fetcher, clock, concurrency: 2, delayMs: 10 });
    expect(first).toMatchObject({ pending: 3, stored: 2, notFound: 1, failed: 0, notFoundUrls: [GONE] });

    const team = assets.byUrl(TEAM)!;
    expect(team).toMatchObject({
      storageKey: 'api-sports/football/teams/121.png',
      sha256: createHash('sha256').update(png).digest('hex'),
      bytes: png.length,
      width: 150,
      height: 150,
    });
    expect(team.fetchedAt).toBeInstanceOf(Date);
    expect(assets.byUrl(BR)).toMatchObject({
      storageKey: 'api-sports/flags/br.svg',
      width: 640,
      height: 480,
    });
    expect(assets.byUrl(GONE)).toMatchObject({ storageKey: null });
    expect(assets.byUrl(GONE)!.fetchedAt).toBeInstanceOf(Date);
    expect((await objects.head('api-sports/flags/br.svg'))?.contentType).toBe('image/svg+xml');
    expect(await assets.counts()).toEqual({ total: 3, stored: 2, missing: 1, pending: 0 });

    const callsAfterFirst = media.calls.length;
    const second = await runAssetMirror({ assets, objects, fetcher, clock });
    expect(second).toMatchObject({ pending: 0, stored: 0, notFound: 0 });
    expect(media.calls.length).toBe(callsAfterFirst);
  });

  it('não baixa o que está na lista de bloqueio e desvincula o que já tinha sido espelhado', async () => {
    const { clock, media, assets, objects, fetcher } = setup({}, [PAULISTAO, BR]);
    // BR já espelhado e depois bloqueado (hipotético) → desvinculado
    await assets.markStored(assets.byUrl(BR)!.id, {
      storageKey: 'api-sports/flags/br.svg',
      sha256: 'x',
      bytes: 1,
      width: null,
      height: null,
      fetchedAt: new Date(clock.now()),
    });
    const denylist = new MediaDenylist([
      { url: 'http://media-2.api-sports.io/football/leagues/475.png', reason: 'escudo errado' },
      { url: BR, reason: 'teste' },
    ]);
    const report = await runAssetMirror({ assets, objects, fetcher, clock, denylist });
    // BR é desvinculado (fica ausente, não pendente); o Paulistão pendente é bloqueado sem download
    expect(report).toMatchObject({ pending: 1, denied: 1, unlinked: 1, stored: 0 });
    expect(media.calls).toHaveLength(0);
    expect(assets.byUrl(PAULISTAO)).toMatchObject({ storageKey: null });
    expect(assets.byUrl(BR)).toMatchObject({ storageKey: null, sha256: null });
  });

  it('falhas transitórias continuam pendentes; muitos 429 seguidos interrompem a execução', async () => {
    const urls = [1, 2, 3, 4, 5].map((i) => `https://media.api-sports.io/football/teams/${i}.png`);
    const { clock, media, assets, objects } = setup(
      Object.fromEntries(urls.map((u) => [u, [{ status: 429 }]])),
      urls,
    );
    const report = await runAssetMirror({
      assets,
      objects,
      fetcher: new MediaFetcher({ fetch: media.fetch, clock, maxRetries: 1, backoffBaseMs: 10 }),
      clock,
      concurrency: 1,
      abortAfterRateLimited: 2,
    });
    expect(report.failed).toBe(2);
    expect(report.aborted).toMatch(/429/);
    expect(media.calls).toHaveLength(4); // 2 assets × (1 + 1 nova tentativa)
    expect((await assets.pending()).length).toBe(5);
  });

  it('modo plano não baixa e --retentar-ausentes volta a tentar 404', async () => {
    const { clock, media, assets, objects, fetcher } = setup(
      { [GONE]: [{ status: 404 }, { status: 200, body: fakePng(5, 5) }] },
      [GONE],
    );
    expect(await runAssetMirror({ assets, objects, fetcher, clock, dryRun: true })).toMatchObject({
      pending: 1,
    });
    expect(media.calls).toHaveLength(0);
    await runAssetMirror({ assets, objects, fetcher, clock });
    expect((await runAssetMirror({ assets, objects, fetcher, clock })).pending).toBe(0);
    const retry = await runAssetMirror({ assets, objects, fetcher, clock, includeMissing: true });
    expect(retry).toMatchObject({ pending: 1, stored: 1 });
  });

  it('ignora URLs fora da CDN registradas em core.asset', async () => {
    const { clock, assets, objects, fetcher } = setup({}, ['https://upload.wikimedia.org/logo.svg']);
    expect(await runAssetMirror({ assets, objects, fetcher, clock })).toMatchObject({ pending: 0 });
  });
});

describe('loadMediaDenylist', () => {
  it('lê o YAML do repositório (inclui o logo errado do Paulistão)', async () => {
    const denylist = await loadMediaDenylist(
      resolve(import.meta.dirname, '../../../../config/assets/denylist.yaml'),
    );
    expect(denylist.has(PAULISTAO)).toBe(true);
  });

  it('aceita arquivo vazio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'denylist-'));
    try {
      await writeFile(join(dir, 'd.yaml'), 'schema_version: 1\n');
      expect((await loadMediaDenylist(join(dir, 'd.yaml'))).size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
