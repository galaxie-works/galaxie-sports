import { describe, expect, it } from 'vitest';
import {
  bucketLimits,
  DEFAULT_MARKET_WEIGHTS,
  expectedSearches,
  isForeign,
  marketScore,
  parseMarketWeights,
  queueGroup,
  reserveFor,
  searchAllowance,
  totalReserve,
  yieldFactors,
  type CompetitionYieldRow,
  type UpcomingGame,
} from './budget.js';

const at = (iso: string) => new Date(iso);

describe('dois baldes de cota', () => {
  it('busca em consultas (100/dia) e geral em unidades (10.000/dia), menos a folga', () => {
    expect(bucketLimits({ searchDaily: 100, apiDaily: 10_000, reservePercent: 10 })).toEqual({
      search: 90,
      api: 9000,
    });
  });
});

describe('prioridade: relevância × peso do mercado × rendimento', () => {
  it('o jogo das 21h no Brasil passa à frente da sobra da madrugada no México', () => {
    const vasco = marketScore({ BR: 95, AR: 70, MX: 60 }, DEFAULT_MARKET_WEIGHTS);
    const ligaMx = marketScore({ BR: 40, MX: 91 }, DEFAULT_MARKET_WEIGHTS);
    expect(vasco).toBe(95);
    expect(ligaMx).toBeCloseTo(54.6, 1);
  });

  it('pesos do painel: "BR:1,AR:0.6"; inválido → padrão', () => {
    expect(parseMarketWeights('BR:1,AR:0.6')).toEqual({ BR: 1, AR: 0.6 });
    expect(parseMarketWeights('BR=1')).toBeNull();
    expect(parseMarketWeights('')).toBeNull();
  });

  // números reais de 10–24/10/2026 (enrich.related_run × related_content)
  const rows: CompetitionYieldRow[] = [
    {
      competitionId: 'serie-a',
      slug: 'brasileirao-serie-a',
      games: 1,
      searches: 4,
      apiUnits: 31,
      searchVideos: 8,
      channelVideos: 0,
    },
    {
      competitionId: 'libertadores',
      slug: 'conmebol-libertadores',
      games: 2,
      searches: 12,
      apiUnits: 528,
      searchVideos: 36,
      channelVideos: 0,
    },
    {
      competitionId: 'liga-mx',
      slug: 'liga-mx',
      games: 3,
      searches: 20,
      apiUnits: 63,
      searchVideos: 5,
      channelVideos: 0,
    },
    {
      competitionId: 'colombia',
      slug: 'colombia-primera-a',
      games: 3,
      searches: 24,
      apiUnits: 310,
      searchVideos: 0,
      channelVideos: 0,
    },
    {
      competitionId: 'europa',
      slug: 'uefa-europa-league',
      games: 14,
      searches: 48,
      apiUnits: 22,
      searchVideos: 0,
      channelVideos: 0,
    },
  ];

  it('rendimento histórico suavizado: quem rende sobe, quem não rende desce; zero recorrente vai para o fim', () => {
    const y = yieldFactors(rows);
    expect(y.get('libertadores')!.factor).toBeGreaterThan(1);
    expect(y.get('liga-mx')!.factor).toBeLessThan(1);
    expect(y.get('colombia')).toMatchObject({ zero: true });
    expect(y.get('europa')).toMatchObject({ zero: true });
    // pouco histórico: puxado para a média, não para o extremo
    expect(y.get('serie-a')!.factor).toBeGreaterThan(1);
    expect(y.get('serie-a')!.factor).toBeLessThanOrEqual(1.5);
    expect(queueGroup({ foreign: false, zeroYield: true })).toBe(2);
  });

  it('fora dos mercados: Premier League e Champions sem time daqui; a Libertadores não', () => {
    const markets = ['BR', 'AR', 'MX'];
    expect(
      isForeign({ competitionCountry: 'GB-ENG', participantCountries: ['GB-ENG', 'GB-ENG'], markets }),
    ).toBe(true);
    expect(isForeign({ competitionCountry: null, participantCountries: ['ES', 'DE'], markets })).toBe(true);
    expect(isForeign({ competitionCountry: null, participantCountries: ['BR', 'AR'], markets })).toBe(false);
    expect(queueGroup({ foreign: true, zeroYield: false })).toBe(1);
  });
});

describe('reserva por faixa do dia', () => {
  // 07:00 UTC de sábado: a cota zerou e a fila tem a sobra da madrugada; a agenda da noite tem os grandes do BR
  const upcoming: UpcomingGame[] = [
    { id: 'vasco-corinthians', startsAt: at('2026-10-25T00:30:00Z'), score: 95, expected: 1 },
    { id: 'palmeiras-bragantino', startsAt: at('2026-10-25T00:30:00Z'), score: 98, expected: 1 },
    { id: 'santos-bahia', startsAt: at('2026-10-25T00:00:00Z'), score: 93, expected: 1 },
    { id: 'ferroviaria-maringa', startsAt: at('2026-10-24T20:00:00Z'), score: 80, expected: 2 },
    { id: 'banfield-lanus', startsAt: at('2026-10-24T17:45:00Z'), score: 59, expected: 2 },
  ];
  const cap = { upcoming, searchLimit: 90, capPercent: 60 };

  it('a sobra da madrugada não toca a fatia dos jogos de prioridade maior que ainda vão acontecer', () => {
    expect(reserveFor({ ...cap, score: 30, group: 0 })).toBe(7);
    // o grande da noite só deixa reservado o que é maior que ele
    expect(reserveFor({ ...cap, score: 95, group: 0 })).toBe(1);
    // fora dos mercados: a agenda inteira
    expect(reserveFor({ ...cap, score: 99, group: 1 })).toBe(7);
    expect(totalReserve(cap)).toBe(7);
  });

  it('teto da reserva: nunca mais que capPercent do balde', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...upcoming[0]!, id: `g${i}`, expected: 2 }));
    expect(reserveFor({ upcoming: many, searchLimit: 90, capPercent: 60, score: 10, group: 0 })).toBe(54);
    expect(reserveFor({ upcoming: many, searchLimit: 90, capPercent: 0, score: 10, group: 0 })).toBe(0);
  });

  it('consultas disponíveis: livre do balde, teto da execução e teto do jogo', () => {
    const search = { limit: 90, used: 80 };
    const base = { search, reserve: 7, maxSearchesPerRun: 2, maxSearchesPerEvent: 4, searchesSoFar: 0 };
    expect(searchAllowance(base)).toBe(2);
    expect(searchAllowance({ ...base, reserve: 9 })).toBe(1);
    expect(searchAllowance({ ...base, reserve: 10 })).toBe(0);
    expect(searchAllowance({ ...base, searchesSoFar: 3 })).toBe(1);
    expect(searchAllowance({ ...base, zeroYield: true })).toBe(1);
  });

  it('jogo com canal oficial espera 1 consulta; sem canal, o teto da execução', () => {
    expect(expectedSearches({ channels: 3, maxSearchesPerRun: 2 })).toBe(1);
    expect(expectedSearches({ channels: 0, maxSearchesPerRun: 2 })).toBe(2);
  });
});
