import { describe, expect, it } from 'vitest';

import { BRAND_VOICE_AVOID_MAX, parseBrandVoice } from './brand-voice.js';

describe('guia de tom', () => {
  it('limpa e tira repetição das palavras a evitar', () => {
    expect(
      parseBrandVoice({
        tone: 'fan',
        length: 'long',
        avoid: [' Massacre ', 'massacre', '', 'freguês  de caderno'],
      }),
    ).toEqual({
      tone: 'fan',
      length: 'long',
      avoid: ['Massacre', 'freguês de caderno'],
    });
  });

  it('recusa tom ou tamanho fora da lista, campo desconhecido e lista grande demais', () => {
    expect(parseBrandVoice({ tone: 'ironic', length: 'long', avoid: [] })).toBeNull();
    expect(parseBrandVoice({ tone: 'formal', length: 'huge', avoid: [] })).toBeNull();
    expect(parseBrandVoice({ tone: 'formal', length: 'short', avoid: [], extra: 1 })).toBeNull();
    expect(parseBrandVoice({ tone: 'formal', length: 'short', avoid: ['x'.repeat(41)] })).toBeNull();
    expect(
      parseBrandVoice({
        tone: 'formal',
        length: 'short',
        avoid: Array.from({ length: BRAND_VOICE_AVOID_MAX + 1 }, (_, i) => `p${i}`),
      }),
    ).toBeNull();
    expect(parseBrandVoice(null)).toBeNull();
  });
});
