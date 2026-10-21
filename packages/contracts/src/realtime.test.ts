import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi.js';
import { resolveTopic, StreamQuery } from './realtime.js';

describe('StreamQuery', () => {
  it('aceita listas separadas por vírgula e nomes curtos ou completos de tópico', () => {
    const q = StreamQuery.parse({
      events: '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10, 0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d11',
      topics: 'score,status,where_to_watch.changed',
      last_event_id: '42',
    });
    expect(q.events).toHaveLength(2);
    expect(q.topics.map(resolveTopic)).toEqual([
      'event.score_changed',
      'event.status_changed',
      'where_to_watch.changed',
    ]);
    expect(q.last_event_id).toBe(42);
    expect(q.competitions).toEqual([]);
  });

  it('rejeita tópico desconhecido, id inválido e listas grandes demais', () => {
    expect(StreamQuery.safeParse({ topics: 'odds' }).success).toBe(false);
    expect(StreamQuery.safeParse({ events: 'abc' }).success).toBe(false);
    const many = Array.from({ length: 201 }, () => '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10').join(',');
    expect(StreamQuery.safeParse({ events: many }).success).toBe(false);
  });

  it('o /v1/stream está no OpenAPI', () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.['/v1/stream']?.get?.responses?.['200']).toBeDefined();
    expect(Object.keys(doc.components?.schemas ?? {})).toContain('RealtimeChange');
  });
});
