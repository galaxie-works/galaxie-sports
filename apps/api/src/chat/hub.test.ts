import { describe, expect, it } from 'vitest';
import { ChatHub, type ChatBatch } from './hub.js';

const msg = (id: string) => ({
  id,
  body: id,
  author: { profile_id: '0190f1c0-0000-7000-8000-0000000000b1', nickname: 'T', avatar_url: null },
  created_at: '2026-11-12T00:00:00.000Z',
});

describe('ChatHub em memória', () => {
  it('junta as mensagens da sala num lote por ciclo, numerado, só para a sala certa', async () => {
    const hub = new ChatHub({ historySize: 2 });
    const got: ChatBatch[] = [];
    const other: ChatBatch[] = [];
    hub.subscribe('t1:j1', (b) => got.push(b));
    hub.subscribe('t2:j1', (b) => other.push(b));
    await hub.enqueue('t1:j1', msg('a'));
    await hub.enqueue('t1:j1', msg('b'));
    await hub.tick();
    expect(got).toEqual([
      { room: 't1:j1', epoch: expect.any(String), id: 1, messages: [msg('a'), msg('b')] },
    ]);
    expect(other).toEqual([]);
    await hub.tick();
    expect(got).toHaveLength(1);
  });

  it('since devolve o que faltou e avisa quando saiu do histórico', async () => {
    const hub = new ChatHub({ historySize: 2 });
    for (const id of ['a', 'b', 'c']) {
      await hub.enqueue('r', msg(id));
      await hub.tick();
    }
    const latest = await hub.latest('r');
    expect(latest.id).toBe(3);
    const at = (id: number) => ({ epoch: latest.epoch, id });
    const ok = await hub.since('r', at(2));
    expect(ok).toMatchObject({ complete: true });
    expect(ok.batches.map((b) => b.id)).toEqual([3]);
    const lost = await hub.since('r', at(0));
    expect(lost.complete).toBe(false);
    expect(lost.batches.map((b) => b.id)).toEqual([2, 3]);
    expect((await hub.since('r', at(3))).complete).toBe(true);
    // época diferente ou cursor à frente da sala: não emenda
    expect((await hub.since('r', { epoch: '1', id: 2 })).complete).toBe(false);
    expect((await hub.since('r', at(9))).complete).toBe(false);
  });

  it('limita a fila da sala: saem as mais antigas', async () => {
    const hub = new ChatHub({ maxQueue: 2 });
    const got: ChatBatch[] = [];
    hub.subscribe('r', (b) => got.push(b));
    for (const id of ['a', 'b', 'c']) await hub.enqueue('r', msg(id));
    await hub.tick();
    expect(got[0]!.messages.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('limita o tamanho do lote', async () => {
    const hub = new ChatHub({ maxPerBatch: 2 });
    const got: ChatBatch[] = [];
    hub.subscribe('r', (b) => got.push(b));
    for (const id of ['a', 'b', 'c']) await hub.enqueue('r', msg(id));
    await hub.tick();
    await hub.tick();
    expect(got.map((b) => b.messages.length)).toEqual([2, 1]);
  });
});
