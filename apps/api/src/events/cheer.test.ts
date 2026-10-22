import { describe, expect, it } from 'vitest';
import { pickCheer } from './cheer.js';

const palmeiras = {
  rallyingCries: ['Avanti, Palestra!'],
  copyHints: { 'pt-BR': { cheer: ['Avanti, Palestra!', 'Vai, Verdão!'] } },
  sources: ['https://pt.wikipedia.org/wiki/Sociedade_Esportiva_Palmeiras', 'https://exemplo.com/2'],
};

describe('pickCheer', () => {
  it('usa o grito do mercado e a primeira fonte do perfil', () => {
    expect(pickCheer(palmeiras, 'pt-BR')).toEqual({
      text: 'Avanti, Palestra!',
      source_url: 'https://pt.wikipedia.org/wiki/Sociedade_Esportiva_Palmeiras',
    });
  });

  it('copy_hints: locale exato e depois o idioma; pt-BR não cai para espanhol', () => {
    const hints = { es: { cheer: ['¡Vamos, Braga!'] }, 'pt-BR': { cheer: ['Vai, Braga!'] } };
    const p = { rallyingCries: [], copyHints: hints, sources: [] };
    expect(pickCheer(p, 'es-AR')).toEqual({ text: '¡Vamos, Braga!' });
    expect(pickCheer(p, 'pt-BR')).toEqual({ text: 'Vai, Braga!' });
    expect(pickCheer({ ...p, copyHints: { es: { cheer: ['¡Vamos!'] } } }, 'pt-BR')).toBeNull();
  });

  it('sem dica no mercado, cai para rallying_cries', () => {
    expect(pickCheer(palmeiras, 'es-AR')?.text).toBe('Avanti, Palestra!');
  });

  it('nunca serve letra: descarta erro e aviso de checkChant', () => {
    // texto fictício com cara de estrofe (nunca use letra real de hino nos testes)
    const verso = 'primeira linha inventada\nsegunda linha inventada';
    const longo = 'um dois três quatro cinco seis sete oito nove dez onze doze';
    const barras = 'trecho um / trecho dois / trecho três';
    expect(
      pickCheer({ rallyingCries: [verso, longo, barras], copyHints: null, sources: [] }, 'pt-BR'),
    ).toBeNull();
    expect(
      pickCheer({ rallyingCries: [verso, 'Vai, Verdão!'], copyHints: null, sources: [] }, 'pt-BR')?.text,
    ).toBe('Vai, Verdão!');
  });

  it('sem perfil ou sem grito → null', () => {
    expect(pickCheer(null, 'pt-BR')).toBeNull();
    expect(pickCheer({ rallyingCries: [], copyHints: {}, sources: ['https://x'] }, 'pt-BR')).toBeNull();
  });
});
