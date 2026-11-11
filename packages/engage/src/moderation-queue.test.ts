import { describe, expect, it } from 'vitest';
import {
  appealRoute,
  canJudgeAppeal,
  caseSeverity,
  checkSanction,
  hideThreshold,
  retentionDeadlines,
  sanctionAction,
  sanctionActive,
  shouldHide,
  SANCTION_SCOPE,
} from './moderation-queue.js';

const now = Date.parse('2026-11-11T12:00:00Z');
const H = 3600_000;

describe('fila única: gravidade e ocultar (#953)', () => {
  it('ameaça vem antes de spam; mais denúncias sobem um pouco', () => {
    expect(caseSeverity(['threat'])).toBeGreaterThan(caseSeverity(['spam'], 20));
    expect(caseSeverity(['spam'], 5)).toBe(34);
    expect(caseSeverity(['spam', 'hate'], 2)).toBe(91);
  });

  it('limite de ocultar fica entre 1 e o teto da Galaxie', () => {
    expect(hideThreshold(null)).toBe(3);
    expect(hideThreshold(50)).toBe(10);
    expect(hideThreshold(0)).toBe(1);
    expect(shouldHide('message', 3, 3)).toBe(true);
    expect(shouldHide('message', 2, 3)).toBe(false);
    expect(shouldHide('profile', 9, 3)).toBe(false);
  });
});

describe('Escada', () => {
  const policy = { punishmentNoticeRequired: false };
  const base = { hidden: false, endsAt: now + H, scopeId: 'sala-1', decidedBy: 'person' as const };

  it('alcance de cada degrau', () => {
    expect(SANCTION_SCOPE).toEqual({
      warning: 'place',
      mute: 'place',
      suspension: 'tenant',
      expulsion: 'community',
      ban: 'tenant',
    });
    expect(sanctionAction('ban', false)).toBe('moderation.ban');
    expect(sanctionAction('mute', true)).toBe('moderation.shadow_mute');
  });

  it('Silenciar e Suspensão pedem prazo; Advertência no lugar pede o lugar', () => {
    expect(
      checkSanction({ ...base, level: 'mute', endsAt: null }, { now, hiddenEnabled: false, policy }),
    ).toEqual(['needs_end']);
    expect(
      checkSanction(
        { ...base, level: 'warning', endsAt: null, scopeId: null },
        { now, hiddenEnabled: false, policy },
      ),
    ).toEqual(['needs_scope']);
    expect(
      checkSanction(
        { ...base, level: 'ban', endsAt: null, scopeId: null },
        { now, hiddenEnabled: false, policy },
      ),
    ).toEqual([]);
  });

  it('Silêncio oculto: só pessoa, com prazo, com a opção do cliente e onde a lei não exige aviso', () => {
    const hidden = { ...base, level: 'mute' as const, hidden: true };
    expect(checkSanction(hidden, { now, hiddenEnabled: true, policy })).toEqual([]);
    expect(checkSanction(hidden, { now, hiddenEnabled: false, policy })).toContain('hidden_not_allowed');
    expect(
      checkSanction(hidden, { now, hiddenEnabled: true, policy: { punishmentNoticeRequired: true } }),
    ).toContain('hidden_not_allowed');
    expect(checkSanction(hidden, { now, hiddenEnabled: true, policy: null })).toContain('hidden_not_allowed');
    expect(checkSanction({ ...hidden, decidedBy: 'cosmos' }, { now, hiddenEnabled: true, policy })).toContain(
      'hidden_by_cosmos',
    );
    expect(checkSanction({ ...hidden, endsAt: null }, { now, hiddenEnabled: true, policy })).toContain(
      'hidden_needs_end',
    );
  });

  it('a Cosmos só sugere Advertência e Silenciar', () => {
    expect(
      checkSanction(
        { ...base, level: 'suspension', decidedBy: 'cosmos', scopeId: null },
        { now, hiddenEnabled: false, policy },
      ),
    ).toEqual(['cosmos_level']);
  });

  it('punição ativa até o fim ou a revogação', () => {
    expect(sanctionActive({ endsAt: now + 1, revokedAt: null }, now)).toBe(true);
    expect(sanctionActive({ endsAt: now, revokedAt: null }, now)).toBe(false);
    expect(sanctionActive({ endsAt: null, revokedAt: now - 1 }, now)).toBe(false);
  });
});

describe('apelação', () => {
  it('primeira vai para moderador; segunda só depois da Cosmos, para pessoa ou para a Galaxie', () => {
    expect(appealRoute(1, { teamCanJudge: true })).toEqual({
      to: 'team',
      action: 'moderation.appeal.first',
      personOnly: false,
    });
    expect(appealRoute(2, { firstDecidedBy: 'person', teamCanJudge: true })).toBeNull();
    expect(appealRoute(2, { firstDecidedBy: 'cosmos', teamCanJudge: true })).toEqual({
      to: 'team',
      action: 'moderation.appeal.second',
      personOnly: true,
    });
    expect(appealRoute(2, { firstDecidedBy: 'cosmos', teamCanJudge: false })).toEqual({ to: 'galaxie' });
  });

  it('quem puniu não julga; segunda etapa nunca é da Cosmos', () => {
    const j = (id: string | null, kind: 'person' | 'cosmos' = 'person') => ({ kind, id });
    expect(canJudgeAppeal({ judge: j('u1'), appliedBy: 'u1', previousJudge: null, stage: 1 })).toBe(false);
    expect(canJudgeAppeal({ judge: j('u2'), appliedBy: 'u1', previousJudge: null, stage: 1 })).toBe(true);
    expect(canJudgeAppeal({ judge: j('u2'), appliedBy: 'u1', previousJudge: 'u2', stage: 2 })).toBe(false);
    expect(canJudgeAppeal({ judge: j(null, 'cosmos'), appliedBy: 'u1', previousJudge: null, stage: 1 })).toBe(
      true,
    );
    expect(
      canJudgeAppeal({ judge: j(null, 'cosmos'), appliedBy: 'cosmos', previousJudge: null, stage: 1 }),
    ).toBe(false);
    expect(canJudgeAppeal({ judge: j(null, 'cosmos'), appliedBy: 'u1', previousJudge: null, stage: 2 })).toBe(
      false,
    );
  });
});

describe('guarda legal', () => {
  it('relógios da ficha: conteúdo removido e decisão', () => {
    const d = retentionDeadlines(
      { retention: { accessLogDays: 183, removedContentDays: 90, moderationDecisionsDays: 730 } },
      now,
    );
    expect(d.contentPurgeAt - now).toBe(90 * 24 * H);
    expect(d.decisionPurgeAt - now).toBe(730 * 24 * H);
  });
});
