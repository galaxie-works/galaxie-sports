import { describe, expect, it } from 'vitest';

import { createRateLimiter, isProxyFanRead, isProxyPathAllowed, isProxyWriteAllowed } from './proxy-policy';

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

describe('proxy: Diretrizes do chat (#957)', () => {
  it('o GET vai como leitura do torcedor (nunca com a chave da demo) e o aceite como escrita', () => {
    expect(isProxyFanRead(['v1', 'chat', 'guidelines'])).toBe(true);
    expect(isProxyPathAllowed(['v1', 'chat', 'guidelines'])).toBe(false);
    expect(isProxyWriteAllowed(['v1', 'chat', 'guidelines', 'accept'])).toBe(true);
    expect(isProxyWriteAllowed(['v1', 'chat', 'guidelines', 'x'])).toBe(false);
  });
});
