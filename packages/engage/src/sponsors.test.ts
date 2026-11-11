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
    'Estrela Bet',
    'Vai de Bet',
    'Bet 365',
    'Sporting Bet',
    '\u0392et365',
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

  it.each([
    ['logoLightUrl', 'https://cdn.bet365.com/logo.png'],
    ['logoDarkUrl', 'https://betano.com/logo.svg'],
    ['linkUrl', 'https://example.com/?r=https://bet365.com'],
    ['linkUrl', 'https://example.com/go?to=https%3A%2F%2Fbetano.com'],
    ['linkUrl', 'https://example.com/%2562et365'],
    ['linkUrl', 'https://example.com/?y=estrela%20bet'],
    ['linkUrl', 'https://example.com/apostas'],
    ['linkUrl', 'https://example.com/?utm_campaign=betting'],
  ] as const)('aposta no logo ou escondida no link é recusada: %s %s', (field, url) => {
    expect(validateSponsor(input({ name: 'Parceiro', [field]: url }), lists)).toMatchObject({
      ok: false,
      issues: [{ field, code: 'betting' }],
    });
  });

  it.each([
    'https://bit.ly/abc',
    'https://linktr.ee/parceiro',
    'https://www.tinyurl.com/x',
    'https://rb.gy/x',
  ])('encurtador no link é recusado: %s', (linkUrl) => {
    expect(validateSponsor(input({ name: 'Parceiro', linkUrl }), lists)).toMatchObject({
      ok: false,
      issues: [{ field: 'linkUrl', code: 'shortener' }],
    });
  });

  it.each(['ВЕТ365', 'Вет365', 'ΒΕΤ365'])(
    'nome só com letra que imita a latina e dígito é recusado: %s',
    (name) => {
      expect(validateSponsor(input({ name }), lists).ok).toBe(false);
    },
  );

  it.each([
    'https://x.com/Βet365',
    'https://x.com/r?u=%CE%92et365',
    'https://x.com/vai-de-bet',
    'https://x.com/r?y=vai%20de%20bet',
    'https://x.com/bet',
  ])('link com letra grega ou "bet" solto no caminho é recusado: %s', (linkUrl) => {
    expect(validateSponsor(input({ name: 'Parceiro', linkUrl }), lists)).toMatchObject({
      ok: false,
      issues: [{ field: 'linkUrl', code: 'betting' }],
    });
  });

  it.each(['ВЕТ 365', 'Вет-365', 'Βετ 365', 'Vai de ВЕТ', 'Estrela ВЕТ'])(
    '"bet" escrito em cirílico ou grego, solto, é recusado: %s',
    (name) => {
      expect(validateSponsor(input({ name }), lists).ok).toBe(false);
    },
  );

  it.each([
    'https://bеt365.com/',
    'https://вет365.com/',
    'https://x.com/аpostas',
    'https://x.com/Αpostas',
    'https://x.com/bеtting',
    'https://x.com/casino-оnline',
    'https://x.com/ВЕТ-365',
    'https://x.com/r?q=вет%20365',
  ])('link com letra que imita a latina no domínio ou no caminho é recusado: %s', (linkUrl) => {
    expect(validateSponsor(input({ name: 'Parceiro', linkUrl }), lists)).toMatchObject({
      ok: false,
      issues: [{ field: 'linkUrl', code: 'betting' }],
    });
  });

  // limite aceito: `Вет24` vira `bet24` (o dígito conta como borda), e `/Βετ` sozinho no caminho passa
  it.each(['Вет Клиника 24', 'ВетКлиника24', 'Βήτα', 'Ветеринар 1'])('nome comum passa: %s', (name) => {
    expect(validateSponsor(input({ name }), lists).ok).toBe(true);
  });

  it.each(['Привет Спорт', 'Вет Клиника'])('nome em cirílico comum passa: %s', (name) => {
    expect(validateSponsor(input({ name }), lists).ok).toBe(true);
  });

  it.each([
    'https://cervejaria.com.br/casino-royale',
    'https://cervejaria.com.br/noticias/a-marca-que-aposta-no-esporte',
    'https://cervejaria.com.br/produtos/blaze-ipa',
    'https://cervejaria.com.br/better-life/alphabet',
    'https://cervejaria.com.br/Вет-Клиника',
    'https://cervejaria.com.br/diabetes/tibet',
  ])('caminho com palavra comum passa: %s', (linkUrl) => {
    expect(validateSponsor(input({ linkUrl }), lists).ok).toBe(true);
  });

  it('logo com nome de arquivo qualquer passa', () => {
    expect(
      validateSponsor(input({ logoLightUrl: 'https://cdn.cervejaria.com.br/logo_bet_x.png' }), lists).ok,
    ).toBe(true);
  });

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
    for (const countries of [['UK'], ['XX'], ['EU'], ['YU'], ['AC']])
      expect(validateSponsor(input({ countries }), lists)).toMatchObject({
        issues: [{ field: 'countries', code: 'countries' }],
      });
    expect(validateSponsor(input({ startsAt: '2026-02-30', endsAt: null }), lists)).toMatchObject({
      issues: [{ field: 'startsAt', code: 'dates' }],
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
