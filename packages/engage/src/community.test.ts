import { describe, expect, it } from 'vitest';
import {
  decideJoin,
  inviteUsable,
  needsNewAcceptance,
  validateCommunityConfig,
  validateCommunityTerms,
  type CommunityJoinInput,
} from './community.js';

const base = (over: Partial<CommunityJoinInput> = {}): CommunityJoinInput => ({
  community: { state: 'active', joinMode: 'open', termsVersion: null },
  membership: null,
  pendingRequest: false,
  acceptedTermsVersion: null,
  invite: null,
  ...over,
});

describe('decideJoin', () => {
  it('aberta entra direto', () => {
    expect(decideJoin(base())).toEqual({ ok: true, result: 'joined' });
  });

  it('membro ativo não entra de novo', () => {
    expect(decideJoin(base({ membership: 'active' }))).toEqual({ ok: true, result: 'already_member' });
  });

  it('arquivada ou suspensa recusa', () => {
    for (const state of ['archived', 'suspended'] as const)
      expect(decideJoin(base({ community: { state, joinMode: 'open', termsVersion: null } }))).toEqual({
        ok: false,
        refusal: 'not_active',
      });
  });

  it('com aprovação abre pedido, uma vez', () => {
    const community = { state: 'active' as const, joinMode: 'approval' as const, termsVersion: null };
    expect(decideJoin(base({ community }))).toEqual({ ok: true, result: 'requested' });
    expect(decideJoin(base({ community, pendingRequest: true }))).toEqual({
      ok: true,
      result: 'already_requested',
    });
  });

  it('fechada só com convite válido', () => {
    const community = { state: 'active' as const, joinMode: 'closed' as const, termsVersion: null };
    expect(decideJoin(base({ community }))).toEqual({ ok: false, refusal: 'invite_required' });
    expect(decideJoin(base({ community, invite: { valid: false } }))).toEqual({
      ok: false,
      refusal: 'invite_invalid',
    });
    expect(decideJoin(base({ community, invite: { valid: true } }))).toEqual({ ok: true, result: 'joined' });
  });

  it('convite dispensa a aprovação', () => {
    const community = { state: 'active' as const, joinMode: 'approval' as const, termsVersion: null };
    expect(decideJoin(base({ community, invite: { valid: true } }))).toEqual({ ok: true, result: 'joined' });
  });

  it('quem foi tirado só volta com convite', () => {
    expect(decideJoin(base({ membership: 'removed' }))).toEqual({ ok: false, refusal: 'removed' });
    expect(decideJoin(base({ membership: 'removed', invite: { valid: true } }))).toEqual({
      ok: true,
      result: 'joined',
    });
  });

  it('quem saiu volta', () => {
    expect(decideJoin(base({ membership: 'left' }))).toEqual({ ok: true, result: 'joined' });
  });

  it('termos em vigor exigem o Aceite da versão atual', () => {
    const community = { state: 'active' as const, joinMode: 'open' as const, termsVersion: 3 };
    expect(decideJoin(base({ community }))).toEqual({ ok: false, refusal: 'terms_required' });
    expect(decideJoin(base({ community, acceptedTermsVersion: 2 }))).toEqual({
      ok: false,
      refusal: 'terms_required',
    });
    expect(decideJoin(base({ community, acceptedTermsVersion: 3 }))).toEqual({ ok: true, result: 'joined' });
  });
});

describe('inviteUsable', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const inv = { revokedAt: null, expiresAt: null, maxUses: null, uses: 0 };
  it('vale sem prazo nem teto', () => expect(inviteUsable(inv, now)).toBe(true));
  it('revogado, vencido ou esgotado não vale', () => {
    expect(inviteUsable({ ...inv, revokedAt: now }, now)).toBe(false);
    expect(inviteUsable({ ...inv, expiresAt: now }, now)).toBe(false);
    expect(inviteUsable({ ...inv, maxUses: 2, uses: 2 }, now)).toBe(false);
    expect(inviteUsable({ ...inv, maxUses: 2, uses: 1 }, now)).toBe(true);
  });
});

describe('needsNewAcceptance', () => {
  it('só pede quando há termos mais novos que o último Aceite', () => {
    expect(needsNewAcceptance(null, null)).toBe(false);
    expect(needsNewAcceptance(2, 2)).toBe(false);
    expect(needsNewAcceptance(2, 1)).toBe(true);
    expect(needsNewAcceptance(1, null)).toBe(true);
  });
});

describe('validateCommunityConfig', () => {
  it('aceita os campos válidos e deixa os ausentes', () => {
    expect(validateCommunityConfig({ joinMode: 'approval', chatEnabled: true, historyDays: null })).toEqual({
      ok: true,
      patch: { joinMode: 'approval', chatEnabled: true, historyDays: null },
    });
  });
  it('recusa modo, booleano e janela fora do teto', () => {
    const r = validateCommunityConfig({ joinMode: 'friends', memberPosts: 'sim', historyDays: 731 });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.issues.map((i) => i.field).sort()).toEqual(['historyDays', 'joinMode', 'memberPosts']);
  });
});

describe('validateCommunityTerms', () => {
  it('exige os três idiomas', () => {
    expect(validateCommunityTerms({ pt: 'a', es: ' ', en: 'c' })).toEqual({ ok: false, missing: ['es'] });
    expect(validateCommunityTerms({ pt: ' a ', es: 'b', en: 'c' })).toEqual({
      ok: true,
      body: { pt: 'a', es: 'b', en: 'c' },
    });
  });
});
