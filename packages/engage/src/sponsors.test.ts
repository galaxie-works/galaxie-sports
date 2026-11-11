import { describe, expect, it } from 'vitest';
import { DEFAULT_MODERATION_LISTS } from './moderation-defaults.js';
import { compileLists } from './moderation.js';
import { SPONSOR_CATEGORIES, sponsorVisible, validateSponsor, type SponsorInput } from './sponsors.js';

const lists = compileLists(DEFAULT_MODERATION_LISTS);
const input = (over: Partial<SponsorInput> = {}): SponsorInput => ({
  name: 'Cervejaria do Bairro',
  category: 'beverage',
  linkUrl: 'https://www.cervejaria.com.br/promo',
  logoLightUrl: 'https://cdn.cervejaria.com.br/logo.svg',
  logoDarkUrl: null,
  countries: ['br', 'AR'],
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2027-01-01T00:00:00Z',
  ...over,
});

describe('cadastro de patrocinador (B10, #1021)', () => {
  it('normaliza o cadastro válido', () => {
    const r = validateSponsor(input({ name: '  Cervejaria   do Bairro ' }), lists);
    expect(r).toMatchObject({
      ok: true,
      sponsor: { name: 'Cervejaria do Bairro', countries: ['AR', 'BR'], logoDarkUrl: null },
    });
  });

  it('não existe categoria de aposta', () => {
    expect(SPONSOR_CATEGORIES).not.toContain('betting');
    for (const category of ['betting', 'casino', 'apostas', 'loteria'])
      expect(validateSponsor(input({ category }), lists)).toEqual({
        ok: false,
        issues: [{ field: 'category', code: 'betting' }],
      });
    expect(validateSponsor(input({ category: 'xyz' }), lists)).toMatchObject({
      issues: [{ field: 'category', code: 'category' }],
    });
  });

  it.each([
    'Bet365',
    'Betano Brasil',
    'b3tano',
    'Casa de Apostas Sorte',
    'Esportes da Sorte',
    'Pixbet',
    'Superbet',
  ])('casa de aposta pelo nome é recusada: %s', (name) => {
    expect(validateSponsor(input({ name }), lists)).toMatchObject({
      ok: false,
      issues: [{ field: 'name', code: 'betting' }],
    });
  });

  it.each([
    'https://www.bet365.com/br',
    'https://betano.com',
    'https://promo.sportingbet.com/x',
    'https://qualquer.bet/',
    'https://www.f12.bet',
  ])('casa de aposta pelo link é recusada: %s', (linkUrl) => {
    expect(validateSponsor(input({ name: 'Parceiro', linkUrl }), lists)).toMatchObject({
      ok: false,
      issues: [{ field: 'linkUrl', code: 'betting' }],
    });
  });

  it.each(['Banco Alfa', 'Operadora Sul', 'Betty Calçados', 'Alphabet', 'Stakeholders Consultoria'])(
    'nome comum passa: %s',
    (name) => {
      expect(validateSponsor(input({ name }), lists).ok).toBe(true);
    },
  );

  it('link precisa ser https e sem usuário', () => {
    for (const linkUrl of ['http://x.com', 'javascript:alert(1)', 'https://u:p@x.com', 'não é link'])
      expect(validateSponsor(input({ linkUrl }), lists)).toMatchObject({
        issues: [{ field: 'linkUrl', code: 'url' }],
      });
    expect(validateSponsor(input({ linkUrl: '' }), lists)).toMatchObject({
      ok: true,
      sponsor: { linkUrl: null },
    });
  });

  it('países e vigência', () => {
    expect(validateSponsor(input({ countries: ['BRA'] }), lists)).toMatchObject({
      issues: [{ field: 'countries', code: 'countries' }],
    });
    expect(validateSponsor(input({ endsAt: '2026-10-01T00:00:00Z' }), lists)).toMatchObject({
      issues: [{ field: 'endsAt', code: 'dates' }],
    });
  });
});

describe('quem vê a peça do patrocinador', () => {
  const sp = { countries: ['BR'], startsAt: '2026-11-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' };
  const now = new Date('2026-12-01T00:00:00Z');
  const adult = { country: 'br', ageBand: '18plus' as const, now };

  it('adulto no país e na vigência vê', () => {
    expect(sponsorVisible(sp, adult, { adsToMinors: false })).toBe(true);
  });

  it('menor de 13 nunca vê; 13 a 17 só onde a ficha permite', () => {
    expect(sponsorVisible(sp, { ...adult, ageBand: 'under13' }, { adsToMinors: true })).toBe(false);
    expect(sponsorVisible(sp, { ...adult, ageBand: '13_17' }, { adsToMinors: false })).toBe(false);
    expect(sponsorVisible(sp, { ...adult, ageBand: '13_17' }, null)).toBe(false);
    expect(sponsorVisible(sp, { ...adult, ageBand: '13_17' }, { adsToMinors: true })).toBe(true);
  });

  it('fora do país, da vigência ou arquivado não vê', () => {
    expect(sponsorVisible(sp, { ...adult, country: 'AR' }, null)).toBe(false);
    expect(sponsorVisible(sp, { ...adult, now: new Date('2027-01-01T00:00:00Z') }, null)).toBe(false);
    expect(sponsorVisible(sp, { ...adult, now: new Date('2026-10-01T00:00:00Z') }, null)).toBe(false);
    expect(sponsorVisible({ ...sp, archived: true }, adult, null)).toBe(false);
    expect(sponsorVisible({ ...sp, countries: [] }, { ...adult, country: 'AR' }, null)).toBe(true);
  });
});
