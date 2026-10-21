import { describe, expect, it } from 'vitest';
import { PlanViolationError } from './errors.js';
import { FREE_PLAN, PlanRules, PRO_PLAN } from './plan.js';

const now = new Date('2026-10-21T14:00:00Z');

describe('PlanRules (free)', () => {
  const rules = () => new PlanRules(FREE_PLAN);

  it('aceita temporadas 2022–2024 e recusa a atual', () => {
    expect(() => rules().validate({ league: '71', season: '2024' }, now)).not.toThrow();
    expect(() => rules().validate({ league: '71', season: '2026' }, now)).toThrow(PlanViolationError);
    expect(() => rules().validate({ season: '2023-2024' }, now)).not.toThrow();
  });

  it('aceita datas de ontem a amanhã (UTC)', () => {
    for (const date of ['2026-10-20', '2026-10-21', '2026-10-22']) {
      expect(() => rules().validate({ date }, now)).not.toThrow();
    }
    expect(() => rules().validate({ date: '2026-10-17' }, now)).toThrow(/janela/);
    expect(() => rules().validate({ date: '2026-10-23' }, now)).toThrow(/janela/);
  });

  it('bloqueia ids, last, next e page > 3', () => {
    expect(() => rules().validate({ ids: '1-2' }, now)).toThrow(/ids/);
    expect(() => rules().validate({ last: '5' }, now)).toThrow(/last/);
    expect(() => rules().validate({ page: '4' }, now)).toThrow(/page/);
    expect(() => rules().validate({ page: '3' }, now)).not.toThrow();
  });

  it('aprende a nova janela de temporadas a partir da mensagem do fornecedor', () => {
    const r = rules();
    expect(
      r.learnFromPlanError('{"plan":"Free plans do not have access to this season, try from 2023 to 2025."}'),
    ).toBe(true);
    expect(() => r.validate({ season: '2025' }, now)).not.toThrow();
    expect(() => r.validate({ season: '2022' }, now)).toThrow();
    expect(r.learnFromPlanError('try from 2023 to 2025')).toBe(false);
  });
});

describe('PlanRules (pro)', () => {
  it('não impõe restrições de temporada, data ou parâmetros', () => {
    const r = new PlanRules(PRO_PLAN);
    expect(() =>
      r.validate({ season: '2026', ids: '1-2-3', date: '2020-01-01', page: '10' }, now),
    ).not.toThrow();
  });
});
