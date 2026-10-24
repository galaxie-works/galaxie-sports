import { describe, expect, it } from 'vitest';
import { countback, finishedAt } from './race-standings.js';

describe('classificação da F1', () => {
  it('chegada só em posição numérica (abandono e desclassificação não contam como pódio)', () => {
    expect(finishedAt({ position: 1, result: { position_text: '1' } })).toBe(1);
    expect(finishedAt({ position: 26, result: { position_text: 'DSQ' } })).toBeNull();
    expect(finishedAt({ position: 12, result: { time: 'DNF' } })).toBeNull();
    expect(finishedAt({ position: 3, result: null })).toBe(3);
  });

  it('empate em pontos: mais vitórias na frente; empatou, mais 2ºs, e assim por diante', () => {
    expect(countback([1, 5], [2, 2])).toBeLessThan(0);
    expect(countback([2, 6], [2, 3])).toBeGreaterThan(0);
    // Nakajima e Martini (1988): um 6º cada; o 7º desempata
    expect(countback([6, 7, 8], [6, 9])).toBeLessThan(0);
    expect(countback([6], [6])).toBe(0);
    expect(countback([], [])).toBe(0);
  });
});
