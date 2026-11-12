import { describe, expect, it } from 'vitest';
import {
  effectiveVisibility,
  MINOR_PROTECTION_DEFS,
  MINOR_PROTECTION_LOCALES,
  MINOR_PROTECTIONS,
  minorDefaultsApply,
  minorProtectionLocale,
  minorProtections,
} from './minor-defaults.js';

describe('padrão mais protetivo para menores (#1107)', () => {
  it('vale abaixo de 18 e na faixa congelada; adulto escolhe', () => {
    for (const band of ['13', '14_15', '16_17', '13_17'] as const)
      expect(minorDefaultsApply({ band, frozen: false }), band).toBe(true);
    expect(minorDefaultsApply({ band: '18plus', frozen: false })).toBe(false);
    expect(minorDefaultsApply({ band: '18plus', frozen: true })).toBe(true);
  });

  it('menor fica todo privado, seja o que for que está gravado', () => {
    const stored = { avatar: 'public', favorite_team: 'public', level: 'public' } as const;
    expect(effectiveVisibility({ band: '16_17', frozen: false }, stored)).toEqual({
      avatar: 'private',
      favorite_team: 'private',
      level: 'private',
      badges: 'private',
    });
    expect(effectiveVisibility({ band: '18plus', frozen: false }, stored)).toEqual(stored);
  });

  it('toda proteção tem texto nos quatro idiomas; quem o responsável pode desligar diz o que muda', () => {
    for (const id of MINOR_PROTECTIONS)
      for (const l of MINOR_PROTECTION_LOCALES) {
        const def = MINOR_PROTECTION_DEFS[id];
        expect(def.text[l].title.length, `${id} ${l}`).toBeGreaterThan(10);
        if (def.guardianCanRelax) expect(def.text[l].relaxed, `${id} ${l}`).toBeTruthy();
        else expect(def.text[l].relaxed, `${id} ${l}`).toBeNull();
      }
    // contato direto, publicidade, marketing e foto própria nunca saem antes dos 18
    for (const id of ['no_direct_contact', 'no_targeted_ads', 'no_marketing', 'no_own_photo'] as const)
      expect(MINOR_PROTECTION_DEFS[id].guardianCanRelax).toBe(false);
  });

  it('idioma do torcedor, com o pt-BR quando não há texto', () => {
    expect(minorProtectionLocale('es-AR')).toBe('es');
    expect(minorProtectionLocale('fr-FR')).toBe('fr-CA');
    expect(minorProtectionLocale('en-US')).toBe('en');
    expect(minorProtectionLocale('de-DE')).toBe('pt-BR');
    expect(minorProtections('en-US').map((p) => p.id)).toEqual([...MINOR_PROTECTIONS]);
    expect(minorProtections('es')[0]!.title).toMatch(/apodo/);
  });
});
