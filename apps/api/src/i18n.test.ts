import { describe, expect, it } from 'vitest';
import {
  fallbackChain,
  formatInstant,
  hintLocales,
  parseAcceptLanguage,
  pickList,
  pickText,
  resolveLocale,
} from './i18n.js';

describe('locale', () => {
  it('?locale tem precedência sobre Accept-Language', () => {
    expect(resolveLocale('es-MX', 'pt-BR')).toBe('es-MX');
  });

  it('casa Accept-Language pela tag exata, pelo idioma e respeita q', () => {
    expect(resolveLocale(undefined, 'es-CL,es;q=0.9')).toBe('es-CL');
    expect(resolveLocale(undefined, 'fr-FR, es;q=0.8, pt;q=0.9')).toBe('pt-BR');
    expect(resolveLocale(undefined, 'es-ES')).toBe('es-AR');
    expect(resolveLocale(undefined, 'de-DE')).toBe('pt-BR');
    expect(resolveLocale(undefined, undefined)).toBe('pt-BR');
    expect(parseAcceptLanguage('en;q=0, es-AR')).toEqual(['es-AR']);
  });

  it('fallback es-XX → es → en', () => {
    expect(fallbackChain('es-AR')).toEqual(['es-AR', 'es', 'en']);
    const text = { es: 'Fútbol', en: 'Football', 'pt-BR': 'Futebol' };
    expect(pickText(text, 'es-AR')).toBe('Fútbol');
    expect(pickText({ en: 'Brazil' }, 'es-AR')).toBe('Brazil');
    expect(pickText({ 'pt-BR': 'Brasileirão' }, 'es-AR', 'Serie A')).toBe('Serie A');
    expect(pickText({ 'pt-BR': 'Brasileirão' }, 'es-AR')).toBe('Brasileirão');
    expect(pickText(null, 'pt-BR')).toBeNull();
    expect(pickList({ 'pt-BR': ['Liberta'], es: ['La Copa'] }, 'es-UY')).toEqual(['La Copa']);
    expect(pickList({ 'pt-BR': ['Liberta'] }, 'es-UY')).toEqual([]);
  });
});

describe('fuso', () => {
  it('formata instantes com o offset do fuso pedido', () => {
    const d = new Date('2026-10-22T00:30:00.000Z');
    expect(formatInstant(d)).toBe('2026-10-22T00:30:00Z');
    expect(formatInstant(d, 'America/Sao_Paulo')).toBe('2026-10-21T21:30:00-03:00');
    expect(formatInstant(d, 'Asia/Kolkata')).toBe('2026-10-22T06:00:00+05:30');
  });
});

describe('hintLocales', () => {
  it('pedido, depois o locale do clube no mesmo idioma, depois o idioma', () => {
    expect(hintLocales('es-MX', 'es-AR')).toEqual(['es-MX', 'es-AR', 'es']);
    expect(hintLocales('es-AR', 'es-AR')).toEqual(['es-AR', 'es']);
    expect(hintLocales('pt-BR', 'es-AR')).toEqual(['pt-BR', 'pt']);
    expect(hintLocales('es-CL')).toEqual(['es-CL', 'es']);
  });
});
