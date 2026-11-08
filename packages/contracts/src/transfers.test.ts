import { describe, expect, it } from 'vitest';
import { TransfersQuery, transferKind } from './transfers.js';

describe('transferKind', () => {
  it('classifica o texto do fornecedor', () => {
    expect(transferKind('Loan')).toEqual({ kind: 'loan', fee: null });
    expect(transferKind('Back from Loan')).toEqual({ kind: 'loan_return', fee: null });
    expect(transferKind('Free')).toEqual({ kind: 'free', fee: null });
    expect(transferKind('€ 2.5M')).toEqual({ kind: 'fee', fee: '€ 2.5M' });
    expect(transferKind('Transfer')).toEqual({ kind: 'transfer', fee: null });
  });

  it('sem informação, nada', () => {
    expect(transferKind('N/A')).toEqual({ kind: null, fee: null });
    expect(transferKind(null)).toEqual({ kind: null, fee: null });
    expect(transferKind('')).toEqual({ kind: null, fee: null });
  });
});

describe('TransfersQuery', () => {
  it('padrões: as duas direções, 180 dias, 20 itens', () => {
    expect(TransfersQuery.parse({})).toMatchObject({ direction: 'all', days: 180, limit: 20 });
  });

  it('recusa direção desconhecida e limites fora da faixa', () => {
    expect(TransfersQuery.safeParse({ direction: 'up' }).success).toBe(false);
    expect(TransfersQuery.safeParse({ limit: '500' }).success).toBe(false);
    expect(TransfersQuery.parse({ days: '30', limit: '5', direction: 'in' })).toMatchObject({
      direction: 'in',
      days: 30,
      limit: 5,
    });
  });
});
