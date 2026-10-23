import { describe, expect, it } from 'vitest';
import { logoSource } from '../util.js';
import { creditText } from './photos.js';

describe('crédito das fotos da Commons', () => {
  it('linha pronta com autor, fonte e licença', () => {
    expect(creditText('Gabriele', 'CC BY 2.0')).toBe('Foto: Gabriele / Wikimedia Commons · CC BY 2.0');
    expect(creditText(null, 'Public domain')).toBe('Foto: Wikimedia Commons · Public domain');
  });

  it('foto da Commons nunca muda o contrato de logo_source', () => {
    expect(logoSource('acervo')).toBe('acervo');
    expect(logoSource('provider')).toBe('provider');
    expect(logoSource('commons')).toBe('provider');
    expect(logoSource(null)).toBeNull();
  });
});
