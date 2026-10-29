import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { RealtimeChange } from '@galaxie/contracts';
import { GAP_TIMEOUT_MS, type AbandonedGap } from '@galaxie/db';
import { scopeChange, toRealtimeChange, topicsForTenant, type ChangeFilter } from './changes.js';
import { GapCursor } from './gap-cursor.js';
import { formatSse, redactKey, SseConnection } from './sse.js';

describe('GapCursor', () => {
  it('avança só sobre IDs contíguos e não reprocessa os vistos', () => {
    const c = new GapCursor(10);
    c.mark([11, 12, 14]);
    expect(c.floor).toBe(12);
    expect(c.seenIds).toEqual([14]);
    expect(c.isNew(14)).toBe(false);
    expect(c.isNew(13)).toBe(true);
    c.mark([13]);
    expect(c.floor).toBe(14);
    expect(c.seenIds).toEqual([]);
  });

  it('abandona uma lacuna vencida só depois de reler (transação revertida)', () => {
    let now = 0;
    const abandoned: AbandonedGap[] = [];
    const c = new GapCursor(0, { gapTimeoutMs: 1_000, now: () => now, onAbandon: (g) => abandoned.push(g) });
    c.mark([1, 3, 4]);
    expect(c.floor).toBe(1);
    now = 999;
    c.advance();
    expect(c.floor).toBe(1);
    now = 1_000;
    c.advance(); // venceu, mas a última leitura é de antes do vencimento
    expect(c.floor).toBe(1);
    c.mark([]); // releitura sem o 2
    expect(c.floor).toBe(4);
    expect(abandoned).toEqual([{ from: 2, to: 2, reason: 'timeout', waitedMs: 1_000 }]);
  });

  it('o COMMIT que chega entre o vencimento e a releitura não se perde', () => {
    let now = 0;
    const abandoned: AbandonedGap[] = [];
    const c = new GapCursor(0, { gapTimeoutMs: 1_000, now: () => now, onAbandon: (g) => abandoned.push(g) });
    c.mark([1, 3]);
    now = 5_000;
    c.advance();
    c.advance(); // sem leitura nova, nunca abandona
    expect(c.floor).toBe(1);
    expect(c.isNew(2)).toBe(true);
    c.mark([2]); // a transação lenta comitou: a releitura traz o 2
    expect(c.floor).toBe(3);
    expect(abandoned).toEqual([]);
  });

  it('padrão de 90 s: uma transação de 60 s do ingestor não abre lacuna', () => {
    let now = 0;
    const c = new GapCursor(0, { now: () => now });
    c.mark([1, 3]);
    for (now = 1_000; now <= 60_000; now += 1_000) c.mark([]);
    expect(c.floor).toBe(1);
    c.mark([2]);
    expect(c.floor).toBe(3);
    expect(GAP_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('lacunas consecutivas têm cada uma o seu prazo', () => {
    let now = 0;
    const c = new GapCursor(0, { gapTimeoutMs: 100, now: () => now });
    c.mark([2, 4]);
    now = 100;
    c.mark([]);
    c.mark([]);
    expect(c.floor).toBe(2); // pulou o 1; o 3 começa a contar agora
    now = 150;
    c.mark([]);
    expect(c.floor).toBe(2);
    now = 200;
    c.mark([]);
    c.mark([]);
    expect(c.floor).toBe(4);
  });

  it('proteção de memória: muitas linhas acima da lacuna a encerram sem esperar', () => {
    const abandoned: AbandonedGap[] = [];
    const c = new GapCursor(0, { maxSeen: 3, now: () => 0, onAbandon: (g) => abandoned.push(g) });
    c.mark([5, 6]);
    expect(c.floor).toBe(0);
    c.mark([7]);
    expect(c.floor).toBe(7);
    expect(abandoned).toEqual([{ from: 1, to: 4, reason: 'max_seen', waitedMs: 0 }]);
  });
});

const row = (topic: string, payload: Record<string, unknown>, id = 7) => ({
  id,
  topic,
  entityType: 'event',
  entityId: 'e1',
  payload,
  createdAt: new Date('2026-10-21T22:00:00Z'),
});

const enterprise = {
  modules: ['core_data', 'where_to_watch', 'live_intelligence'] as const,
  markets: [],
  sports: [],
};
const all: ChangeFilter = { topics: new Set(topicsForTenant(enterprise)) };

describe('toRealtimeChange e scopeChange', () => {
  it('converte para a forma pública e ignora tópicos internos', () => {
    expect(toRealtimeChange(row('catalog', {}))).toBeUndefined();
    const c = toRealtimeChange(
      row('event.score_changed', {
        event_id: 'e1',
        sport: 'football',
        competition_id: 'c1',
        changed: ['score'],
        data: { score: { home: 1, away: 0 } },
        tags: ['interna'],
      }),
    );
    expect(c).toEqual({
      id: '7',
      topic: 'event.score_changed',
      event_id: 'e1',
      sport: 'football',
      competition_id: 'c1',
      changed: ['score'],
      data: { score: { home: 1, away: 0 } },
      occurred_at: '2026-10-21T22:00:00.000Z',
    });
  });

  const score = toRealtimeChange(
    row('event.score_changed', { event_id: 'e1', sport: 'football', competition_id: 'c1', data: {} }),
  )!;
  const wtw = toRealtimeChange(
    row('where_to_watch.changed', { event_id: 'e1', sport: 'football', data: { countries: ['BR', 'AR'] } }),
  )!;

  it('filtra por tópico, evento, competição e esporte', () => {
    expect(scopeChange(score, all, enterprise)).toBe(score);
    expect(scopeChange(score, { topics: new Set(['event.status_changed']) }, enterprise)).toBeUndefined();
    expect(scopeChange(score, { ...all, events: new Set(['e2']) }, enterprise)).toBeUndefined();
    expect(scopeChange(score, { ...all, events: new Set(['e1']) }, enterprise)).toBe(score);
    expect(scopeChange(score, { ...all, competitions: new Set(['c2']) }, enterprise)).toBeUndefined();
    expect(scopeChange(score, { ...all, sports: new Set(['basketball']) }, enterprise)).toBeUndefined();
  });

  it('respeita o contrato do tenant: módulos, esportes e mercados', () => {
    const coreOnly = { modules: ['core_data'] as const, markets: [], sports: [] };
    expect(topicsForTenant(coreOnly)).toEqual([
      'event.status_changed',
      'event.score_changed',
      'event.incident_added',
    ]);
    expect(scopeChange(wtw, all, coreOnly)).toBeUndefined();
    expect(scopeChange(score, all, { ...enterprise, sports: ['basketball'] })).toBeUndefined();
    const br = scopeChange(wtw, all, { ...enterprise, markets: ['BR'] });
    expect(br?.data.countries).toEqual(['BR']);
    expect(scopeChange(wtw, all, { ...enterprise, markets: ['MX'] })).toBeUndefined();
  });
});

/** ServerResponse falso: `write` devolve false quando o "socket" está cheio. */
class FakeResponse extends EventEmitter {
  chunks: string[] = [];
  full = false;
  ended = false;
  destroyed = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return !this.full;
  }
  end(): void {
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

const change = (id: number): RealtimeChange => ({
  id: String(id),
  topic: 'event.score_changed',
  event_id: 'e1',
  sport: 'football',
  competition_id: null,
  changed: ['score'],
  data: { score: { home: id, away: 0 } },
  occurred_at: '2026-10-21T22:00:00.000Z',
});

describe('SseConnection', () => {
  it('formata id/event/data e não reenvia a mesma mudança', () => {
    const res = new FakeResponse();
    const conn = new SseConnection(res as unknown as ServerResponse, 1024, () => {});
    conn.send(change(1));
    conn.send(change(1));
    expect(res.chunks).toEqual([formatSse('event.score_changed', change(1), '1')]);
    expect(res.chunks[0]).toMatch(/^id: 1\nevent: event\.score_changed\ndata: \{.*\}\n\n$/);
  });

  it('enfileira enquanto o socket não esvazia e derruba o cliente lento ao estourar o buffer', () => {
    const res = new FakeResponse();
    let overflow = false;
    const conn = new SseConnection(res as unknown as ServerResponse, 600, () => {
      overflow = true;
      conn.destroy();
    });
    res.full = true;
    conn.send(change(1)); // escrito, mas o socket encheu
    conn.send(change(2)); // enfileirado
    expect(res.chunks).toHaveLength(1);
    expect(conn.bufferedBytes).toBeGreaterThan(0);

    res.full = false;
    res.emit('drain');
    expect(res.chunks).toHaveLength(2);
    expect(conn.bufferedBytes).toBe(0);

    res.full = true;
    for (let i = 3; i < 20 && !overflow; i++) conn.send(change(i));
    expect(overflow).toBe(true);
    expect(res.destroyed).toBe(true);
  });
});

describe('redactKey', () => {
  it('remove a chave da URL antes de logar', () => {
    expect(redactKey('/v1/stream?events=a&key=gs_test_abc_def&topics=score')).toBe(
      '/v1/stream?events=a&key=[redacted]&topics=score',
    );
    expect(redactKey('/v1/stream?key=x')).toBe('/v1/stream?key=[redacted]');
    expect(redactKey('/v1/sports?monkey=1')).toBe('/v1/sports?monkey=1');
    // token curto do SSE também não vai para o log
    expect(redactKey('/v1/stream?token=gst_abc.def&events=x')).toBe('/v1/stream?token=[redacted]&events=x');
    expect(redactKey('/v1/stream?TOKEN=1&key=2')).toBe('/v1/stream?TOKEN=[redacted]&key=[redacted]');
  });
});
