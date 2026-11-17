import { describe, expect, it } from 'vitest';

import {
  checklistSteps,
  checklistStorageKey,
  checklistVisible,
  sampleWidgetEmbed,
  testKeyCurl,
  type ChecklistFacts,
} from './checklist-shared';

const base: ChecklistFacts = {
  state: 'trial',
  testKey: { prefix: 'ab12cd34ef56', used: false },
  publishableKey: { prefix: 'gs_pk_live_abcdefgh', used: false },
  acceptedOthers: 0,
  sampleWidgetId: null,
};

describe('checklist da primeira sessão (F3, decisão 10)', () => {
  it('deriva os quatro passos do doc 02, na ordem, cada um pela própria prova', () => {
    expect(checklistSteps(base).map((s) => [s.id, s.done])).toEqual([
      ['call', false],
      ['widget', false],
      ['invite', false],
      ['plan', false],
    ]);
    const done = checklistSteps({
      state: 'active',
      testKey: { prefix: 'ab12cd34ef56', used: true },
      publishableKey: { prefix: 'gs_pk_live_abcdefgh', used: true },
      acceptedOthers: 2,
      sampleWidgetId: 'w1',
    });
    expect(done.every((s) => s.done)).toBe(true);
    expect(done.map((s) => s.href)).toEqual([
      '/client/keys',
      '/client/builder',
      '/client/users',
      '/client/plans',
    ]);
  });

  it('sem chave de teste ou publicável, o passo fica pendente (a chave usada é a prova)', () => {
    const steps = checklistSteps({ ...base, testKey: null, publishableKey: null });
    expect(steps[0]!.done).toBe(false);
    expect(steps[1]!.done).toBe(false);
    expect(checklistSteps({ ...base, testKey: { prefix: 'x', used: true } })[0]!.done).toBe(true);
  });

  it('aparece em trial e active enquanto falta passo; some com tudo feito ou noutro estado', () => {
    expect(checklistVisible(base)).toBe(true);
    expect(checklistVisible({ ...base, state: 'active' })).toBe(true);
    expect(checklistVisible({ ...base, state: 'trial_expired' })).toBe(false);
    expect(checklistVisible({ ...base, state: 'pending_review' })).toBe(false);
    expect(
      checklistVisible({
        state: 'active',
        testKey: { prefix: 'a', used: true },
        publishableKey: { prefix: 'b', used: true },
        acceptedOthers: 1,
        sampleWidgetId: null,
      }),
    ).toBe(false);
    // em trial o passo 4 nunca está feito: o checklist fica até a conta sair do teste
    expect(
      checklistVisible({
        state: 'trial',
        testKey: { prefix: 'a', used: true },
        publishableKey: { prefix: 'b', used: true },
        acceptedOthers: 1,
        sampleWidgetId: null,
      }),
    ).toBe(true);
  });

  it('o curl usa o prefixo da chave test e um marcador no lugar do resto', () => {
    expect(testKeyCurl('https://api.example/', 'ab12cd34ef56', 'RESTO_DA_CHAVE')).toBe(
      'curl "https://api.example/v1/sports" -H "x-galaxie-key: gs_test_ab12cd34ef56_RESTO_DA_CHAVE"',
    );
  });

  it('o embed traz o id do widget e só o prefixo da chave publicável', () => {
    expect(sampleWidgetEmbed('https://site.example/', 'w-1', 'gs_pk_live_abcdefgh')).toBe(
      '<script src="https://site.example/embed.js" async></script>\n<galaxie-widget widget="w-1" key="gs_pk_live_abcdefgh…"></galaxie-widget>',
    );
    expect(sampleWidgetEmbed('https://site.example', 'w-1', null)).toContain('key="gs_pk_live_…"');
  });

  it('a dispensa é por marca', () => {
    expect(checklistStorageKey('t1')).not.toBe(checklistStorageKey('t2'));
  });
});
