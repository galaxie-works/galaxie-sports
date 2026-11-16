import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POINTS_SCALE,
  cappedParticipationPoints,
  compareRanking,
  gameAllows,
  newSteps,
  periodKeys,
  quantityPoints,
  scorePrediction,
  seasonSteps,
  stepsReached,
  validatePointsScale,
  validatePrediction,
  validateSteps,
} from './index.js';

describe('escala de Pontos', () => {
  it('a escala padrão é válida', () => {
    expect(validatePointsScale({ ...DEFAULT_POINTS_SCALE })).toEqual([]);
  });

  it('o Palpite de vencedor vale pelo menos 3 vezes a média da participação', () => {
    const s = DEFAULT_POINTS_SCALE;
    expect(s.winner).toBeGreaterThanOrEqual((3 * (s.poll + s.trivia + s.watched)) / 3);
    const broken = validatePointsScale({ ...s, watched: 60 });
    expect(broken.join(' ')).toMatch(/3 vezes/);
  });

  it('a participação respeita o teto diário', () => {
    expect(cappedParticipationPoints('watched', 0)).toBe(20);
    expect(cappedParticipationPoints('watched', 30)).toBe(10);
    expect(cappedParticipationPoints('poll', 40)).toBe(0);
  });

  it('a conta de referência do mês fecha com os números da arquitetura', () => {
    // só cliques, no limite: 40 por dia em 30 dias
    expect(DEFAULT_POINTS_SCALE.dailyParticipationCap * 30).toBe(1200);
    // três Palpites de vencedor por dia, metade certos
    expect(Math.round(3 * 30 * 0.5 * DEFAULT_POINTS_SCALE.winner)).toBe(1800);
  });
});

describe('pontuação do Palpite', () => {
  const end = { home: 2, away: 1, totals: { goals: 3, corners: 10 } };

  it('placar exato é Acerto em cheio', () => {
    expect(scorePrediction({ kind: 'exact_score', home: 2, away: 1 }, end)).toEqual({
      points: 120,
      correct: true,
      fullHit: true,
    });
    expect(scorePrediction({ kind: 'exact_score', home: 1, away: 0 }, end).points).toBe(0);
  });

  it('vencedor', () => {
    expect(scorePrediction({ kind: 'winner', pick: 'home' }, end)).toEqual({
      points: 40,
      correct: true,
      fullHit: false,
    });
    expect(scorePrediction({ kind: 'winner', pick: 'draw' }, end).correct).toBe(false);
    expect(scorePrediction({ kind: 'winner', pick: 'draw' }, { home: 0, away: 0 }).correct).toBe(true);
  });

  it('quantidade: abaixo de N zera, o exato é o máximo, mais perto vale mais', () => {
    expect(quantityPoints(11, 10).points).toBe(0);
    expect(quantityPoints(10, 10)).toEqual({ points: 120, correct: true, fullHit: true });
    const near = quantityPoints(9, 10);
    const far = quantityPoints(2, 10);
    expect(near.points).toBeGreaterThan(far.points);
    expect(near.points).toBeLessThan(120);
    expect(near.fullHit).toBe(false);
    expect(far.points).toBeGreaterThanOrEqual(40);
    expect(scorePrediction({ kind: 'quantity', subject: 'corners', atLeast: 8 }, end).correct).toBe(true);
    expect(scorePrediction({ kind: 'quantity', subject: 'cards', atLeast: 1 }, end).points).toBe(0);
  });

  it('o provisório muda com o VAR: gol anulado tira o acerto', () => {
    const pred = { kind: 'exact_score', home: 2, away: 1 } as const;
    expect(scorePrediction(pred, { home: 2, away: 1 }).correct).toBe(true);
    expect(scorePrediction(pred, { home: 1, away: 1 }).correct).toBe(false);
  });

  it('recusa fora do prazo, abaixo do Piso e assunto sem Piso', () => {
    const lockAt = new Date('2026-11-16T19:00:00Z');
    const before = new Date('2026-11-16T18:59:59Z');
    expect(validatePrediction({ kind: 'winner', pick: 'home' }, { now: lockAt, lockAt })).toBe('locked');
    expect(validatePrediction({ kind: 'winner', pick: 'home' }, { now: before, lockAt })).toBeNull();
    const floors = { corners: 6 };
    expect(
      validatePrediction(
        { kind: 'quantity', subject: 'corners', atLeast: 5 },
        { now: before, lockAt, floors },
      ),
    ).toBe('below_floor');
    expect(
      validatePrediction(
        { kind: 'quantity', subject: 'corners', atLeast: 6 },
        { now: before, lockAt, floors },
      ),
    ).toBeNull();
    expect(
      validatePrediction({ kind: 'quantity', subject: 'fouls', atLeast: 6 }, { now: before, lockAt, floors }),
    ).toBe('unknown_subject');
    expect(validatePrediction({ kind: 'exact_score', home: -1, away: 0 }, { now: before, lockAt })).toBe(
      'invalid_value',
    );
  });
});

describe('Degraus', () => {
  it('liga de 38 rodadas reproduz a referência', () => {
    expect(seasonSteps(38)).toEqual([1, 5, 15, 38, 100]);
  });

  it('Platina é a temporada em qualquer esporte, sempre crescente', () => {
    for (const games of [17, 82, 162, 4]) {
      const steps = seasonSteps(games);
      expect(steps[3]).toBe(games);
      expect(validateSteps(steps)).toEqual([]);
    }
    expect(() => seasonSteps(3)).toThrow();
  });

  it('conta Degraus alcançados e os novos', () => {
    const t = [1, 5, 15, 38, 100];
    expect(stepsReached(0, t)).toBe(0);
    expect(stepsReached(15, t)).toBe(3);
    expect(newSteps(4, 16, t)).toEqual([2, 3]);
    expect(newSteps(16, 16, t)).toEqual([]);
    expect(validateSteps([1, 1])).not.toEqual([]);
  });
});

describe('Ranking', () => {
  it('desempata por Acertos em cheio e depois por quem chegou primeiro', () => {
    const t0 = new Date('2026-11-01T00:00:00Z');
    const t1 = new Date('2026-11-02T00:00:00Z');
    const rows = [
      { id: 'c', points: 100, fullHits: 1, reachedAt: t1 },
      { id: 'b', points: 100, fullHits: 1, reachedAt: t0 },
      { id: 'a', points: 100, fullHits: 2, reachedAt: t1 },
      { id: 'd', points: 200, fullHits: 0, reachedAt: t1 },
    ];
    expect(rows.sort(compareRanking).map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('o jogo conta no mês do fuso do país', () => {
    // 01/12 01:00 UTC ainda é 30/11 em São Paulo
    expect(periodKeys(new Date('2026-12-01T01:00:00Z'), 'America/Sao_Paulo')).toEqual({
      month: '2026-11',
      year: '2026',
    });
    expect(periodKeys(new Date('2026-12-01T01:00:00Z'), 'Europe/Madrid').month).toBe('2026-12');
  });
});

describe('faixas', () => {
  it('under13 e sem faixa ficam fora; 13 a 17 ganha Cartas mas não vê código de Prêmio', () => {
    expect(gameAllows('under13', 'predict')).toBe(false);
    expect(gameAllows(null, 'predict')).toBe(false);
    expect(gameAllows('13_17', 'collect_card')).toBe(true);
    expect(gameAllows('13_17', 'see_prize_code')).toBe(false);
    expect(gameAllows('18plus', 'see_prize_code')).toBe(true);
  });
});

describe('programa', () => {
  it('Piso por esporte e resultado a partir do placar', async () => {
    const { quantityFloors, outcomeFromScore, TOTAL_SCORE, countryTimeZone } = await import('./index.js');
    expect(quantityFloors('football')[TOTAL_SCORE]).toBe(1);
    expect(quantityFloors('american-football')[TOTAL_SCORE]).toBe(20);
    expect(quantityFloors('mma')).toEqual({});
    expect(outcomeFromScore({ home: 2, away: 1 })).toEqual({ home: 2, away: 1, totals: { total_score: 3 } });
    expect(outcomeFromScore({ home: null, away: null })).toBeNull();
    expect(countryTimeZone('BR')).toBe('America/Sao_Paulo');
    expect(countryTimeZone('ZZ')).toBe('UTC');
  });
});
