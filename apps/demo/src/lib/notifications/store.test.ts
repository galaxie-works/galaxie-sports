import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/db', () => ({ pool: {} }));

const { answerable } = await import('./store');

describe('answerable', () => {
  const reply = {
    status: null,
    hasBody: true,
    answered: false,
    issueStatus: 'review',
    issueClosed: false,
    latest: true,
  } as const;

  it('toda resposta da equipe (/responder) aceita resposta, em qualquer coluna', () => {
    expect(answerable(reply)).toBe(true);
    expect(answerable({ ...reply, issueStatus: null })).toBe(true);
    expect(answerable({ ...reply, status: 'inProgress', issueStatus: 'inProgress' })).toBe(true);
  });

  it('aviso da coluna "mais informações" pede resposta mesmo sem texto da equipe', () => {
    expect(answerable({ ...reply, status: 'needsInfo', hasBody: false, issueStatus: 'needsInfo' })).toBe(
      true,
    );
  });

  it('não aceita: já respondido, aviso antigo, issue fechada ou entregue, aviso de coluna sem texto', () => {
    expect(answerable({ ...reply, answered: true })).toBe(false);
    expect(answerable({ ...reply, latest: false })).toBe(false);
    expect(answerable({ ...reply, issueClosed: true })).toBe(false);
    expect(answerable({ ...reply, issueStatus: 'delivered' })).toBe(false);
    expect(answerable({ ...reply, status: 'review', hasBody: false })).toBe(false);
  });
});
