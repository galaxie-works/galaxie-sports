import { describe, expect, it } from 'vitest';
import { matchNumbers, mostCommon, positionName, sumNumbers } from './stats.js';

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
