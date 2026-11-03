import { describe, expect, it } from 'vitest';
import { FakeClock, fakeMediaFetch, fakePng } from '../../test/helpers.js';
import { InMemoryCursorStore } from '../jobs/runtime/cursor-store.js';
import { runAssetMirror } from './asset-mirror.js';
import { InMemoryAssetStore } from './asset-store.js';
import { MediaFetcher } from './media-fetcher.js';
import { mirrorCursorStore, mirrorScopeKey } from './mirror-cursor.js';
import { InMemoryObjectStore } from './object-store.js';

const team = (n: number) => `https://media.api-sports.io/football/teams/${n}.png`;
const FLAG = 'https://media.api-sports.io/flags/br.svg';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>';

function setup() {
  const png = fakePng(10, 10, 1);
  const ok = [{ status: 200, body: png, headers: { 'content-type': 'image/png' } }];
  const clock = new FakeClock();
  const media = fakeMediaFetch({
    // o primeiro escudo dá 500 sempre: falha transitória, continua pendente
    [team(1)]: [{ status: 500 }],
    [team(2)]: ok,
    [team(3)]: ok,
    [team(4)]: ok,
    [FLAG]: [{ status: 200, body: SVG, headers: { 'content-type': 'image/svg+xml' } }],
  });
  const assets = new InMemoryAssetStore([team(1), team(2), team(3), team(4), FLAG]);
  const cursors = new InMemoryCursorStore();
  const deps = {
    assets,
    objects: new InMemoryObjectStore(),
    fetcher: new MediaFetcher({ fetch: media.fetch, clock, backoffBaseMs: 1, maxRetries: 0 }),
    clock,
    delayMs: 0,
    concurrency: 2,
    cursor: mirrorCursorStore(cursors),
  };
  const callsTo = (url: string) => media.calls.filter((c) => c.url === url).length;
  return { deps, assets, cursors, callsTo };
}

describe('cursor do espelho de assets', () => {
  it('continua de onde parou em vez de repetir a cabeça da fila, e zera no fim da volta', async () => {
    const { deps, assets, callsTo } = setup();

    const r1 = await runAssetMirror({ ...deps, limit: 2 });
    expect(r1).toMatchObject({ pending: 2, stored: 1, failed: 1 });
    expect(r1.cursor).toEqual({ retomou: false, fimDaVolta: false, interrompida: false });
    const t1Calls = callsTo(team(1));

    // a segunda pula o escudo 1 (que falhou) e o 2: segue no 3 e no 4
    const r2 = await runAssetMirror({ ...deps, limit: 2 });
    expect(r2).toMatchObject({ pending: 2, stored: 2, failed: 0 });
    expect(r2.cursor?.retomou).toBe(true);
    expect(callsTo(team(1))).toBe(t1Calls);
    expect(assets.byUrl(team(4))!.storageKey).toBeTruthy();

    // a bandeira (outro tipo, sem cursor) e acabou a fila: o cursor zera
    const r3 = await runAssetMirror({ ...deps, limit: 2 });
    expect(r3).toMatchObject({ pending: 1, stored: 1 });
    expect(r3.cursor?.fimDaVolta).toBe(true);

    // volta nova: só o que ficou pendente, do início
    const r4 = await runAssetMirror({ ...deps, limit: 2 });
    expect(r4).toMatchObject({ pending: 1, failed: 1 });
    expect(r4.cursor).toEqual({ retomou: false, fimDaVolta: true, interrompida: false });
    expect(callsTo(team(1))).toBeGreaterThan(t1Calls);
  });

  it('SIGTERM: para de pegar asset novo e grava o cursor do que já fez', async () => {
    const { deps, assets, cursors } = setup();
    const stop = new AbortController();
    let n = 0;
    const r = await runAssetMirror({
      ...deps,
      concurrency: 1,
      signal: stop.signal,
      onProgress: () => {
        if (++n === 2) stop.abort();
      },
    });
    expect(r.cursor).toMatchObject({ interrompida: true, fimDaVolta: false });
    expect(r.stored + r.failed).toBe(2);
    expect(assets.byUrl(team(3))!.storageKey).toBeNull();
    // retoma no 3, sem repetir o 1 e o 2
    const saved = await mirrorCursorStore(cursors).load();
    expect(saved.team_logo?.id).toBe(assets.byUrl(team(2))!.id);
    const next = await runAssetMirror({ ...deps, concurrency: 1 });
    expect(next).toMatchObject({ pending: 3, stored: 3 });
    expect(next.cursor).toMatchObject({ retomou: true, fimDaVolta: true });
  });

  it('grava a cada N assets: uma queda no meio perde no máximo o lote corrente', async () => {
    const { deps, cursors } = setup();
    const saves: number[] = [];
    const store = mirrorCursorStore(cursors);
    const counting = {
      load: () => store.load(),
      save: async (c: Parameters<typeof store.save>[0]) => {
        saves.push(Object.keys(c).length);
        await store.save(c);
      },
    };
    await runAssetMirror({ ...deps, cursor: counting, concurrency: 1, checkpointEvery: 2 });
    // 5 assets: gravou depois do 2º e do 4º, e no fim (zerado: a fila acabou)
    expect(saves).toEqual([1, 1, 0]);
  });

  it('o escopo (caminho, ausentes) tem cursor próprio, e salvar vazio zera todos os tipos', async () => {
    const cursors = new InMemoryCursorStore();
    const padrao = mirrorCursorStore(cursors);
    const volei = mirrorCursorStore(cursors, { pathPrefix: '/volley/' });
    expect(mirrorScopeKey({ pathPrefix: '/volley/', includeMissing: true })).toBe(
      'caminho=volley&ausentes=1',
    );
    await padrao.save({ team_logo: { createdAt: 'a', id: '1' }, flag: { createdAt: 'b', id: '2' } });
    await volei.save({ team_logo: { createdAt: 'c', id: '3' } });
    expect(await padrao.load()).toEqual({
      team_logo: { createdAt: 'a', id: '1' },
      flag: { createdAt: 'b', id: '2' },
    });
    expect(await volei.load()).toEqual({ team_logo: { createdAt: 'c', id: '3' } });
    // zerar sem ler antes (`--do-inicio`) também zera todos os tipos
    await mirrorCursorStore(cursors).save({});
    expect(await mirrorCursorStore(cursors).load()).toEqual({});
    expect(await mirrorCursorStore(cursors, { pathPrefix: 'volley' }).load()).toEqual({
      team_logo: { createdAt: 'c', id: '3' },
    });
  });
});
