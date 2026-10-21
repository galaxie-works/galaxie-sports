import { describe, expect, it } from 'vitest';
import { FOREVER, ttlFor } from './ttl.js';

const now = new Date('2026-10-21T14:00:00Z');

describe('ttlFor', () => {
  it('referência global vale um dia', () => {
    expect(ttlFor('/leagues', {}, now)).toBe(86_400_000);
  });

  it('jogos de datas antigas nunca expiram; hoje expira rápido', () => {
    expect(ttlFor('/fixtures', { date: '2026-10-18' }, now)).toBe(FOREVER);
    expect(ttlFor('/fixtures', { date: '2026-10-20' }, now)).toBe(30 * 60_000);
    expect(ttlFor('/fixtures', { date: '2026-10-21' }, now)).toBe(5 * 60_000);
    expect(ttlFor('/games', { date: '2026-10-21' }, now)).toBe(5 * 60_000);
  });

  it('ao vivo reaproveita no máximo 10 s', () => {
    expect(ttlFor('/fixtures', { live: 'all' }, now)).toBe(10_000);
  });

  it('temporadas encerradas são imutáveis', () => {
    expect(ttlFor('/fixtures', { league: '71', season: '2023' }, now)).toBe(FOREVER);
    expect(ttlFor('/fixtures', { league: '71', season: '2026' }, now)).toBe(60 * 60_000);
  });

  it('entidades lentas (h2h, transferências, elencos) valem uma semana', () => {
    expect(ttlFor('/fixtures/headtohead', { h2h: '121-131' }, now)).toBe(7 * 86_400_000);
    expect(ttlFor('/transfers', { team: '121' }, now)).toBe(7 * 86_400_000);
  });
});
