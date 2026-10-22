import { describe, expect, it } from 'vitest';

import { apiLocale, isTimeZone, negotiateLocale, resolveLocale } from './config';
import { createFormatters } from './format';
import { fill, localized, ordinal, plural, rich } from './text';

describe('idioma da requisição', () => {
  it('negocia pelo Accept-Language, respeitando os pesos', () => {
    expect(negotiateLocale('es-AR,es;q=0.9,en;q=0.8')).toBe('es-AR');
    expect(negotiateLocale('es-MX')).toBe('es-AR');
    expect(negotiateLocale('en-US,en;q=0.9')).toBe('en');
    expect(negotiateLocale('pt-PT')).toBe('pt-BR');
    expect(negotiateLocale('fr-FR, en;q=0.5, es;q=0.8')).toBe('es-AR');
    expect(negotiateLocale('de-DE')).toBe('pt-BR');
    expect(negotiateLocale(null)).toBe('pt-BR');
  });

  it('o cookie vale mais que o navegador; cookie inválido é ignorado', () => {
    expect(resolveLocale('en', 'es-AR')).toBe('en');
    expect(resolveLocale('fr', 'es-AR')).toBe('es-AR');
    expect(resolveLocale(undefined, undefined)).toBe('pt-BR');
  });

  it('a API recebe pt-BR ou es-AR (inglês pede espanhol)', () => {
    expect(apiLocale('pt-BR')).toBe('pt-BR');
    expect(apiLocale('es-AR')).toBe('es-AR');
    expect(apiLocale('en')).toBe('es-AR');
  });

  it('só aceita fuso IANA válido', () => {
    expect(isTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isTimeZone('Marte/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});

describe('textos', () => {
  it('preenche variáveis', () => {
    expect(fill('Olá, {name}!', { name: 'Ana' })).toBe('Olá, Ana!');
    expect(fill('{a} e {b}', { a: 1 })).toBe('1 e {b}');
  });

  it('escolhe o plural', () => {
    const forms = { one: '{count} jogo', other: '{count} jogos' };
    expect(plural('pt-BR', 1, forms)).toBe('1 jogo');
    expect(plural('pt-BR', 3, forms)).toBe('3 jogos');
    expect(plural('en', 0, { one: '{count} match', other: '{count} matches' })).toBe('0 matches');
  });

  it('marca trechos com tags', () => {
    const out = rich('Use <c>?locale=</c> na query', { c: (s) => `[${s}]` }) as unknown[];
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('Use ');
    expect(out[2]).toBe(' na query');
    expect(rich('sem tags', {})).toBe('sem tags');
  });

  it('pega o texto da API no idioma certo', () => {
    expect(localized({ 'es-AR': 'En la pelea' }, 'es-AR')).toBe('En la pelea');
    expect(localized({ 'es-AR': 'En la pelea' }, 'en')).toBe('En la pelea');
    expect(localized({ 'pt-BR': 'Na briga', en: 'In the race' }, 'en')).toBe('In the race');
    expect(localized({ 'pt-BR': 'Na briga' }, 'pt-BR')).toBe('Na briga');
    expect(localized({ es: 'Final' }, 'es-AR')).toBe('Final');
    expect(localized(null, 'pt-BR')).toBe('');
  });

  it('escreve a posição em cada idioma', () => {
    expect(ordinal('pt-BR', 2)).toBe('2º');
    expect(ordinal('es-AR', 2)).toBe('2.º');
    expect(['1st', '2nd', '3rd', '4th', '11th', '22nd'].join()).toBe(
      [1, 2, 3, 4, 11, 22].map((n) => ordinal('en', n)).join(),
    );
  });
});

describe('datas e números', () => {
  const iso = '2026-10-24T19:00:00Z';

  it('formata no idioma e no fuso de quem vê', () => {
    expect(createFormatters('pt-BR', 'America/Sao_Paulo').time(iso)).toBe('16:00');
    expect(createFormatters('es-AR', 'America/Argentina/Buenos_Aires').time(iso)).toBe('16:00');
    expect(createFormatters('en', 'Europe/London').time(iso)).toMatch(/^8:00\sPM$/);
  });

  it('data de calendário não muda com o fuso', () => {
    expect(createFormatters('pt-BR', 'Pacific/Kiritimati').calendarDate('1990-05-01')).toBe('01/05/1990');
    expect(createFormatters('en', 'Pacific/Midway').calendarDate('1990-05-01')).toBe('05/01/1990');
  });

  it('separa milhares no idioma', () => {
    expect(createFormatters('pt-BR', 'UTC').number(45000)).toBe('45.000');
    expect(createFormatters('en', 'UTC').number(45000)).toBe('45,000');
  });
});
