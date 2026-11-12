import { describe, expect, it } from 'vitest';

import { decisionAction, dueState, isAutomatic, personId, suggestionOf } from './queue-utils';

describe('fila de revisão', () => {
  it('lê a sugestão da Cosmos por cima da do filtro, e só campos válidos', () => {
    const s = suggestionOf({
      filter: { fallback: 'insufficient' },
      cosmos: {
        by: 'cosmos',
        category: 'hate',
        severity: 3,
        suggestion: ['hide', 'mute', 7],
        steps: { hide: 'auto', mute: 'notify', x: 1 },
        reason: 'ofensa racial',
        level: 2,
        credits: 0.4,
      },
    });
    expect(s).toMatchObject({
      by: 'cosmos',
      category: 'hate',
      severity: 3,
      actions: ['hide', 'mute'],
      steps: { hide: 'auto', mute: 'notify' },
    });
    expect(suggestionOf({ cosmos: { suggestion: 'allow' } })?.actions).toBe('allow');
    expect(suggestionOf({ filter: { fallback: 'insufficient' } })).toMatchObject({
      by: 'filter',
      fallback: 'insufficient',
    });
    expect(suggestionOf(null)).toBeNull();
  });

  it('cada decisão pede a ação certa da matriz de cargos', () => {
    expect(decisionAction('approve')).toBe('moderation.hide');
    expect(decisionAction('undo')).toBe('moderation.hide');
    expect(decisionAction('mute')).toBe('moderation.mute');
    expect(decisionAction('suspend')).toBe('moderation.suspend');
    expect(decisionAction('ban')).toBe('moderation.ban');
  });

  it('prazo: vencido, perto de vencer, no prazo, ou sem prazo', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(dueState('2026-11-12T11:00:00Z', now)).toBe('overdue');
    expect(dueState('2026-11-12T20:00:00Z', now)).toBe('soon');
    expect(dueState('2026-11-14T12:00:00Z', now)).toBe('ok');
    expect(dueState(null, now)).toBeNull();
  });

  it('decisão automática e quem decidiu', () => {
    expect(isAutomatic({ cosmos: {} })).toBe(true);
    expect(isAutomatic({ report: {} })).toBe(false);
    expect(personId('user:abc')).toBe('abc');
    expect(personId('cosmos')).toBeNull();
  });
});

describe('decisões possíveis', () => {
  it('apelação não se decide na fila; punir pede autor; silenciar pede lugar', async () => {
    const { applicableDecisions } = await import('./queue-utils');
    const base = { source: 'report', automatic: false, hasAuthor: true, room: 'sala', community: null };
    expect(applicableDecisions({ ...base, source: 'appeal' })).toEqual([]);
    expect(applicableDecisions(base)).toEqual(['approve', 'remove', 'mute', 'suspend', 'ban']);
    expect(applicableDecisions({ ...base, room: null })).toEqual(['approve', 'remove', 'suspend', 'ban']);
    expect(applicableDecisions({ ...base, hasAuthor: false, automatic: true })).toEqual([
      'approve',
      'remove',
      'undo',
    ]);
  });
});

describe('filtros do histórico', () => {
  it('só valores aceitos passam da URL', async () => {
    const { pickHistoryFilters } = await import('./queue-utils');
    expect(pickHistoryFilters({ module: 'chat', category: 'x', action: 'undo', actorKind: 'fan' })).toEqual({
      module: 'chat',
      action: 'undo',
    });
  });
});
