import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_KEY,
  hardenPolicy,
  INITIAL_COUNTRY_POLICIES,
  isPolicyKey,
  LATAM_POLICY_KEY,
  STRICT_AGE_RULES,
  withAgeRules,
  normalizePolicy,
  policyAllows,
  policyChangeIssues,
  resolvePolicy,
  validatePolicy,
  type CountryPolicy,
} from './country-policy.js';

const policies = new Map(Object.entries(INITIAL_COUNTRY_POLICIES));
const BR = INITIAL_COUNTRY_POLICIES.BR!;

describe('fichas iniciais', () => {
  it('as dez fichas são válidas, com 18 para escrever e 13 para participar', () => {
    expect(Object.keys(INITIAL_COUNTRY_POLICIES).sort()).toEqual(
      ['AR', 'BR', 'CA', 'CL', 'CO', DEFAULT_POLICY_KEY, LATAM_POLICY_KEY, 'MX', 'PE', 'US'].sort(),
    );
    for (const [key, p] of Object.entries(INITIAL_COUNTRY_POLICIES)) {
      expect(validatePolicy(p), key).toEqual([]);
      expect(p.minAgeWrite, key).toBe(18);
      expect(p.minAgeParticipate, key).toBe(13);
      expect(p.retention, key).toEqual({
        accessLogDays: 183,
        removedContentDays: 90,
        moderationDecisionsDays: 730,
      });
    }
    expect(INITIAL_COUNTRY_POLICIES.US!.entity).toBe('llc');
    expect(INITIAL_COUNTRY_POLICIES.CA!.entity).toBe('llc');
    expect(BR.entity).toBe('ltda');
    expect(BR.languages).toEqual(['pt-BR']);
  });

  it('as fichas não compartilham objetos (mudar uma não muda a outra)', () => {
    expect(INITIAL_COUNTRY_POLICIES.AR!.gamification).not.toBe(INITIAL_COUNTRY_POLICIES.MX!.gamification);
    expect(INITIAL_COUNTRY_POLICIES.AR!.ageAssuranceMin).not.toBe(
      INITIAL_COUNTRY_POLICIES.MX!.ageAssuranceMin,
    );
    expect(INITIAL_COUNTRY_POLICIES[DEFAULT_POLICY_KEY]!.ageAssuranceMin).not.toBe(
      STRICT_AGE_RULES.ageAssuranceMin,
    );
  });

  it('idade e responsável (#1104): os valores sugeridos pela revisão jurídica', () => {
    const rules = Object.fromEntries(
      Object.entries(INITIAL_COUNTRY_POLICIES).map(([k, p]) => [
        k,
        [
          p.parentalConsentUnder,
          p.guardianLinkRequiredUnder,
          p.ageAssuranceMin.social,
          p.ageAssuranceMin.restrictedContent,
          p.hearMinor,
        ],
      ]),
    );
    expect(rules).toEqual({
      BR: [16, 16, 'estimated', 'verified', false],
      AR: [16, null, 'self', 'self', false],
      MX: [18, null, 'self', 'self', false],
      CO: [18, null, 'self', 'self', true],
      CL: [14, null, 'self', 'self', false],
      PE: [14, null, 'self', 'self', false],
      [LATAM_POLICY_KEY]: [18, null, 'self', 'self', true],
      US: [13, null, 'self', 'self', false],
      CA: [14, null, 'self', 'self', false],
      [DEFAULT_POLICY_KEY]: [18, 18, 'estimated', 'verified', true],
    });
  });

  it('DEFAULT é chave de ficha', () => {
    expect(isPolicyKey(DEFAULT_POLICY_KEY)).toBe(true);
    expect(isPolicyKey('DEFAULTS')).toBe(false);
  });
});

describe('ficha usada pelo torcedor', () => {
  const tenant = [
    { country: 'BR', primary: true },
    { country: 'AR', primary: false },
  ];

  it('país do torcedor com ficha', () => {
    expect(resolvePolicy('ar', policies, tenant)).toMatchObject({ key: 'AR', fallback: false });
  });

  it('país latino sem ficha própria cai na LATAM', () => {
    expect(resolvePolicy('UY', policies, tenant)).toMatchObject({ key: LATAM_POLICY_KEY, fallback: false });
  });

  it('país sem ficha e fora da LATAM: a DEFAULT, não a do país principal do cliente', () => {
    // torcedor alemão num cliente brasileiro: não cai nas regras do Brasil
    const r = resolvePolicy('DE', policies, tenant);
    expect(r).toMatchObject({ key: DEFAULT_POLICY_KEY, fallback: true });
    expect(r!.policy.parentalConsentUnder).toBe(18);
    expect(r!.policy.ageAssuranceMin).toEqual({ social: 'estimated', restrictedContent: 'verified' });
    expect(resolvePolicy('DE', policies, [])).toMatchObject({ key: DEFAULT_POLICY_KEY });
  });

  it('a DEFAULT nunca protege menos que a ficha do país principal', () => {
    const strictBR: CountryPolicy = {
      ...structuredClone(BR),
      minAgeParticipate: 16,
      retention: { ...BR.retention, removedContentDays: 30 },
      prizeCampaign: { ...BR.prizeCampaign, maxValue: 500, excludedRegions: ['SP'] },
      consentRenewalDays: 365,
    };
    const map = new Map(policies).set('BR', strictBR);
    const p = resolvePolicy('DE', map, tenant)!.policy;
    const D = INITIAL_COUNTRY_POLICIES[DEFAULT_POLICY_KEY]!;
    expect(p).toMatchObject({
      minAgeParticipate: 16,
      retention: { removedContentDays: 30 },
      prizeCampaign: { maxValue: 500, excludedRegions: ['SP'] },
      consentRenewalDays: 365,
      parentalConsentUnder: 18,
      guardianLinkRequiredUnder: 18,
      ageAssuranceMin: { social: 'estimated', restrictedContent: 'verified' },
      hearMinor: true,
      punishmentNoticeRequired: true,
      currency: D.currency,
      languages: D.languages,
    });
    expect(validatePolicy(p)).toEqual([]);
  });

  it('sem país: a do país principal do cliente; sem DEFAULT, país de fora também', () => {
    expect(resolvePolicy(null, policies, tenant)).toMatchObject({ key: 'BR', fallback: true });
    const noDefault = new Map([...policies].filter(([k]) => k !== DEFAULT_POLICY_KEY));
    expect(resolvePolicy('DE', noDefault, tenant)).toMatchObject({ key: 'BR', fallback: true });
  });

  it('sem ficha que sirva → null (o módulo recusa)', () => {
    const noDefault = new Map([...policies].filter(([k]) => k !== DEFAULT_POLICY_KEY));
    expect(resolvePolicy('DE', noDefault, [{ country: 'DE', primary: true }])).toBeNull();
    expect(resolvePolicy('DE', noDefault, [])).toBeNull();
  });

  it('ficha gravada antes do #1104 ganha as regras de idade mais protetivas', () => {
    const old = structuredClone(BR) as Partial<CountryPolicy>;
    delete old.parentalConsentUnder;
    delete old.guardianLinkRequiredUnder;
    delete old.ageAssuranceMin;
    delete old.hearMinor;
    delete old.consentRenewalDays;
    const r = resolvePolicy('BR', new Map([['BR', old as CountryPolicy]]), tenant);
    expect(r!.policy).toMatchObject(STRICT_AGE_RULES);
    expect(validatePolicy(withAgeRules(old as CountryPolicy))).toEqual([]);
    expect(withAgeRules(BR)).toBe(BR);
  });

  it('aplica o que o cliente endureceu para o país do torcedor', () => {
    const r = resolvePolicy('BR', policies, [
      { country: 'BR', primary: true, hardening: { punishmentNoticeRequired: true, removedContentDays: 30 } },
    ]);
    expect(r!.policy.punishmentNoticeRequired).toBe(true);
    expect(r!.policy.retention.removedContentDays).toBe(30);
    expect(BR.punishmentNoticeRequired).toBe(false);
  });

  it('torcedor de país que o cliente não marcou recebe o endurecimento do país principal', () => {
    const t = [{ country: 'BR', primary: true, hardening: { minAgeParticipate: 16 } }];
    expect(resolvePolicy('US', policies, t)!.policy.minAgeParticipate).toBe(16);
    expect(resolvePolicy('BO', policies, t)).toMatchObject({ key: LATAM_POLICY_KEY });
    expect(resolvePolicy('BO', policies, t)!.policy.minAgeParticipate).toBe(16);
  });

  it('LATAM e DEFAULT não são país de torcedor', () => {
    expect(resolvePolicy('LATAM', policies, tenant)).toMatchObject({ key: 'BR', fallback: true });
    expect(resolvePolicy('DEFAULT', policies, tenant)).toMatchObject({ key: 'BR', fallback: true });
  });
});

describe('o cliente só endurece', () => {
  const loose: CountryPolicy = {
    ...structuredClone(BR),
    adsToMinors: true,
    gamification: { materialExchange: true, marketplace: true, raffle: true },
    prizeCampaign: { maxValue: 1000, excludedRegions: [], legalClassificationRequired: true },
  };

  it('aceita subir idade, encurtar retenção, desligar o que a ficha libera e baixar o teto de prêmio', () => {
    const { policy, rejected } = hardenPolicy(loose, {
      minAgeParticipate: 16,
      removedContentDays: 30,
      adsToMinors: false,
      gamification: { raffle: false },
      prizeMaxValue: 500,
      punishmentNoticeRequired: true,
    });
    expect(rejected).toEqual([]);
    expect(policy).toMatchObject({
      minAgeParticipate: 16,
      minAgeWrite: 18,
      adsToMinors: false,
      gamification: { materialExchange: true, marketplace: true, raffle: false },
      prizeCampaign: { maxValue: 500 },
      punishmentNoticeRequired: true,
    });
    expect(policy.retention.removedContentDays).toBe(30);
  });

  it('recusa o que afrouxa e mantém a ficha', () => {
    const { policy, rejected } = hardenPolicy(BR, {
      minAgeWrite: 16,
      removedContentDays: 365,
      adsToMinors: true as never,
      gamification: { raffle: true as never },
      punishmentNoticeRequired: false as never,
    });
    expect(rejected.sort()).toEqual(
      [
        'adsToMinors',
        'gamification.raffle',
        'minAgeWrite',
        'punishmentNoticeRequired',
        'removedContentDays',
      ].sort(),
    );
    expect(policy).toEqual(BR);
  });

  it('idade e responsável: idade só sobe, comprovação só fica mais forte, prazo só encurta', () => {
    const CL = INITIAL_COUNTRY_POLICIES.CL!;
    const up = hardenPolicy(CL, {
      parentalConsentUnder: 18,
      guardianLinkRequiredUnder: 16,
      ageAssuranceMin: { social: 'verified' },
      hearMinor: true,
      consentRenewalDays: 365,
    });
    expect(up.rejected).toEqual([]);
    expect(up.policy).toMatchObject({
      parentalConsentUnder: 18,
      guardianLinkRequiredUnder: 16,
      ageAssuranceMin: { social: 'verified', restrictedContent: 'self' },
      hearMinor: true,
      consentRenewalDays: 365,
    });
    expect(validatePolicy(up.policy)).toEqual([]);
    // cliente tenta afrouxar a ficha do Brasil: tudo recusado, ficha igual
    const down = hardenPolicy(BR, {
      parentalConsentUnder: 14,
      guardianLinkRequiredUnder: 14,
      ageAssuranceMin: { restrictedContent: 'self', social: 'nope' as never },
      hearMinor: false as never,
    });
    expect(down.rejected.sort()).toEqual(
      [
        'ageAssuranceMin.restrictedContent',
        'ageAssuranceMin.social',
        'guardianLinkRequiredUnder',
        'hearMinor',
        'parentalConsentUnder',
      ].sort(),
    );
    expect(down.policy).toEqual(BR);
    // prazo: pôr prazo onde não havia endurece; alongar afrouxa
    const short = hardenPolicy(CL, { consentRenewalDays: 180 }).policy;
    expect(hardenPolicy(short, { consentRenewalDays: 365 }).rejected).toEqual(['consentRenewalDays']);
    // vínculo acima da idade da autorização fica no teto (a ficha pode ter baixado depois que o cliente salvou)
    const capped = hardenPolicy(CL, { guardianLinkRequiredUnder: 16 });
    expect(capped.rejected).toEqual([]);
    expect(capped.policy.guardianLinkRequiredUnder).toBe(CL.parentalConsentUnder);
    expect(validatePolicy(capped.policy)).toEqual([]);
  });

  it('subir a idade para participar leva junto a idade da autorização', () => {
    const p = hardenPolicy(INITIAL_COUNTRY_POLICIES.US!, { minAgeParticipate: 16 }).policy;
    expect(p.parentalConsentUnder).toBe(16);
    expect(validatePolicy(p)).toEqual([]);
  });

  it('teto de prêmio: pôr teto onde não havia endurece; subir o teto afrouxa', () => {
    expect(hardenPolicy(BR, { prizeMaxValue: 10 }).policy.prizeCampaign.maxValue).toBe(10);
    const capped = hardenPolicy(BR, { prizeMaxValue: 10 }).policy;
    expect(hardenPolicy(capped, { prizeMaxValue: 50 }).rejected).toEqual(['prizeMaxValue']);
  });
});

describe('mudança de ficha pela Galaxie', () => {
  it('baixar a idade de 18 para escrever exige decisão explícita', () => {
    const next = { ...structuredClone(BR), minAgeWrite: 16 };
    expect(policyChangeIssues(BR, next).map((i) => i.path)).toEqual(['minAgeWrite']);
    expect(policyChangeIssues(BR, next, { allowLowerWriteAge: true })).toEqual([]);
  });

  it('13 para participar é piso fixo, mesmo com decisão explícita', () => {
    const next = { ...structuredClone(BR), minAgeParticipate: 12 };
    expect(policyChangeIssues(BR, next, { allowLowerWriteAge: true }).map((i) => i.path)).toContain(
      'minAgeParticipate',
    );
  });

  it('recusa moeda, fuso, idioma e retenção inválidos', () => {
    const bad = {
      ...structuredClone(BR),
      currency: 'real',
      timeZone: 'Lua/Base',
      languages: ['de'],
      retention: { accessLogDays: 0, removedContentDays: 90, moderationDecisionsDays: 730 },
    } as unknown as CountryPolicy;
    expect(
      validatePolicy(bad)
        .map((i) => i.path)
        .sort(),
    ).toEqual(['currency', 'languages', 'retention.accessLogDays', 'timeZone'].sort());
  });

  it('recusa flags que não são sim ou não, fuso vazio, listas sem texto e teto em texto', () => {
    const bad = {
      ...structuredClone(BR),
      adsToMinors: 'no',
      gamification: undefined,
      timeZone: undefined,
      laws: [1],
      prizeCampaign: { maxValue: '5', legalClassificationRequired: true },
    } as unknown as CountryPolicy;
    expect(
      validatePolicy(bad)
        .map((i) => i.path)
        .sort(),
    ).toEqual(
      [
        'adsToMinors',
        'gamification.marketplace',
        'gamification.materialExchange',
        'gamification.raffle',
        'laws',
        'prizeCampaign.excludedRegions',
        'prizeCampaign.maxValue',
        'timeZone',
      ].sort(),
    );
  });

  it('recusa regras de idade fora do lugar', () => {
    const bad = {
      ...structuredClone(BR),
      parentalConsentUnder: 12,
      guardianLinkRequiredUnder: 17,
      ageAssuranceMin: { social: 'self', restrictedContent: 'documento' },
      hearMinor: 'sim',
      consentRenewalDays: 5,
    } as unknown as CountryPolicy;
    expect(
      validatePolicy(bad)
        .map((i) => i.path)
        .sort(),
    ).toEqual(
      [
        'ageAssuranceMin.restrictedContent',
        'consentRenewalDays',
        'guardianLinkRequiredUnder',
        'hearMinor',
        'parentalConsentUnder',
        'parentalConsentUnder',
      ].sort(),
    );
    const below = { ...structuredClone(BR), minAgeParticipate: 15, parentalConsentUnder: 14 };
    expect(validatePolicy(below).map((i) => i.path)).toContain('parentalConsentUnder');
    // participar a partir de 19 a 21: a autorização fica em 18 e a ficha continua válida
    const adult = {
      ...structuredClone(BR),
      minAgeWrite: 21,
      minAgeParticipate: 20,
      parentalConsentUnder: 18,
    };
    expect(validatePolicy(adult)).toEqual([]);
  });

  it('grava só os campos conhecidos', () => {
    const extra = { ...structuredClone(BR), hack: 1 } as unknown as CountryPolicy;
    expect(normalizePolicy(extra)).toEqual(BR);
    expect('hack' in normalizePolicy(extra)).toBe(false);
  });
});

describe('faixa × ficha (toda rota de escrita)', () => {
  it('under13 não participa; 13_17 participa e não escreve; 18plus escreve', () => {
    expect(policyAllows('under13', 'participate', BR)).toBe(false);
    expect(policyAllows('13_17', 'participate', BR)).toBe(true);
    expect(policyAllows('13_17', 'write', BR)).toBe(false);
    expect(policyAllows('18plus', 'write', BR)).toBe(true);
  });

  it('país mais rígido: 16 para participar tira o 13_17; 21 para escrever tira todo mundo', () => {
    const strict = hardenPolicy(BR, { minAgeParticipate: 16, minAgeWrite: 21 }).policy;
    expect(policyAllows('13_17', 'participate', strict)).toBe(false);
    expect(policyAllows('18plus', 'participate', strict)).toBe(true);
    expect(policyAllows('18plus', 'write', strict)).toBe(false);
  });
});
