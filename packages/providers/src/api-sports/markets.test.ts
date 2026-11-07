import { describe, expect, it } from 'vitest';
import { loadFootballFixture } from '../../test/load-fixture.js';
import {
  goalsLine,
  marketKey,
  normalizeBookmakers,
  normalizeMarketsEnvelope,
  normalizeOdds,
  normalizePredictions,
  percent,
  selectionOf,
} from './markets.js';

const FETCHED = new Date('2026-10-21T14:13:54Z');
const predictions = loadFootballFixture('predictions-fixture-1001.json');
const odds = loadFootballFixture('odds-fixture-1001.json');

describe('normalizePredictions', () => {
  const batch = normalizePredictions(predictions.response, FETCHED, { fixture: '1001' });

  it('liga ao jogo da requisição e converte percentuais e linhas de gols', () => {
    expect(batch).toMatchObject({ provider: 'api-sports', sport: 'football', observedAt: FETCHED });
    expect(batch.predictions).toEqual([
      {
        eventId: '1001',
        winnerTeamId: '121',
        winOrDraw: true,
        probHome: 45,
        probDraw: 45,
        probAway: 10,
        goals: {
          total: { side: 'under', line: 3.5 },
          home: { side: 'under', line: 2.5 },
          away: { side: 'under', line: 1.5 },
        },
        comparison: {
          form: { home: 60, away: 40 },
          attack: { home: 67, away: 33 },
          defense: { home: 40, away: 60 },
          poisson: { home: 55, away: 45 },
          h2h: { home: 50, away: 50 },
          goals: { home: 62, away: 38 },
          total: { home: 55.7, away: 44.3 },
        },
        recentForm: {
          home: {
            form: 60,
            attack: 67,
            defense: 40,
            goalsFor: 8,
            goalsAgainst: 5,
            goalsForAverage: 1.6,
            goalsAgainstAverage: 1,
          },
          away: {
            form: 40,
            attack: 33,
            defense: 60,
            goalsFor: 4,
            goalsAgainst: 6,
            goalsForAverage: 0.8,
            goalsAgainstAverage: 1.2,
          },
        },
        advice: 'Double chance : Time 121 or draw and target Under 3.5',
        winnerComment: 'Win or draw',
      },
    ]);
  });

  it('sem o fixture da requisição ou com resposta vazia, não gera nada', () => {
    expect(normalizePredictions(predictions.response, FETCHED, {}).predictions).toEqual([]);
    expect(normalizePredictions([], FETCHED, { fixture: '1001' }).predictions).toEqual([]);
  });

  it('palpite sem vencedor e sem números fica com nulos', () => {
    const b = normalizePredictions(
      [{ predictions: { winner: { id: null, name: null, comment: null }, percent: {} }, comparison: {} }],
      FETCHED,
      { fixture: '7' },
    );
    expect(b.predictions[0]).toMatchObject({
      eventId: '7',
      winnerTeamId: null,
      winOrDraw: null,
      probHome: null,
      goals: null,
      comparison: null,
      recentForm: null,
    });
  });
});

describe('normalizeOdds', () => {
  const batch = normalizeOdds('football', odds.response, FETCHED);

  it('um jogo, as casas com mercado e o horário da atualização do fornecedor', () => {
    expect(batch.odds).toHaveLength(1);
    const o = batch.odds[0]!;
    expect(o.eventId).toBe('1001');
    expect(o.sourceUpdatedAt?.toISOString()).toBe('2026-10-21T09:49:32.000Z');
    // a casa sem nenhum mercado com odd não entra
    expect(o.bookmakers.map((b) => b.bookmakerName)).toEqual(['Casa Um', 'Casa Dois']);
    expect(batch.bookmakers).toEqual([
      { id: '6', name: 'Casa Um' },
      { id: '8', name: 'Casa Dois' },
    ]);
  });

  it('mercados com chave nossa, seleções normalizadas e o resto guardado com o nome do fornecedor', () => {
    const markets = batch.odds[0]!.bookmakers[0]!.markets;
    expect(markets.map((m) => m.key)).toEqual([
      'match_winner',
      'goals_over_under',
      'double_chance',
      'both_teams_score',
      'exact_score',
      'asian_handicap',
      null,
    ]);
    expect(markets[0]!.selections).toEqual([
      { key: 'home', line: null, price: 1.85 },
      { key: 'draw', line: null, price: 3.4 },
      { key: 'away', line: null, price: 4.5 },
    ]);
    expect(markets[1]!.selections).toEqual([
      { key: 'over', line: 2.5, price: 2.1 },
      { key: 'under', line: 2.5, price: 1.72 },
    ]);
    expect(markets[2]!.selections.map((s) => s.key)).toEqual(['home_draw', 'home_away', 'draw_away']);
    expect(markets[4]!.selections.map((s) => s.key)).toEqual(['1:0', '2:1']);
    expect(markets[5]!.selections).toEqual([
      { key: 'home', line: -0.25, price: 1.98 },
      { key: 'away', line: 0.25, price: 1.88 },
    ]);
    expect(markets[6]).toEqual({
      key: null,
      providerBet: { id: 45, name: 'Corners Over Under' },
      selections: [
        { key: 'over', line: 9.5, price: 1.9 },
        { key: 'under', line: 9.5, price: 1.85 },
      ],
    });
  });

  it('nos outros esportes, o jogo vem em game.id e Home/Away é o vencedor', () => {
    const b = normalizeOdds(
      'basketball',
      [
        {
          game: { id: 555 },
          update: null,
          bookmakers: [
            {
              id: 1,
              name: 'Casa Um',
              bets: [{ id: 2, name: 'Home/Away', values: [{ value: 'Home', odd: '1.50' }] }],
            },
          ],
        },
      ],
      FETCHED,
    );
    expect(b.odds[0]).toMatchObject({ eventId: '555', sourceUpdatedAt: null });
    expect(b.odds[0]!.bookmakers[0]!.markets[0]!.key).toBe('match_winner');
  });
});

describe('peças', () => {
  it('percent', () => {
    expect(percent('45%')).toBe(45);
    expect(percent('33.3%')).toBe(33.3);
    expect(percent('')).toBeNull();
    expect(percent('abc')).toBeNull();
    expect(percent('150%')).toBeNull();
  });

  it('goalsLine', () => {
    expect(goalsLine('-3.5')).toEqual({ side: 'under', line: 3.5 });
    expect(goalsLine('+1.5')).toEqual({ side: 'over', line: 1.5 });
    expect(goalsLine('2.5')).toEqual({ side: 'over', line: 2.5 });
    expect(goalsLine(null)).toBeNull();
    expect(goalsLine('x')).toBeNull();
  });

  it('selectionOf', () => {
    expect(selectionOf('Draw')).toEqual({ key: 'draw', line: null });
    expect(selectionOf('Draw/Away')).toEqual({ key: 'draw_away', line: null });
    expect(selectionOf('Under 0.5')).toEqual({ key: 'under', line: 0.5 });
    expect(selectionOf('Home +1')).toEqual({ key: 'home', line: 1 });
    expect(selectionOf('No')).toEqual({ key: 'no', line: null });
    expect(selectionOf('3-1')).toEqual({ key: '3:1', line: null });
    expect(selectionOf('Home/Draw/Over 2.5')).toEqual({ key: 'Home/Draw/Over 2.5', line: null });
    expect(selectionOf('')).toBeNull();
  });

  it('marketKey depende do esporte', () => {
    expect(marketKey('football', 'Home/Away')).toBe('draw_no_bet');
    expect(marketKey('hockey', 'Home/Away')).toBe('match_winner');
    expect(marketKey('football', 'Corners Over Under')).toBeNull();
  });

  it('normalizeBookmakers e o despacho por endpoint', () => {
    expect(
      normalizeBookmakers('football', [{ id: 1, name: 'Casa Um' }, { id: 2 }], FETCHED).bookmakers,
    ).toEqual([{ id: '1', name: 'Casa Um' }]);
    expect(
      normalizeMarketsEnvelope('football', '/predictions', predictions, FETCHED, { fixture: '1001' }),
    ).toMatchObject({
      items: 1,
    });
    expect(normalizeMarketsEnvelope('basketball', '/predictions', predictions, FETCHED)).toBeNull();
    expect(normalizeMarketsEnvelope('football', '/injuries', predictions, FETCHED)).toBeNull();
  });
});
