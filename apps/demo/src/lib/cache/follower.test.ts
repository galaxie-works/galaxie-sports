import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChangeFeedFollower, type FeedRow, type FeedStore, type SavedCursor } from './follower';

/** Change feed em memória: só as linhas "commitadas" aparecem na leitura e no max(id). */
class MemoryFeed implements FeedStore {
  rows: FeedRow[] = [];
  saved = new Map<string, SavedCursor>();
  onNotify: (() => void) | undefined;
  failLatest = 0;
  failListen = false;

  add(id: number, entityType: string, entityId: string, payload: unknown = null, notify = true) {
    this.rows.push({ id, entityType, entityId, payload });
    if (notify) this.onNotify?.();
  }

  async latestId() {
    if (this.failLatest > 0) {
      this.failLatest--;
      throw new Error('banco fora');
    }
    return Math.max(0, ...this.rows.map((r) => r.id));
  }

  async readAfter(floor: number, skip: readonly number[], limit: number) {
    return this.rows
      .filter((r) => r.id > floor && !skip.includes(r.id))
      .sort((a, b) => a.id - b.id)
      .slice(0, limit);
  }

  async listen(onChange: () => void) {
    if (this.failListen) throw new Error('LISTEN recusado');
    this.onNotify = onChange;
    return async () => {
      this.onNotify = undefined;
    };
  }

  async loadCursor(name: string) {
    return this.saved.get(name) ?? null;
  }

  async saveCursor(name: string, lastId: number) {
    this.saved.set(name, { lastId, updatedAt: new Date() });
  }
}

const HOUR = 3_600_000;
let feed: MemoryFeed;
let calls: string[][];
let revalidate: ReturnType<typeof vi.fn<(tags: string[]) => Promise<void>>>;
let follower: ChangeFeedFollower | undefined;

const make = (options: ConstructorParameters<typeof ChangeFeedFollower>[2] = {}) => {
  follower = new ChangeFeedFollower(feed, revalidate, { confirmMs: 0, ...options });
  return follower;
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-25T12:00:00Z') });
  feed = new MemoryFeed();
  calls = [];
  revalidate = vi.fn(async (tags: string[]) => {
    calls.push(tags);
  });
});

afterEach(async () => {
  await follower?.stop();
  follower = undefined;
  vi.useRealTimers();
});

describe('ChangeFeedFollower: ponto de partida', () => {
  it('primeira subida: começa do ID mais recente, sem reprocessar o histórico, e grava o ponto', async () => {
    feed.add(1, 'f1_editorial', 'lendas.senna');
    feed.add(2, 'event', 'e1');
    const f = make();
    await f.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(revalidate).not.toHaveBeenCalled();
    expect(f.floor).toBe(2);
    expect(feed.saved.get('demo-cache')?.lastId).toBe(2);
  });

  it('reinício: retoma do cursor salvo recente e revalida o que mudou enquanto estava fora', async () => {
    feed.add(1, 'team_profile', 'palmeiras');
    feed.add(2, 'f1_editorial', 'lendas.senna');
    feed.add(3, 'venue', 'v1', { tags: ['participant'] });
    feed.saved.set('demo-cache', { lastId: 1, updatedAt: new Date(Date.now() - HOUR) });
    const f = make();
    await f.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([
      ['f1_editorial:lendas.senna', 'f1_editorial', 'venue:v1', 'venue', 'participant'],
    ]);
    expect(f.floor).toBe(3);
  });

  it('cursor velho ou atrasado demais: começa do mais recente', async () => {
    for (let id = 1; id <= 5; id++) feed.add(id, 'event', `e${id}`);
    feed.saved.set('demo-cache', { lastId: 1, updatedAt: new Date(Date.now() - 48 * HOUR) });
    await make().start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(revalidate).not.toHaveBeenCalled();
    await follower!.stop();

    feed.saved.set('demo-cache', { lastId: 1, updatedAt: new Date() });
    const f = make({ resumeMaxLag: 2 });
    await f.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(revalidate).not.toHaveBeenCalled();
    expect(f.floor).toBe(5);
  });

  it('banco fora na subida: não rejeita e tenta de novo depois', async () => {
    feed.failLatest = 1;
    feed.add(1, 'event', 'e1');
    const f = make({ retryStartMs: 1_000 });
    await expect(f.start()).resolves.toBeUndefined();
    expect(f.floor).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.floor).toBe(1);
  });
});

describe('ChangeFeedFollower: revalidação', () => {
  it('NOTIFY: espera a janela, junta a rajada numa chamada com as tags do change feed', async () => {
    const f = make({ settleMs: 1_000 });
    await f.start();
    feed.add(1, 'f1_editorial', 'lendas.senna');
    feed.add(2, 'related_content', 'e9', { tags: ['related_content:e9', 'event:e9'] });
    await vi.advanceTimersByTimeAsync(999);
    expect(revalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([
      ['f1_editorial:lendas.senna', 'f1_editorial', 'related_content:e9', 'related_content', 'event:e9'],
    ]);
    expect(f.floor).toBe(2);
  });

  it('lote grande: tags em várias chamadas e linhas lidas em páginas', async () => {
    const f = make({ batch: 2, chunk: 3 });
    await f.start();
    for (let id = 1; id <= 3; id++) feed.add(id, 'team_profile', `t${id}`, null, false);
    await f.poll();
    expect(calls).toEqual([
      ['team_profile:t1', 'team_profile', 'team_profile:t2'],
      ['team_profile:t3', 'team_profile'],
    ]);
    expect(f.floor).toBe(3);
  });

  it('falha na revalidação: as linhas voltam na próxima varredura e o piso só anda depois', async () => {
    const f = make({ pollIntervalMs: 5_000 });
    await f.start();
    revalidate.mockRejectedValueOnce(new Error('rota fora'));
    feed.add(1, 'f1_editorial', 'lendas.prost', null, false);
    await f.poll();
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(f.floor).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual([['f1_editorial:lendas.prost', 'f1_editorial']]);
    expect(f.floor).toBe(1);
  });

  it('lacuna: o ID menor que fica visível depois (transação lenta) também é revalidado', async () => {
    const f = make();
    await f.start();
    feed.add(2, 'team_profile', 'b', null, false);
    await f.poll();
    expect(calls).toEqual([['team_profile:b', 'team_profile']]);
    expect(f.floor).toBe(0);
    feed.add(1, 'team_profile', 'a', null, false);
    await f.poll();
    expect(calls.at(-1)).toEqual(['team_profile:a', 'team_profile']);
    expect(f.floor).toBe(2);
    await f.poll();
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it('segunda passada só das tags que expiram na hora (cobre a API que ainda não tinha purgado)', async () => {
    const f = make({ confirmMs: 10_000 });
    await f.start();
    feed.add(1, 'event', 'e1', { tags: ['standing', 'competition:c1'] }, false);
    await f.poll();
    expect(calls).toEqual([['event:e1', 'event', 'standing', 'competition:c1']]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.at(-1)).toEqual(['event:e1', 'competition:c1']);
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it('LISTEN indisponível: segue pela varredura periódica', async () => {
    feed.failListen = true;
    const f = make({ pollIntervalMs: 5_000 });
    await f.start();
    feed.add(1, 'derby', 'd1', null, false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual([['derby:d1', 'derby']]);
  });

  it('grava o cursor no máximo a cada saveEveryMs e ao parar', async () => {
    const f = make({ saveEveryMs: 60_000 });
    await f.start();
    feed.add(1, 'derby', 'd1', null, false);
    await f.poll();
    expect(feed.saved.get('demo-cache')?.lastId).toBe(0);
    await f.stop();
    expect(feed.saved.get('demo-cache')?.lastId).toBe(1);
  });
});
