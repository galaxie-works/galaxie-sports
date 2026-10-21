import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../context.js';
import { MemoryResponseCache } from '../../cache/store.js';
import { copyHintsFor, effectiveMinReview, meetsReview, retrospect } from './semantic.js';

const ctx = (minReviewStatus?: 'draft' | 'reviewed' | 'approved'): AppContext =>
  ({
    db: undefined,
    cache: new MemoryResponseCache(),
    assetsBaseUrl: undefined,
    ...(minReviewStatus ? { semantic: { minReviewStatus } } : {}),
  }) as unknown as AppContext; // só os campos usados pelas funções puras testadas aqui

describe('piso editorial', () => {
  it('padrão approved; o pedido só endurece', () => {
    expect(effectiveMinReview(ctx(), undefined)).toBe('approved');
    expect(effectiveMinReview(ctx(), 'draft')).toBe('approved');
    expect(effectiveMinReview(ctx('draft'), undefined)).toBe('draft');
    expect(effectiveMinReview(ctx('draft'), 'reviewed')).toBe('reviewed');
    expect(effectiveMinReview(ctx('reviewed'), 'draft')).toBe('reviewed');
  });

  it('compara status na ordem draft < reviewed < approved', () => {
    expect(meetsReview('approved', 'reviewed')).toBe(true);
    expect(meetsReview('draft', 'reviewed')).toBe(false);
    expect(meetsReview('reviewed', 'reviewed')).toBe(true);
  });
});

describe('copyHintsFor', () => {
  const hints = { 'pt-BR': { cheer: ['Vai, Verdão!'] }, es: { nicknames: ['Verdão'] } };
  it('usa o locale exato e cai para o idioma, nunca para outro idioma', () => {
    expect(copyHintsFor(hints, 'pt-BR')).toEqual({ locale: 'pt-BR', cheer: ['Vai, Verdão!'], nicknames: [] });
    expect(copyHintsFor(hints, 'es-AR')).toEqual({ locale: 'es', cheer: [], nicknames: ['Verdão'] });
    expect(copyHintsFor({ es: {} }, 'pt-BR')).toEqual({ locale: null, cheer: [], nicknames: [] });
    expect(copyHintsFor(null, 'es-MX').locale).toBeNull();
  });
});

describe('retrospect', () => {
  const side = (slug: string, score: number) => ({
    slug,
    participant_id: '00000000-0000-0000-0000-000000000000',
    name: slug,
    score,
  });
  const match = (iso: string, home: [string, number], away: [string, number]) => ({
    event_id: iso,
    starts_at: iso,
    startsAtMs: Date.parse(iso),
    competition: null,
    home: side(...home),
    away: side(...away),
    winner: home[1] > away[1] ? home[0] : away[1] > home[1] ? away[0] : null,
    penalties: null,
  });

  it('conta V/E/D e gols e ordena goleadas por saldo, gols e data', () => {
    const r = retrospect(
      [
        match('2024-01-01T00:00:00Z', ['a', 3], ['b', 0]),
        match('2023-01-01T00:00:00Z', ['b', 4], ['a', 1]),
        match('2022-01-01T00:00:00Z', ['a', 2], ['b', 2]),
        match('2021-01-01T00:00:00Z', ['a', 1], ['b', 0]),
      ],
      true,
      'a',
      'b',
    );
    expect(r).toMatchObject({ matches: 4, draws: 1, available: true, source: 'core' });
    expect(r.teams).toEqual([
      { slug: 'a', wins: 2, goals: 7 },
      { slug: 'b', wins: 1, goals: 6 },
    ]);
    // saldo 3 empatado: 4×1 (5 gols) antes de 3×0 (3 gols)
    expect(r.biggest_wins.map((m) => m.event_id)).toEqual([
      '2023-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
      '2021-01-01T00:00:00Z',
    ]);
    expect(r.last_5[0]!.event_id).toBe('2024-01-01T00:00:00Z');
    expect(r.first_match_at).toBe('2021-01-01T00:00:00Z');
    expect('startsAtMs' in r.last_5[0]!).toBe(false);
  });

  it('sem confrontos: zeros e datas nulas', () => {
    expect(retrospect([], false, 'a', 'b')).toMatchObject({
      available: false,
      matches: 0,
      draws: 0,
      biggest_wins: [],
      last_5: [],
      first_match_at: null,
      last_match_at: null,
    });
  });
});
