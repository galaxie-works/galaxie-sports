import { describe, expect, it, vi } from 'vitest';
import type { ModerationItem, ModerationOutcome } from '@galaxie/cosmos';
import type { Database } from '@galaxie/db';
import { ChatCosmos, type ChatCosmosMessage } from './cosmos.js';

/* Adaptador da Cosmos para a sala do chat (#981): só no cliente que ligou; marcada, denunciada e Leitura total. */

vi.mock('@galaxie/cosmos', async (orig) => {
  const real = await orig<typeof import('@galaxie/cosmos')>();
  return {
    ...real,
    readModerationCeiling: vi.fn(async () => ({})),
    loadModerationConfig: vi.fn(async (_db: unknown, tenantId: string) => ({
      effective: {
        features: {
          live_chat: tenantId !== 'off',
          full_read: tenantId === 'full',
        },
      },
    })),
  };
});

const clocks = { contentPurgeAt: new Date(0), decisionPurgeAt: new Date(0) };
const msg = (over: Partial<ChatCosmosMessage> = {}): ChatCosmosMessage => ({
  tenantId: 't1',
  roomId: 'r1',
  messageId: 'm1',
  profileId: 'p1',
  text: 'que jogo',
  locale: 'pt-BR',
  rules: { action: 'allow', reasons: [], categories: [], suspect: false, evasion: false },
  clocks,
  source: 'filter',
  ...over,
});

function setup() {
  const submitted: ModerationItem[] = [];
  const executed: unknown[] = [];
  const db = {
    execute: vi.fn(async (q: unknown) => {
      executed.push(q);
      return [];
    }),
  } as unknown as Database;
  const cosmos = new ChatCosmos(db, {
    batcher: { submit: (i) => void submitted.push(i), drain: async () => {} },
  });
  return { cosmos, submitted, executed };
}

describe('ChatCosmos', () => {
  it('cliente sem a função ligada: nada vai ao motor (segue como hoje)', async () => {
    const { cosmos, submitted } = setup();
    expect(await cosmos.submit(msg({ tenantId: 'off', rules: { ...msg().rules, suspect: true } }))).toBe(
      false,
    );
    expect(submitted).toEqual([]);
  });

  it('vai a marcada pelo filtro e a denunciada; a limpa sem Leitura total não vai', async () => {
    const { cosmos, submitted } = setup();
    expect(await cosmos.submit(msg())).toBe(false);
    expect(await cosmos.submit(msg({ rules: { ...msg().rules, suspect: true } }))).toBe(true);
    expect(await cosmos.submit(msg({ source: 'report', messageId: 'm2' }))).toBe(true);
    expect(submitted.map((i) => [i.targetId, i.source, i.module, i.room, i.targetType])).toEqual([
      ['m1', 'filter', 'chat', 'r1', 'message'],
      ['m2', 'report', 'chat', 'r1', 'message'],
    ]);
  });

  it('com a Leitura total, o que o classificador não acha limpo também vai', async () => {
    const { cosmos, submitted } = setup();
    expect(await cosmos.submit(msg({ tenantId: 'full', text: 'que jogo bonito' }))).toBe(false);
    expect(await cosmos.submit(msg({ tenantId: 'full', text: 'kkk kkk kkk kkk kkk kkk kkk kkk kkk' }))).toBe(
      true,
    );
    expect(submitted).toHaveLength(1);
  });

  it('o que a Cosmos escondeu sai do ar; o "só sugere" e o liberado ficam', async () => {
    const { cosmos, executed } = setup();
    const outcome = (step: 'auto' | 'notify' | 'flag', allow = false): ModerationOutcome => ({
      item: { module: 'chat', targetType: 'message', tenantId: 't1', targetId: 'm1' } as ModerationItem,
      by: 'cosmos',
      verdict: null,
      plan: { allow, queue: step !== 'auto', actions: [{ action: 'hide', step }], level: 2, threshold: 2 },
    });
    await cosmos.applyDecision(outcome('flag'));
    await cosmos.applyDecision(outcome('auto', true));
    expect(executed).toHaveLength(0);
    await cosmos.applyDecision(outcome('auto'));
    await cosmos.applyDecision(outcome('notify'));
    expect(executed).toHaveLength(2);
  });
});
