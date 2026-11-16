import { describe, expect, it } from 'vitest';

import { resolveSignupSettings } from './settings';

const none = new Map<string, string>();

describe('chaves do cadastro em autoatendimento', () => {
  it('desligado por padrão: sem chave nem termos, o cadastro não abre', () => {
    const s = resolveSignupSettings(none, {});
    expect(s).toEqual({ enabled: false, termsVersion: null, open: false, perIpPerDay: 5, trialDays: 30 });
  });

  it('ligado sem versão dos termos continua fechado (trava jurídica)', () => {
    const s = resolveSignupSettings(new Map([['SIGNUP_ENABLED', 'on']]), {});
    expect(s.enabled).toBe(true);
    expect(s.open).toBe(false);
  });

  it('termos preenchidos sem ligar também não abre', () => {
    const s = resolveSignupSettings(new Map([['SIGNUP_TERMS_VERSION', '2026-11-v1']]), {});
    expect(s.termsVersion).toBe('2026-11-v1');
    expect(s.open).toBe(false);
  });

  it('abre só com os dois; o painel vence o env', () => {
    const s = resolveSignupSettings(
      new Map([
        ['SIGNUP_ENABLED', 'on'],
        ['SIGNUP_TERMS_VERSION', '2026-11-v1'],
        ['TRIAL_DAYS', '14'],
      ]),
      { SIGNUP_ENABLED: 'off', SIGNUP_PER_IP_PER_DAY: '2' },
    );
    expect(s).toEqual({
      enabled: true,
      termsVersion: '2026-11-v1',
      open: true,
      perIpPerDay: 2,
      trialDays: 14,
    });
  });

  it('valor inválido no painel é ignorado (vale o env ou o padrão)', () => {
    const s = resolveSignupSettings(
      new Map([
        ['SIGNUP_ENABLED', 'sim'],
        ['SIGNUP_TERMS_VERSION', 'tem espaço'],
        ['TRIAL_DAYS', '0'],
      ]),
      {},
    );
    expect(s.enabled).toBe(false);
    expect(s.termsVersion).toBeNull();
    expect(s.trialDays).toBe(30);
  });
});
