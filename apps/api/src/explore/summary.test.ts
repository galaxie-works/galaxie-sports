import { describe, expect, it } from 'vitest';
import {
  countryActivity,
  pickMainCompetition,
  rankTopCompetitions,
  type CatalogItem,
  type WindowEvent,
} from './summary.js';

const comp = (slug: string, over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: slug,
  sport: 'football',
  slug,
  type: 'league',
  tier: 1,
  prestige: 0,
  countryCode: 'BR',
  recent: 10,
  ...over,
});

const NOW = new Date('2026-10-22T12:00:00Z');
const WINDOW = { from: NOW, to: new Date('2026-10-29T12:00:00Z') };
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000);

const ev = (id: string, over: Partial<WindowEvent> = {}): WindowEvent => ({
  id,
  sport: 'football',
  status: 'scheduled',
  startsAt: at(24),
  importance: 50,
  live: false,
  competition: { sport: 'football', slug: 'brasileirao-serie-a', countryCode: 'BR' },
  participantIds: [`${id}-home`, `${id}-away`],
  participantCountries: ['BR', 'BR'],
  ...over,
});

describe('rankTopCompetitions', () => {
  it('põe as com jogos recentes primeiro, depois tier, prestígio e volume', () => {
    const ranked = rankTopCompetitions([
      comp('brasileirao', { recent: 400 }),
      comp('euro', { prestige: 10, recent: 0, countryCode: 'WORLD', type: 'cup' }),
      comp('libertadores', { prestige: 10, recent: 150, countryCode: 'WORLD', type: 'cup' }),
      comp('champions', { prestige: 10, recent: 360, countryCode: 'WORLD', type: 'cup' }),
      comp('serie-b', { tier: 2, recent: 500 }),
      comp('sul-americana', { prestige: 5, recent: 160, countryCode: 'WORLD', type: 'cup' }),
    ]);
    expect(ranked.map((c) => c.slug)).toEqual(['champions', 'libertadores', 'sul-americana', 'brasileirao']);
  });
});

describe('pickMainCompetition', () => {
  const featured = (_sport: string, slug: string) =>
    ({ 'brasileirao-serie-a': 0, 'copa-do-brasil': 1 })[slug] ?? null;

  it('escolhe a liga em destaque no config/geo, ignorando copas', () => {
    const main = pickMainCompetition(
      [
        comp('copa-do-brasil', { type: 'cup', recent: 900 }),
        comp('paulista-a1', { recent: 80 }),
        comp('brasileirao-serie-a', { recent: 400 }),
      ],
      featured,
    );
    expect(main?.slug).toBe('brasileirao-serie-a');
  });

  it('fora do featured, a liga tier 1 com mais jogos', () => {
    const main = pickMainCompetition(
      [
        comp('apertura', { recent: 130 }),
        comp('clausura', { recent: 160 }),
        comp('b', { tier: 2, recent: 999 }),
      ],
      () => null,
    );
    expect(main?.slug).toBe('clausura');
  });

  it('sem ligas, null', () => {
    expect(pickMainCompetition([comp('copa', { type: 'cup' })], featured)).toBeNull();
  });
});

describe('countryActivity', () => {
  it('conta próximos e ao vivo do país (competição ou participante) e ignora adiados e outros países', () => {
    const events = [
      ev('a'),
      ev('live', { startsAt: at(-1), status: 'live', live: true }),
      ev('stale', { startsAt: at(-30), status: 'live', live: false }),
      ev('postponed', { status: 'postponed' }),
      ev('later', { startsAt: at(24 * 8) }),
      // Libertadores com time brasileiro: conta para o Brasil e para a Argentina
      ev('lib', {
        competition: { sport: 'football', slug: 'conmebol-libertadores', countryCode: 'WORLD' },
        participantCountries: ['BR', 'AR'],
      }),
      ev('ar', {
        competition: { sport: 'football', slug: 'argentina-liga-profesional', countryCode: 'AR' },
        participantCountries: ['AR', 'AR'],
      }),
    ];
    const br = countryActivity(events, 'BR', WINDOW, new Set());
    expect(br).toMatchObject({ upcoming: 2, live: 1 });
    const ar = countryActivity(events, 'AR', WINDOW, new Set());
    expect(ar).toMatchObject({ upcoming: 2, live: 0 });
  });

  it('destaca o de maior relevância no mercado, com o bônus de docs/06', () => {
    const events = [
      ev('liga', { importance: 60 }),
      // continental: participante do país (+10) e competição continental do mercado (+5), teto 10
      ev('lib', {
        importance: 85,
        startsAt: at(48),
        competition: { sport: 'football', slug: 'conmebol-libertadores', countryCode: 'WORLD' },
        participantCountries: ['BR', 'AR'],
      }),
    ];
    const { highlight } = countryActivity(events, 'BR', WINDOW, new Set(['football|conmebol-libertadores']));
    expect(highlight).toEqual({
      id: 'lib',
      relevance: {
        market: 'BR',
        score: 95,
        bonus: 10,
        reasons: ['team_from_market', 'continental_competition'],
      },
    });
  });

  it('no empate de relevância, prefere clubes em destaque, depois a liga principal, depois o mais cedo', () => {
    const events = [
      ev('cedo', {
        startsAt: at(2),
        competition: { sport: 'football', slug: 'paulista-a1', countryCode: 'BR' },
      }),
      ev('liga', { startsAt: at(10) }),
      ev('grande', {
        startsAt: at(30),
        participantIds: ['palmeiras', 'x'],
        competition: { sport: 'football', slug: 'copa-do-brasil', countryCode: 'BR' },
      }),
      ev('classico', { startsAt: at(40), participantIds: ['palmeiras', 'corinthians'] }),
    ];
    const main = { sport: 'football', slug: 'brasileirao-serie-a' };
    const pick = (teams: string[], m: typeof main | null) =>
      countryActivity(events, 'BR', WINDOW, new Set(), { teams: new Set(teams), main: m }).highlight?.id;
    expect(pick(['palmeiras', 'corinthians'], main)).toBe('classico');
    expect(pick(['palmeiras'], main)).toBe('classico');
    expect(pick([], main)).toBe('liga');
    expect(pick([], null)).toBe('cedo');
  });

  it('sem jogos do país, sem destaque', () => {
    expect(countryActivity([ev('a')], 'UY', WINDOW, new Set())).toEqual({
      upcoming: 0,
      live: 0,
      highlight: null,
    });
  });
});
