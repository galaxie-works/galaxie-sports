import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MediaDenylist } from '@galaxie/apisports-client';
import { FakeClock, fakeMediaFetch, fakePng } from '../../test/helpers.js';
import { encodePng } from '../../test/png.js';
import { loadMediaDenylist, runAssetMirror } from './asset-mirror.js';
import { InMemoryAssetStore } from './asset-store.js';
import { MediaFetcher } from './media-fetcher.js';
import { InMemoryObjectStore } from './object-store.js';
import { PLACEHOLDER_LOGO_SHA256 } from './palette.js';
import { runPaletteBackfill } from './palette-backfill.js';
import { isPlaceholderPhoto, PLACEHOLDER_PHOTO_SHA256, playerPhotoUrl } from './person-photos.js';
import { isPlaceholderLogo } from './placeholder-logos.js';

const BR = 'https://media.api-sports.io/flags/br.svg';
const TEAM = 'https://media.api-sports.io/football/teams/121.png';
const GONE = 'https://media.api-sports.io/football/players/999999.png';
const PAULISTAO = 'https://media.api-sports.io/football/leagues/475.png';
const PAULISTAO_OK = 'https://media.api-sports.io/football/leagues/71.png';
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

/** Escudo 2×2: verde Palmeiras, branco e um pixel transparente. */
const CREST = encodePng({
  width: 2,
  height: 2,
  colorType: 6,
  rows: [
    [0, 105, 55, 255, 255, 255, 255, 255],
    [0, 105, 55, 255, 0, 0, 0, 0],
  ],
});
const PALMEIRAS_PALETTE = { version: 1, dominant: '#006937', secondary: null, monochrome: false };

describe('cores dos times', () => {
  it('o espelho grava a paleta no mesmo update só para team_logo em PNG', async () => {
    const { assets, objects, fetcher, clock } = setup(
      {
        [TEAM]: [{ status: 200, body: CREST, headers: { 'content-type': 'image/png' } }],
        [PAULISTAO_OK]: [{ status: 200, body: CREST, headers: { 'content-type': 'image/png' } }],
      },
      [TEAM, PAULISTAO_OK],
    );
    await runAssetMirror({ assets, objects, fetcher, clock, delayMs: 0 });
    expect(assets.byUrl(TEAM)).toMatchObject({ kind: 'team_logo', palette: PALMEIRAS_PALETTE });
    expect(assets.byUrl(PAULISTAO_OK)).toMatchObject({ kind: 'league_logo', palette: null });
  });

  it('o backfill lê do storage os escudos sem paleta (sem nenhuma chamada à CDN) e ignora os inválidos', async () => {
    const OTHER = 'https://media.api-sports.io/football/teams/131.png';
    const LOST = 'https://media.api-sports.io/football/teams/999.png';
    const PLACEHOLDER = 'https://media.api-sports.io/football/teams/10034.png';
    const assets = new InMemoryAssetStore([TEAM, OTHER, LOST, BR, PLACEHOLDER]);
    const objects = new InMemoryObjectStore();
    const stored = { sha256: 'x', bytes: 1, width: 2, height: 2, fetchedAt: new Date() };
    await objects.put('api-sports/football/teams/121.png', CREST, 'image/png', 'x');
    await objects.put('api-sports/football/teams/131.png', fakePng(2, 2, 8), 'image/png', 'x');
    await assets.markStored(assets.byUrl(TEAM)!.id, {
      ...stored,
      storageKey: 'api-sports/football/teams/121.png',
    });
    await assets.markStored(assets.byUrl(OTHER)!.id, {
      ...stored,
      storageKey: 'api-sports/football/teams/131.png',
    });
    await assets.markStored(assets.byUrl(LOST)!.id, {
      ...stored,
      storageKey: 'api-sports/football/teams/999.png',
    });
    await assets.markStored(assets.byUrl(BR)!.id, { ...stored, storageKey: 'api-sports/flags/br.svg' });
    // placeholder genérico do fornecedor ("image not available"): sem cor de time, nunca é candidato
    await assets.markStored(assets.byUrl(PLACEHOLDER)!.id, {
      ...stored,
      sha256: [...PLACEHOLDER_LOGO_SHA256][0]!,
      storageKey: 'api-sports/football/teams/10034.png',
    });

    expect(await runPaletteBackfill({ assets, objects, dryRun: true })).toEqual({
      candidates: 3,
      saved: 0,
      monochrome: 0,
      skipped: 0,
    });
    const events: string[] = [];
    const report = await runPaletteBackfill({
      assets,
      objects,
      onProgress: (e) => events.push(`${e.type} ${e.storageKey}`),
    });
    expect(report).toEqual({ candidates: 3, saved: 1, monochrome: 0, skipped: 2 });
    expect(assets.byUrl(TEAM)!.palette).toEqual(PALMEIRAS_PALETTE);
    expect(events).toEqual([
      'saved api-sports/football/teams/121.png',
      'skipped api-sports/football/teams/131.png',
      'skipped api-sports/football/teams/999.png',
    ]);
    // segunda execução: só os que não decodificaram voltam
    expect((await runPaletteBackfill({ assets, objects, dryRun: true })).candidates).toBe(2);
  });
});

describe('fotos de pessoas', () => {
  const MESSI = 'https://media.api-sports.io/football/players/154.png';
  const NO_PHOTO = 'https://media.api-sports.io/football/players/400000.png';
  const GONE_COACH = 'https://media.api-sports.io/football/coachs/7.png';

  it('imagem genérica vira "sem foto": não vai para o storage e a pessoa perde o vínculo', async () => {
    const real = fakePng(150, 150, 10);
    const silhouette = fakePng(150, 150, 20);
    const { clock, assets, objects, fetcher } = setup(
      {
        [MESSI]: [{ status: 200, body: real, headers: { 'content-type': 'image/png' } }],
        [NO_PHOTO]: [{ status: 200, body: silhouette, headers: { 'content-type': 'image/png' } }],
        [GONE_COACH]: [{ status: 404 }],
        [TEAM]: [{ status: 200, body: silhouette, headers: { 'content-type': 'image/png' } }],
      },
      [MESSI, NO_PHOTO, GONE_COACH, TEAM],
    );
    const placeholderPhotos = new Set([createHash('sha256').update(silhouette).digest('hex')]);

    const report = await runAssetMirror({ assets, objects, fetcher, clock, placeholderPhotos });
    expect(report).toMatchObject({ pending: 4, stored: 2, placeholders: 1, notFound: 1 });
    expect(assets.byUrl(MESSI)).toMatchObject({ storageKey: 'api-sports/football/players/154.png' });
    expect(assets.byUrl(NO_PHOTO)).toMatchObject({ storageKey: null, sha256: null });
    expect(assets.byUrl(NO_PHOTO)!.fetchedAt).toBeInstanceOf(Date);
    expect(await objects.head('api-sports/football/players/400000.png')).toBeUndefined();
    // o mesmo hash num escudo não é foto de pessoa: espelha normalmente
    expect(assets.byUrl(TEAM)).toMatchObject({ storageKey: 'api-sports/football/teams/121.png' });
    // 404 de foto de pessoa também desliga a foto; a genérica e o 404 não são tentados de novo
    expect([...assets.detached].sort()).toEqual(
      [assets.byUrl(NO_PHOTO)!.id, assets.byUrl(GONE_COACH)!.id].sort(),
    );
    expect((await runAssetMirror({ assets, objects, fetcher, clock, placeholderPhotos })).pending).toBe(0);
  });

  it('com personPhotos só entram fotos de jogadores e técnicos', async () => {
    const { clock, assets, objects, fetcher } = setup({}, [BR, TEAM, MESSI, GONE_COACH]);
    const report = await runAssetMirror({
      assets,
      objects,
      fetcher,
      clock,
      dryRun: true,
      personPhotos: { since: new Date(0) },
    });
    expect(report.pending).toBe(2);
  });

  it('os hashes catalogados valem só para fotos de pessoa', () => {
    const [silhouette] = PLACEHOLDER_PHOTO_SHA256;
    expect(isPlaceholderPhoto('player', silhouette!)).toBe(true);
    expect(isPlaceholderPhoto('coach', silhouette!)).toBe(true);
    expect(isPlaceholderPhoto('team_logo', silhouette!)).toBe(false);
    expect(isPlaceholderPhoto('player', 'outro')).toBe(false);
    expect(playerPhotoUrl('154')).toBe(MESSI);
  });
});

describe('logos genéricos', () => {
  const PRAIA = 'https://media.api-sports.io/volley/teams/1999.png';
  const SUPERLIGA = 'https://media.api-sports.io/volley/leagues/97.png';
  const GONE_LEAGUE = 'https://media.api-sports.io/volley/leagues/9999.png';
  const PLAYER = 'https://media.api-sports.io/football/players/154.png';

  it('"image not available" vira "sem logo": não vai para o storage e times e ligas perdem o vínculo', async () => {
    const real = fakePng(150, 150, 30);
    const notAvailable = fakePng(150, 150, 50);
    const { clock, assets, objects, fetcher } = setup(
      {
        [TEAM]: [{ status: 200, body: real, headers: { 'content-type': 'image/png' } }],
        [PRAIA]: [{ status: 200, body: notAvailable, headers: { 'content-type': 'image/png' } }],
        [SUPERLIGA]: [{ status: 200, body: notAvailable, headers: { 'content-type': 'image/png' } }],
        [GONE_LEAGUE]: [{ status: 404 }],
        [PLAYER]: [{ status: 200, body: notAvailable, headers: { 'content-type': 'image/png' } }],
      },
      [TEAM, PRAIA, SUPERLIGA, GONE_LEAGUE, PLAYER],
    );
    const placeholderLogos = new Set([createHash('sha256').update(notAvailable).digest('hex')]);

    const report = await runAssetMirror({ assets, objects, fetcher, clock, placeholderLogos });
    expect(report).toMatchObject({
      pending: 5,
      stored: 2,
      placeholderLogos: 2,
      placeholders: 0,
      notFound: 1,
    });
    expect(assets.byUrl(TEAM)).toMatchObject({ storageKey: 'api-sports/football/teams/121.png' });
    for (const url of [PRAIA, SUPERLIGA]) {
      expect(assets.byUrl(url)).toMatchObject({ storageKey: null, sha256: null, palette: null });
      expect(assets.byUrl(url)!.fetchedAt).toBeInstanceOf(Date);
    }
    expect(await objects.head('api-sports/volley/teams/1999.png')).toBeUndefined();
    expect(await objects.head('api-sports/volley/leagues/97.png')).toBeUndefined();
    // o mesmo hash numa foto de pessoa não é logo: espelha normalmente
    expect(assets.byUrl(PLAYER)).toMatchObject({ storageKey: 'api-sports/football/players/154.png' });
    // 404 de logo também desliga; os genéricos e o 404 não são tentados de novo
    expect([...assets.detachedLogos].sort()).toEqual(
      [assets.byUrl(PRAIA)!.id, assets.byUrl(SUPERLIGA)!.id, assets.byUrl(GONE_LEAGUE)!.id].sort(),
    );
    expect(assets.detached.size).toBe(0);
    expect((await runAssetMirror({ assets, objects, fetcher, clock, placeholderLogos })).pending).toBe(0);
  });

  it('a limpeza do início marca como ausentes os logos genéricos gravados antes; --plan só conta', async () => {
    const { clock, assets, objects, fetcher } = setup({}, [TEAM, PRAIA, PLAYER]);
    const [notAvailable] = PLACEHOLDER_LOGO_SHA256;
    const stored = { bytes: 1, width: 2, height: 2, fetchedAt: new Date(0) };
    await assets.markStored(assets.byUrl(TEAM)!.id, {
      ...stored,
      sha256: 'escudo',
      storageKey: 'api-sports/football/teams/121.png',
    });
    await assets.markStored(assets.byUrl(PRAIA)!.id, {
      ...stored,
      sha256: notAvailable!,
      storageKey: 'api-sports/volley/teams/1999.png',
    });
    // foto de pessoa com o hash do logo genérico não é logo: fica onde está
    await assets.markStored(assets.byUrl(PLAYER)!.id, {
      ...stored,
      sha256: notAvailable!,
      storageKey: 'api-sports/football/players/154.png',
    });

    const plan = await runAssetMirror({ assets, objects, fetcher, clock, dryRun: true });
    expect(plan.logoCleanup).toEqual({ placeholders: 1, participants: 1, competitions: 0 });
    expect(assets.byUrl(PRAIA)!.storageKey).toBe('api-sports/volley/teams/1999.png');

    const report = await runAssetMirror({ assets, objects, fetcher, clock });
    expect(report.logoCleanup.placeholders).toBe(1);
    expect(report.pending).toBe(0);
    expect(assets.byUrl(PRAIA)).toMatchObject({ storageKey: null, sha256: null });
    expect(assets.byUrl(PRAIA)!.fetchedAt).toBeInstanceOf(Date);
    expect([...assets.detachedLogos]).toEqual([assets.byUrl(PRAIA)!.id]);
    expect(assets.byUrl(TEAM)!.storageKey).toBe('api-sports/football/teams/121.png');
    expect(assets.byUrl(PLAYER)!.storageKey).toBe('api-sports/football/players/154.png');
    expect((await runAssetMirror({ assets, objects, fetcher, clock })).logoCleanup.placeholders).toBe(0);
  });

  it('os hashes catalogados valem só para logos de time e de competição', () => {
    const [notAvailable] = PLACEHOLDER_LOGO_SHA256;
    expect(isPlaceholderLogo('team_logo', notAvailable!)).toBe(true);
    expect(isPlaceholderLogo('league_logo', notAvailable!)).toBe(true);
    expect(isPlaceholderLogo('player', notAvailable!)).toBe(false);
    expect(isPlaceholderLogo('venue', notAvailable!)).toBe(false);
    expect(isPlaceholderLogo('team_logo', 'outro')).toBe(false);
  });
});
