import { describe, expect, it } from 'vitest';
import { emptyEnvelope, mirrorTtlSec, orderEnvelope } from './mirror.js';

describe('espelho', () => {
  it('envelope vazio no formato da api-sports', () => {
    expect(emptyEnvelope('/fixtures', { date: '2026-10-21' })).toEqual({
      get: 'fixtures',
      parameters: { date: '2026-10-21' },
      errors: [],
      results: 0,
      paging: { current: 1, total: 1 },
      response: [],
    });
    expect(emptyEnvelope('/leagues', {}).parameters).toEqual([]);
  });

  it('reordena as chaves do envelope (o JSONB não preserva a ordem)', () => {
    const body = { paging: {}, errors: [], response: [], get: 'leagues', results: 0, parameters: [] };
    expect(Object.keys(orderEnvelope(body) as object)).toEqual([
      'get',
      'parameters',
      'errors',
      'results',
      'paging',
      'response',
    ]);
  });

  it('TTL segue o frescor do endpoint, entre 15 s e 24 h', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(mirrorTtlSec('/leagues', {}, now)).toBe(86_400);
    expect(mirrorTtlSec('/fixtures', { live: 'all' }, now)).toBe(15);
    expect(mirrorTtlSec('/fixtures', { league: '71', season: '2020' }, now)).toBe(86_400);
    expect(mirrorTtlSec('/fixtures', { date: '2026-10-21' }, now)).toBe(300);
  });
});
