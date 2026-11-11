import { describe, expect, it } from 'vitest';
import {
  hardenPolicy,
  INITIAL_COUNTRY_POLICIES,
  LATAM_POLICY_KEY,
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
  it('as nove fichas são válidas, com 18 para escrever e 13 para participar', () => {
    expect(Object.keys(INITIAL_COUNTRY_POLICIES).sort()).toEqual(
      ['AR', 'BR', 'CA', 'CL', 'CO', LATAM_POLICY_KEY, 'MX', 'PE', 'US'].sort(),
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

  it('sem país ou país sem ficha: a do país principal do cliente', () => {
    expect(resolvePolicy(null, policies, tenant)).toMatchObject({ key: 'BR', fallback: true });
    expect(resolvePolicy('DE', policies, tenant)).toMatchObject({ key: 'BR', fallback: true });
  });

  it('sem país principal com ficha → null (o módulo recusa)', () => {
    expect(resolvePolicy('DE', policies, [{ country: 'DE', primary: true }])).toBeNull();
    expect(resolvePolicy('DE', policies, [])).toBeNull();
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

  it('LATAM não é país de torcedor', () => {
    expect(resolvePolicy('LATAM', policies, tenant)).toMatchObject({ key: 'BR', fallback: true });
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
