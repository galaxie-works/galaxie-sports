import { describe, expect, it } from 'vitest';
import { IMAGE_LIMITS } from '@galaxie/cosmos';
import { AVATAR_LIMITS, fetchAvatar, planAvatar } from './fan-avatar.js';

const now = new Date('2026-11-12T20:00:00Z');
const ref = () => 'ref-novo';
const url = 'https://cdn.exemplo.com/a.png';

describe('planAvatar (#1025)', () => {
  const decided = (status: 'visible' | 'held' | 'pending', at = now) => ({
    avatarUrl: url,
    avatarStatus: status,
    avatarRef: 'ref-velho',
    avatarHash: status === 'pending' ? null : 'hash-velho',
    avatarCheckedAt: at,
  });

  it('foto nova vai para a moderação, pendente, levando a decisão anterior', () => {
    expect(planAvatar(null, url, now, ref)).toEqual({
      fields: { avatarStatus: 'pending', avatarRef: 'ref-novo', avatarHash: null, avatarCheckedAt: now },
      check: { ref: 'ref-novo', url, previous: null },
    });
    const before = { ...decided('visible'), avatarUrl: 'https://cdn.exemplo.com/velha.png' };
    expect(planAvatar(before, url, now, ref).check).toEqual({
      ref: 'ref-novo',
      url,
      previous: { ref: 'ref-velho', hash: 'hash-velho', status: 'visible' },
    });
  });

  it('a mesma foto decidida há pouco não volta para a moderação; depois de recheckMs, volta', () => {
    for (const status of ['visible', 'held'] as const) {
      expect(planAvatar(decided(status), url, now, ref)).toEqual({ fields: {}, check: null });
      const old = new Date(now.getTime() - AVATAR_LIMITS.recheckMs);
      expect(planAvatar(decided(status, old), url, now, ref).check?.previous).toEqual({
        ref: 'ref-velho',
        hash: 'hash-velho',
        status,
      });
    }
  });

  it('foto de antes do #1025 (sem estado) passa pela moderação no próximo token', () => {
    const legacy = {
      avatarUrl: url,
      avatarStatus: null,
      avatarRef: null,
      avatarHash: null,
      avatarCheckedAt: null,
    };
    expect(planAvatar(legacy, url, now, ref).check).toEqual({ ref: 'ref-novo', url, previous: null });
  });

  it('pendente recente espera; pendente vencido tenta de novo', () => {
    const recent = new Date(now.getTime() - AVATAR_LIMITS.retryMs + 1000);
    const old = new Date(now.getTime() - AVATAR_LIMITS.retryMs);
    expect(planAvatar(decided('pending', recent), url, now, ref).check).toBeNull();
    expect(planAvatar(decided('pending', old), url, now, ref).check).not.toBeNull();
  });

  it('sem foto, o estado some junto', () => {
    expect(planAvatar(decided('visible'), null, now, ref)).toEqual({
      fields: { avatarStatus: null, avatarRef: null, avatarHash: null, avatarCheckedAt: null },
      check: null,
    });
  });
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const respond =
  (body: Uint8Array | null, init: ResponseInit = {}) =>
  async () =>
    new Response(body, init);

describe('fetchAvatar', () => {
  it('lê a foto', async () => {
    expect(Array.from(await fetchAvatar(respond(png), url))).toEqual(Array.from(png));
  });

  it('erro, resposta sem sucesso ou acima do teto devolvem vazio (a moderação manda para a fila)', async () => {
    expect(
      (await fetchAvatar(async () => Promise.reject(new TypeError('fetch failed')), url)).byteLength,
    ).toBe(0);
    expect((await fetchAvatar(respond(png, { status: 404 }), url)).byteLength).toBe(0);
    const big = String(IMAGE_LIMITS.maxBytes + 1);
    expect((await fetchAvatar(respond(png, { headers: { 'content-length': big } }), url)).byteLength).toBe(0);
    // sem content-length, o teto vale na leitura
    const huge = new Uint8Array(IMAGE_LIMITS.maxBytes + 1);
    expect((await fetchAvatar(respond(huge), url)).byteLength).toBe(0);
  });
});
