import { describe, expect, it } from 'vitest';

import { createRateLimiter, isProxyPathAllowed } from './proxy-policy';

describe('isProxyPathAllowed', () => {
  it('só recursos de leitura do app, nunca a conta nem a lista de canais', () => {
    expect(isProxyPathAllowed(['v1', 'teams', '1'])).toBe(true);
    expect(isProxyPathAllowed(['v1', 'account'])).toBe(false);
    expect(isProxyPathAllowed(['v1', 'channel-list'])).toBe(false);
    expect(isProxyPathAllowed(['v1', 'teams', '', 'x'])).toBe(false);
    expect(isProxyPathAllowed(['v1', 'teams', 'a\\..'])).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('janela fixa por chave: bloqueia o excedente e libera na janela seguinte', () => {
    const take = createRateLimiter(2, 60_000);
    expect(take('a', 0)).toBe(0);
    expect(take('a', 1_000)).toBe(0);
    expect(take('a', 30_000)).toBe(30);
    expect(take('b', 30_000)).toBe(0);
    expect(take('a', 60_000)).toBe(0);
  });
});
