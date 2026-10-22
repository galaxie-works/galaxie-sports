import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadGeoConfig } from '@galaxie/geo';
import type { StageMatch } from './builder.js';
import {
  activeMarkets,
  continentalSlugs,
  importanceBreakdownDto,
  inMarket,
  marketBonus,
  reasonDto,
  resolveMarket,
  tieOutcome,
  type BracketTeam,
} from './relevance.js';

const geo = loadGeoConfig();
const continental = (market: string) =>
  new Set(continentalSlugs(geo, market).map((c) => `${c.sport}|${c.slug}`));

const lib = { sport: 'football', slug: 'conmebol-libertadores', countryCode: 'WORLD' };
const bra = { sport: 'football', slug: 'brasileirao-serie-a', countryCode: 'BR' };
const ucl = { sport: 'football', slug: 'uefa-champions-league', countryCode: 'WORLD' };
const wc = { sport: 'football', slug: 'fifa-world-cup', countryCode: 'WORLD' };

describe('marketBonus', () => {
  it('semifinal da Libertadores entre brasileiros no mercado BR: +10 (teto)', () => {
    expect(
      marketBonus('BR', { participantCountries: ['BR', 'BR'], competition: lib }, continental('BR')),
    ).toMatchObject({
      bonus: 10,
      reasons: ['team_from_market', 'continental_competition'],
      details: [
        { code: 'team_from_market', points: 10 },
        { code: 'continental_competition', points: 5 },
      ],
    });
  });

  it('Libertadores sem brasileiro no mercado BR: +5 da confederação', () => {
    expect(
      marketBonus('BR', { participantCountries: ['AR', 'EC'], competition: lib }, continental('BR')),
    ).toMatchObject({
      bonus: 5,
      reasons: ['continental_competition'],
    });
  });

  it('Brasileirão no mercado BR: +10; no AR: nada', () => {
    expect(
      marketBonus('BR', { participantCountries: ['BR', 'BR'], competition: bra }, continental('BR')).bonus,
    ).toBe(10);
    expect(
      marketBonus('AR', { participantCountries: ['BR', 'BR'], competition: bra }, continental('AR')),
    ).toEqual({
      bonus: 0,
      reasons: [],
      details: [],
    });
  });

  it('Champions no mercado BR não ganha bônus; no ES ganha +5', () => {
    expect(
      marketBonus('BR', { participantCountries: ['ES', 'DE'], competition: ucl }, continental('BR')).bonus,
    ).toBe(0);
    expect(
      marketBonus('ES', { participantCountries: ['IT', 'DE'], competition: ucl }, continental('ES')).bonus,
    ).toBe(5);
  });

  it('competição global (Copa do Mundo) não diferencia mercados', () => {
    expect(continental('BR').has('football|fifa-world-cup')).toBe(false);
    expect(
      marketBonus('BR', { participantCountries: ['FR', 'DE'], competition: wc }, continental('BR')).bonus,
    ).toBe(0);
  });

  it('convidado listado em `countries` (Copa América no mercado MX)', () => {
    expect(continental('MX').has('football|copa-america')).toBe(true);
  });

  it('GB cobre os códigos GB-ENG/GB-SCT', () => {
    expect(inMarket('GB-ENG', 'GB')).toBe(true);
    expect(inMarket('BR', 'GB')).toBe(false);
    expect(continental('GB').has('football|uefa-champions-league')).toBe(true);
  });
});

describe('marketBonus — semifinal define o adversário', () => {
  const team = (name: string, countryCode: string, round: BracketTeam['round'] = 'final'): BracketTeam => ({
    id: `id-${name}`,
    name,
    countryCode,
    round,
  });
  // Libertadores 2026: Palmeiras × Fluminense; a outra semi é Flamengo × Estudiantes, em aberto
  const facts = {
    participantCountries: ['BR', 'BR'],
    competition: lib,
    bracket: [team('Flamengo', 'BR'), team('Estudiantes L.P.', 'AR')],
  };

  it('mercado AR: confederação (+5) e o adversário do Estudiantes na final (+5)', () => {
    const r = marketBonus('AR', facts, continental('AR'));
    expect(r.bonus).toBe(10);
    expect(r.reasons).toEqual(['continental_competition', 'decides_final_opponent']);
    expect(r.details[1]!.teams.map((t) => t.name)).toEqual(['Estudiantes L.P.']);
  });

  it('respeita o teto: BR já tem +10 do time do país', () => {
    const r = marketBonus('BR', facts, continental('BR'));
    expect(r.bonus).toBe(10);
    expect(r.reasons).toEqual(['team_from_market', 'continental_competition', 'decides_final_opponent']);
  });

  it('outra confederação continua sem bônus; fora da semifinal não há chave', () => {
    expect(marketBonus('MX', facts, continental('MX')).bonus).toBe(0);
    expect(marketBonus('AR', { ...facts, bracket: undefined }, continental('AR')).reasons).toEqual([
      'continental_competition',
    ]);
  });

  it('dois times do país do outro lado contam uma vez só', () => {
    const r = marketBonus(
      'AR',
      {
        participantCountries: ['BR', 'EC'],
        competition: wc,
        bracket: [team('Boca', 'AR'), team('River', 'AR')],
      },
      continental('AR'),
    );
    expect(r.bonus).toBe(5);
    expect(r.details).toHaveLength(1);
    expect(reasonDto(r.details[0]!, 'pt-BR', { teams: [], continental: undefined }).text).toBe(
      'Define o adversário de Boca ou River na final',
    );
  });

  it('outra semi decidida com disputa de 3º lugar: o motivo é o adversário de quem caiu', () => {
    const r = marketBonus(
      'AR',
      {
        participantCountries: ['BR', 'BR'],
        competition: wc,
        bracket: [team('Flamengo', 'BR'), team('Estudiantes L.P.', 'AR', 'third_place')],
      },
      continental('AR'),
    );
    expect(r.reasons).toEqual(['decides_third_place_opponent']);
    expect(reasonDto(r.details[0]!, 'es-AR', { teams: [], continental: undefined })).toEqual({
      code: 'decides_third_place_opponent',
      points: 5,
      text: 'Define el rival de Estudiantes L.P. en el partido por el 3.er puesto',
      participant: { id: 'id-Estudiantes L.P.', name: 'Estudiantes L.P.' },
    });
  });

  it('textos dos motivos de competição e de time do país', () => {
    const conmebol = continentalSlugs(geo, 'AR').find((c) => c.slug === 'conmebol-libertadores');
    expect(conmebol).toMatchObject({ confederation: 'CONMEBOL', guest: false });
    const r = marketBonus('AR', facts, continental('AR'));
    expect(reasonDto(r.details[0]!, 'pt-BR', { teams: [], continental: conmebol }).text).toBe(
      'Competição da CONMEBOL',
    );
    expect(reasonDto(r.details[0]!, 'es-AR', { teams: [], continental: conmebol }).text).toBe(
      'Competición de la CONMEBOL',
    );
    const br = marketBonus('BR', facts, continental('BR'));
    const teams = { teams: ['Palmeiras', 'Fluminense'], continental: undefined };
    expect(reasonDto(br.details[0]!, 'pt-BR', teams).text).toBe('Time do país: Palmeiras e Fluminense');
  });
});

describe('tieOutcome', () => {
  const leg = (id: string, home: string, away: string, score: [number, number] | null, status = 'finished') =>
    ({
      id,
      stageId: 's',
      startsAt: new Date(),
      status,
      score: score ? { home: score[0], away: score[1] } : null,
      homeId: home,
      awayId: away,
    }) as StageMatch;

  it('agregado decide; volta por jogar fica em aberto', () => {
    const ida = leg('1', 'EST', 'FLA', [1, 1]);
    expect(tieOutcome([ida, leg('2', 'FLA', 'EST', null, 'scheduled')], 2)).toBeNull();
    expect(tieOutcome([ida, leg('2', 'FLA', 'EST', [2, 0])], 2)).toEqual({ winner: 'FLA', loser: 'EST' });
  });

  it('sem a volta no core, o regulamento (2 pernas) impede dar como decidido', () => {
    expect(tieOutcome([leg('1', 'EST', 'FLA', [3, 0])], 2)).toBeNull();
    expect(tieOutcome([leg('1', 'EST', 'FLA', [3, 0])], null)).toEqual({ winner: 'EST', loser: 'FLA' });
  });

  it('empate no agregado: pênaltis da última perna; sem eles, em aberto', () => {
    const ida = leg('1', 'EST', 'FLA', [1, 0]);
    const volta = leg('2', 'FLA', 'EST', [1, 0]);
    expect(tieOutcome([ida, volta], 2)).toBeNull();
    volta.score = { home: 1, away: 0, penalty: { home: 3, away: 4 } } as StageMatch['score'];
    expect(tieOutcome([ida, volta], 2)).toEqual({ winner: 'EST', loser: 'FLA' });
  });
});

describe('activeMarkets', () => {
  const req = (markets: string[] | null) =>
    ({ tenant: markets ? { markets } : null }) as unknown as FastifyRequest;

  it('mercados de config/geo e, depois, os do plano que faltarem', () => {
    const base = activeMarkets(req(null), geo);
    expect(base.slice(0, 2)).toEqual(['BR', 'AR']);
    expect(base).toEqual(expect.arrayContaining(['UY', 'CL', 'CO', 'PY', 'PE', 'EC', 'BO', 'VE', 'MX']));
    expect(activeMarkets(req(['br', 'us']), geo)).toEqual([...base, 'US']);
  });
});

describe('resolveMarket', () => {
  const req = (markets: string[] | null) =>
    ({ tenant: markets ? { markets } : null }) as unknown as FastifyRequest;

  it('market explícito vence; senão o único mercado do plano; senão nenhum', () => {
    expect(resolveMarket(req(['AR']), 'br')).toBe('BR');
    expect(resolveMarket(req(['ar']), undefined)).toBe('AR');
    expect(resolveMarket(req(['AR', 'BR']), undefined)).toBeNull();
    expect(resolveMarket(req([]), undefined)).toBeNull();
    expect(resolveMarket(req(null), undefined)).toBeNull();
  });
});

describe('importanceBreakdownDto', () => {
  it('omite os campos internos e sinais desconhecidos', () => {
    expect(
      importanceBreakdownDto({
        tier: 40,
        phase: 22,
        derby: 0,
        decisive: 8,
        prestige: 10,
        leg: 2,
        flags: ['elimination', 'x'],
        stake_flags: [],
      }),
    ).toEqual({ tier: 40, phase: 22, derby: 0, decisive: 8, prestige: 10, flags: ['elimination'] });
    expect(importanceBreakdownDto(null)).toBeNull();
  });
});
