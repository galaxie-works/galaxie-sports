import { describe, expect, it } from 'vitest';
import {
  addNumbers,
  matchNumbers,
  mostCommon,
  pickNumbers,
  positionName,
  providerNumbers,
  sumNumbers,
} from './stats.js';

describe('números do jogador a partir de fixtures/players', () => {
  it('lê a linha do jogo: minutos, titular, gols, cartões e nota', () => {
    expect(
      matchNumbers({
        games: { minutes: 90, number: 9, position: 'F', rating: '8.4', substitute: false },
        goals: { total: 2, assists: null },
        cards: { yellow: 1, red: 0 },
      }),
    ).toEqual({
      played: true,
      started: true,
      minutes: 90,
      goals: 2,
      assists: 0,
      yellow_cards: 1,
      red_cards: 0,
      rating: 8.4,
      number: 9,
      position: 'Attacker',
    });
  });

  it('banco sem entrar: não conta jogo nem titularidade; nota ausente vira null', () => {
    const n = matchNumbers({ games: { minutes: null, rating: null, substitute: true } });
    expect(n).toMatchObject({ played: false, started: false, minutes: null, rating: null, goals: 0 });
    expect(matchNumbers(null).played).toBe(false);
  });

  it('soma a temporada com a média das notas dos jogos com nota', () => {
    const lines = [
      matchNumbers({ games: { minutes: 90, rating: '7.0', substitute: false }, goals: { total: 1 } }),
      matchNumbers({ games: { minutes: 30, rating: '8.0', substitute: true }, goals: { assists: 1 } }),
      matchNumbers({ games: { minutes: 15, substitute: true }, cards: { red: 1 } }),
      matchNumbers({ games: { minutes: 0, substitute: true } }),
    ];
    expect(sumNumbers(lines)).toEqual({
      appearances: 3,
      starts: 1,
      minutes: 135,
      goals: 1,
      assists: 1,
      yellow_cards: 0,
      red_cards: 1,
      rating: 7.5,
    });
    expect(sumNumbers([]).rating).toBeNull();
  });

  it('posição das escalações e valor mais frequente', () => {
    expect(positionName('G')).toBe('Goalkeeper');
    expect(positionName('Midfielder')).toBe('Midfielder');
    expect(positionName('X')).toBeNull();
    expect(mostCommon(['M', 'F', 'M', null])).toBe('M');
    expect(mostCommon([])).toBeNull();
  });
});

describe('números do fornecedor (person_season_stat)', () => {
  const row = {
    appearances: 30,
    lineups: 25,
    minutes: 2400,
    goals: 10,
    assists: 4,
    yellowCards: 3,
    redCards: null,
    rating: '7.1234',
  };

  it('converte a linha e arredonda a nota', () => {
    expect(providerNumbers(row)).toEqual({
      appearances: 30,
      starts: 25,
      minutes: 2400,
      goals: 10,
      assists: 4,
      yellow_cards: 3,
      red_cards: 0,
      rating: 7.12,
    });
  });

  it('soma competições com a nota ponderada pelos jogos', () => {
    const a = providerNumbers({ ...row, appearances: 30, rating: '7.0' });
    const b = providerNumbers({ ...row, appearances: 10, rating: '8.0' });
    const c = providerNumbers({ ...row, appearances: 5, rating: null });
    expect(addNumbers([a, b, c])).toMatchObject({ appearances: 45, goals: 30, rating: 7.25 });
  });

  it('prefere o fornecedor, salvo quando ele está atrás das partidas', () => {
    const provider = providerNumbers(row);
    const matches = sumNumbers([matchNumbers({ games: { minutes: 90, substitute: false } })]);
    expect(pickNumbers(provider, matches)?.source).toBe('provider');
    expect(pickNumbers({ ...provider, appearances: 0 }, matches)?.source).toBe('matches');
    expect(pickNumbers(null, matches)?.numbers.appearances).toBe(1);
    expect(pickNumbers(null, sumNumbers([]))).toBeNull();
  });
});
