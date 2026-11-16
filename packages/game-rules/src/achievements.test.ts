import { describe, expect, it } from 'vitest';
import {
  INITIAL_CATALOG,
  levelFor,
  newSteps,
  parseAchievementInput,
  ruleMatches,
  seasonSteps,
  validateSteps,
} from './index.js';

describe('motor de Conquistas', () => {
  it('recusa compra e clique como entrada', () => {
    expect(parseAchievementInput({ type: 'purchase', amount: 10 })).toBeNull();
    expect(parseAchievementInput({ type: 'click', offer: 'x' })).toBeNull();
    expect(parseAchievementInput({ type: 'participation', action: 'purchase' })).toBeNull();
    expect(
      parseAchievementInput({
        type: 'prediction',
        kind: 'winner',
        correct: true,
        fullHit: false,
        sport: 'football',
      }),
    ).not.toBeNull();
  });

  it('regras do Palpite', () => {
    const hit = {
      type: 'prediction',
      kind: 'exact_score',
      correct: true,
      fullHit: true,
      sport: 'football',
    } as const;
    const miss = { ...hit, correct: false, fullHit: false } as const;
    const byId = (id: string) => INITIAL_CATALOG.find((e) => e.id === id)!.rule;
    expect(ruleMatches(byId('predictions.exact_score'), hit)).toBe(true);
    expect(ruleMatches(byId('predictions.exact_score'), miss)).toBe(false);
    expect(ruleMatches(byId('predictions.winner'), hit)).toBe(false);
    expect(ruleMatches(byId('predictions.placed'), miss)).toBe(true);
    expect(ruleMatches(byId('loyalty.watched'), hit)).toBe(false);
  });

  it('Catálogo: ids únicos, Degraus válidos, Carta por Degrau, textos nos três idiomas', () => {
    const ids = INITIAL_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of INITIAL_CATALOG) {
      expect(validateSteps(e.steps.map((s) => s.threshold))).toEqual([]);
      expect(e.steps.every((s) => s.cardKey === `${e.id}.${s.step}`)).toBe(true);
      for (const t of [e.name, e.description]) expect(t.pt && t.es && t.en).toBeTruthy();
      expect(e.active || !!e.inactiveReason).toBe(true);
    }
  });

  it('Degraus por calendário: NFL, NBA e Brasileirão', () => {
    expect(seasonSteps(17)[3]).toBe(17);
    expect(seasonSteps(82)[3]).toBe(82);
    expect(seasonSteps(38)).toEqual([1, 5, 15, 38, 100]);
  });

  it('reprocessar a mesma contagem não dá Degrau novo', () => {
    const t = [1, 3, 10];
    expect(newSteps(0, 1, t)).toEqual([1]);
    expect(newSteps(1, 1, t)).toEqual([]);
  });

  it('Nível por Pontos', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(299)).toBe(2);
    expect(levelFor(25_000)).toBe(10);
  });
});

describe('jogo assistido', () => {
  it('pelo menos 2/3 do jogo', async () => {
    const { watchedEnough } = await import('./index.js');
    expect(watchedEnough(60 * 60_000, 90 * 60_000)).toBe(true);
    expect(watchedEnough(59 * 60_000, 90 * 60_000)).toBe(false);
    expect(watchedEnough(10, 0)).toBe(false);
  });
});
