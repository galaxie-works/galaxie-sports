import { describe, expect, it } from 'vitest';
import { contrastText, FALLBACK_COLORS, lighten, MONOCHROME_COLOR, versusColors } from './team-colors';

const palmeiras = { primary: '#01713d', secondary: null, monochrome: false };
const fluminense = { primary: '#7a1f3d', secondary: '#0b6e3a', monochrome: false };
const flamengo = { primary: '#c02a1e', secondary: null, monochrome: false };
const corinthians = { primary: '#e13a30', secondary: null, monochrome: false };
const boca = { primary: '#03458a', secondary: '#efac07', monochrome: false };
const botafogo = { primary: '#3a3a3a', secondary: null, monochrome: true };
const sameBlue = { primary: '#05408a', secondary: '#efac07', monochrome: false };

describe('versusColors', () => {
  it('usa a cor predominante de cada escudo quando são bem diferentes', () => {
    expect(versusColors(palmeiras, fluminense)).toEqual(['#01713d', '#7a1f3d']);
  });

  it('escudo monocromático vira cinza claro', () => {
    expect(versusColors(botafogo, palmeiras)).toEqual([MONOCHROME_COLOR, '#01713d']);
  });

  it('cores parecidas sem secundária: o visitante fica mais claro', () => {
    const [a, b] = versusColors(flamengo, corinthians);
    expect(a).toBe('#c02a1e');
    expect(b).toBe(lighten('#e13a30', 0.55));
  });

  it('cores parecidas com secundária distinta: o visitante usa a secundária', () => {
    expect(versusColors(boca, sameBlue)).toEqual(['#03458a', '#efac07']);
  });

  it('sem paleta: cores do tema', () => {
    expect(versusColors(null, undefined)).toEqual([...FALLBACK_COLORS]);
    expect(versusColors(palmeiras, null)).toEqual(['#01713d', FALLBACK_COLORS[1]]);
  });
});

describe('contrastText', () => {
  it('branco sobre cores escuras, preto sobre claras e o texto do tema sem paleta', () => {
    expect(contrastText('#01713d')).toBe('#ffffff');
    expect(contrastText('#900028')).toBe('#ffffff');
    expect(contrastText(MONOCHROME_COLOR)).toBe('#09090b');
    expect(contrastText('#efac07')).toBe('#09090b');
    expect(contrastText('var(--primary)')).toBe('var(--primary-foreground)');
  });

  it('cores médias (luminância entre ~0,18 e 0,4) ganham preto, que dá mais contraste que branco', () => {
    // #e13a30: branco ficaria em ~4,3:1, abaixo de 4,5:1; preto passa de 4,5:1
    expect(contrastText('#e13a30')).toBe('#09090b');
    expect(contrastText('#1e88e5')).toBe('#09090b');
    // abaixo do cruzamento o branco continua melhor
    expect(contrastText('#c62828')).toBe('#ffffff');
  });
});
