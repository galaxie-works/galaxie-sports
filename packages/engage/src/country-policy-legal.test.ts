import { describe, expect, it } from 'vitest';
import {
  bettingContentAllowed,
  completePolicy,
  DEFAULT_POLICY_KEY,
  hardenPolicy,
  INITIAL_COUNTRY_POLICIES,
  legalHoldUntil,
  marketingAllowed,
  normalizePolicy,
  resolvePolicy,
  STRICT_LEGAL_RULES,
  strictestOf,
  validatePolicy,
  type BettingLicense,
  type CountryPolicy,
} from './country-policy.js';

// #1115: apostas, consentimento de marketing e guarda legal na ficha por país
const policies = new Map(Object.entries(INITIAL_COUNTRY_POLICIES));
const BR = INITIAL_COUNTRY_POLICIES.BR!;
const US = INITIAL_COUNTRY_POLICIES.US!;
const AR = INITIAL_COUNTRY_POLICIES.AR!;
const day = 24 * 3600_000;
const license: BettingLicense = {
  reference: 'LIC-123',
  approvedBy: 'galaxie:admin',
  approvedAt: '2026-11-01T00:00:00Z',
};

describe('fichas iniciais (#1115)', () => {
  it('apostas fechadas em todos os países', () => {
    for (const [key, p] of Object.entries(INITIAL_COUNTRY_POLICIES))
      expect(p.bettingContent, key).toBe(false);
  });

  it('marketing opt-in em todos, menos o e-mail dos EUA (CAN-SPAM)', () => {
    for (const [key, p] of Object.entries(INITIAL_COUNTRY_POLICIES)) {
      if (key === 'US') continue;
      expect(p.marketingConsent, key).toEqual({ email: 'opt-in', push: 'opt-in', sms: 'opt-in' });
    }
    expect(US.marketingConsent).toEqual({ email: 'opt-out', push: 'opt-in', sms: 'opt-in' });
  });

  it('guarda legal: EUA 365, DEFAULT 365, demais 180', () => {
    expect(US.legalHoldDays).toBe(365);
    expect(INITIAL_COUNTRY_POLICIES[DEFAULT_POLICY_KEY]!.legalHoldDays).toBe(365);
    for (const k of ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'LATAM', 'CA'])
      expect(INITIAL_COUNTRY_POLICIES[k]!.legalHoldDays, k).toBe(180);
  });
});

describe('validação e gravação', () => {
  it('recusa campos fora do formato', () => {
    const bad = {
      ...structuredClone(BR),
      bettingContent: 'sim',
      marketingConsent: { email: 'talvez', push: 'opt-in' },
      legalHoldDays: 10,
    } as unknown as CountryPolicy;
    const paths = validatePolicy(bad).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'bettingContent',
        'marketingConsent.email',
        'marketingConsent.sms',
        'legalHoldDays',
      ]),
    );
  });

  it('grava os três campos e descarta canal desconhecido', () => {
    const extra = {
      ...structuredClone(US),
      marketingConsent: { ...US.marketingConsent, whatsapp: 'opt-out' },
    } as unknown as CountryPolicy;
    const n = normalizePolicy(extra);
    expect(n.marketingConsent).toEqual(US.marketingConsent);
    expect(n.bettingContent).toBe(false);
    expect(n.legalHoldDays).toBe(365);
  });

  it('ficha gravada antes do #1115 ganha as regras mais protetivas e fica válida', () => {
    const old = structuredClone(US) as Partial<CountryPolicy>;
    delete old.bettingContent;
    delete old.marketingConsent;
    delete old.legalHoldDays;
    const full = completePolicy(old as CountryPolicy);
    expect(full).toMatchObject(STRICT_LEGAL_RULES);
    expect(validatePolicy(full)).toEqual([]);
    expect(completePolicy(US)).toBe(US);
    const r = resolvePolicy('US', new Map([['US', old as CountryPolicy]]), [
      { country: 'US', primary: true },
    ]);
    expect(r!.policy).toMatchObject(STRICT_LEGAL_RULES);
  });

  it('canal faltando na ficha antiga entra como opt-in', () => {
    const old = {
      ...structuredClone(US),
      marketingConsent: { email: 'opt-out' },
    } as unknown as CountryPolicy;
    expect(completePolicy(old).marketingConsent).toEqual({ email: 'opt-out', push: 'opt-in', sms: 'opt-in' });
  });
});

describe('endurecimento do cliente', () => {
  it('desliga apostas e passa canal a opt-in', () => {
    const open = { ...structuredClone(US), bettingContent: true };
    const { policy, rejected } = hardenPolicy(open, {
      bettingContent: false,
      marketingConsent: { email: 'opt-in' },
    });
    expect(rejected).toEqual([]);
    expect(policy.bettingContent).toBe(false);
    expect(policy.marketingConsent.email).toBe('opt-in');
  });

  it('recusa o que afrouxa: ligar apostas, opt-out, canal desconhecido', () => {
    const { policy, rejected } = hardenPolicy(BR, {
      bettingContent: true as unknown as false,
      marketingConsent: { email: 'opt-out' as unknown as 'opt-in', whatsapp: 'opt-in' } as never,
    });
    expect(rejected.sort()).toEqual(
      ['bettingContent', 'marketingConsent.email', 'marketingConsent.whatsapp'].sort(),
    );
    expect(policy.bettingContent).toBe(false);
    expect(policy.marketingConsent.email).toBe('opt-in');
  });

  it('a guarda legal não é do cliente: mais curta ou mais longa, fica a da ficha', () => {
    for (const legalHoldDays of [30, 3650])
      expect(hardenPolicy(BR, { legalHoldDays } as never).policy.legalHoldDays).toBe(180);
  });
});

describe('valor null gravado fora do painel', () => {
  it('conta como ausente e entra no mais protetivo', () => {
    const odd = {
      ...structuredClone(BR),
      bettingContent: null,
      legalHoldDays: null,
      marketingConsent: { email: null, push: 'opt-out', sms: 'opt-in' },
    } as unknown as CountryPolicy;
    const full = completePolicy(odd);
    expect(full.bettingContent).toBe(false);
    expect(full.legalHoldDays).toBe(365);
    expect(full.marketingConsent).toEqual({ email: 'opt-in', push: 'opt-out', sms: 'opt-in' });
    expect(validatePolicy(full)).toEqual([]);
  });
});

describe('DEFAULT e o país principal', () => {
  it('o mais protetivo: apostas só se as duas aceitam, opt-in se uma exige, guarda mais longa', () => {
    const a = { ...structuredClone(US), bettingContent: true };
    const b = { ...structuredClone(AR), bettingContent: false };
    const s = strictestOf(a, b);
    expect(s.bettingContent).toBe(false);
    expect(s.marketingConsent.email).toBe('opt-in');
    expect(s.legalHoldDays).toBe(365);
  });

  it('torcedor de fora num cliente dos EUA cai na DEFAULT, sem e-mail opt-out', () => {
    const r = resolvePolicy('DE', policies, [{ country: 'US', primary: true }]);
    expect(r!.key).toBe(DEFAULT_POLICY_KEY);
    expect(r!.policy.marketingConsent.email).toBe('opt-in');
    expect(r!.policy.legalHoldDays).toBe(365);
  });
});

describe('apostas: ficha e licença', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  const open = { bettingContent: true };

  it('ficha fechada barra mesmo com licença aprovada (Brasil, MP 1.394)', () => {
    expect(bettingContentAllowed(BR, license, now)).toBe(false);
  });

  it('ficha aberta exige licença com referência e aprovação da Galaxie', () => {
    expect(bettingContentAllowed(open, null, now)).toBe(false);
    expect(bettingContentAllowed(open, { ...license, approvedBy: null }, now)).toBe(false);
    expect(bettingContentAllowed(open, { ...license, approvedAt: null }, now)).toBe(false);
    expect(bettingContentAllowed(open, { ...license, reference: '  ' }, now)).toBe(false);
    expect(bettingContentAllowed(open, license, now)).toBe(true);
  });

  it('licença vencida ou com validade ilegível não vale', () => {
    expect(bettingContentAllowed(open, { ...license, expiresAt: '2026-11-11T00:00:00Z' }, now)).toBe(false);
    expect(bettingContentAllowed(open, { ...license, expiresAt: 'logo' }, now)).toBe(false);
    expect(bettingContentAllowed(open, { ...license, expiresAt: '2027-01-01T00:00:00Z' }, now)).toBe(true);
  });
});

describe('marketing', () => {
  it('menor de 18 nunca recebe, nem com consentimento', () => {
    expect(marketingAllowed(US, 'email', { adult: false, consent: 'granted' })).toBe(false);
  });

  it('opt-in só com consentimento dado', () => {
    expect(marketingAllowed(BR, 'email', { adult: true, consent: 'none' })).toBe(false);
    expect(marketingAllowed(BR, 'email', { adult: true, consent: 'granted' })).toBe(true);
  });

  it('opt-out envia até recusar (e-mail nos EUA); SMS nos EUA segue opt-in', () => {
    expect(marketingAllowed(US, 'email', { adult: true, consent: 'none' })).toBe(true);
    expect(marketingAllowed(US, 'email', { adult: true, consent: 'denied' })).toBe(false);
    expect(marketingAllowed(US, 'sms', { adult: true, consent: 'none' })).toBe(false);
  });

  it('torcedor que muda de país: vale a regra do país novo com o consentimento que já deu', () => {
    // deu opt-in nos EUA; no Brasil (opt-in) continua recebendo; sem consentimento, os EUA mandavam e o Brasil não
    expect(marketingAllowed(BR, 'email', { adult: true, consent: 'granted' })).toBe(true);
    expect(marketingAllowed(BR, 'email', { adult: true, consent: 'none' })).toBe(false);
  });
});

describe('guarda legal', () => {
  it('conta da denúncia, pelo prazo da ficha', () => {
    const at = Date.parse('2026-11-12T00:00:00Z');
    expect(legalHoldUntil(US, at)).toBe(at + 365 * day);
    expect(legalHoldUntil(BR, at)).toBe(at + 180 * day);
  });
});
