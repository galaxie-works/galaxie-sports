import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/db', () => ({ pool: {} }));

const { answerable } = await import('./store');

describe('answerable', () => {
  const base = { status: 'needsInfo' as const, answered: false, issueStatus: 'needsInfo', latest: true };

  it('aviso da coluna "mais informações", ainda sem resposta', () => {
    expect(answerable(base)).toBe(true);
  });

  it('só resposta (/responder) com a issue parada em "mais informações" também pede resposta', () => {
    expect(answerable({ ...base, status: null })).toBe(true);
  });

  it('não pede: já respondido, aviso antigo, issue saiu da coluna ou aviso de outra coluna', () => {
    expect(answerable({ ...base, answered: true })).toBe(false);
    expect(answerable({ ...base, latest: false })).toBe(false);
    expect(answerable({ ...base, issueStatus: 'inProgress' })).toBe(false);
    expect(answerable({ ...base, status: 'review' })).toBe(false);
  });
});
