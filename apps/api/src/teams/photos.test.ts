import { describe, expect, it } from 'vitest';
import { logoSource } from '../util.js';
import { creditText } from './photos.js';

describe('crédito das fotos da Commons', () => {
  it('linha pronta com autor, fonte e licença', () => {
    expect(creditText('Gabriele', 'CC BY 2.0')).toBe('Foto: Gabriele / Wikimedia Commons · CC BY 2.0');
    expect(creditText(null, 'Public domain')).toBe('Foto: Wikimedia Commons · Public domain');
  });

  it('logo_source: fornecedor, acervo ou Commons (logo de competição sem logo do fornecedor, com crédito)', () => {
    expect(logoSource('acervo')).toBe('acervo');
    expect(logoSource('provider')).toBe('provider');
    expect(logoSource('commons')).toBe('commons');
    expect(logoSource(null)).toBeNull();
  });
});
