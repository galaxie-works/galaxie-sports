import { describe, expect, it } from 'vitest';
import {
  AGE_ASSURANCE_LEVELS,
  ageBandFloor,
  assuranceAtLeast,
  DEFAULT_POLICY_KEY,
  INITIAL_COUNTRY_POLICIES,
  LATAM_POLICY_KEY,
  type AgeBand,
  type CountryPolicy,
} from './country-policy.js';
import { ADULT_ONLY_CAPABILITIES, AGE_CAPABILITIES, ageGate, type AgeCapability } from './age-gate.js';
import { FAN_GUARDIAN_STATUSES, fanAgeStatus, type FanAgeFacts } from './fan-age.js';

const P = INITIAL_COUNTRY_POLICIES;
const BR = P.BR!;
const US = P.US!;
const CO = P.CO!;
const adult: FanAgeFacts = {
  band: '18plus',
  assurance: 'verified',
  guardianStatus: 'none',
  guardianLinked: false,
  frozen: false,
};
const teen = (band: AgeBand, extra: Partial<FanAgeFacts> = {}): FanAgeFacts => ({
  ...adult,
  band,
  assurance: 'estimated',
  ...extra,
});
const gate = (policy: CountryPolicy | null, fan: FanAgeFacts, capability: AgeCapability) =>
  ageGate({ policy, fan, capability });

// os 9 países com ficha inicial e a DEFAULT
const COUNTRIES = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', LATAM_POLICY_KEY, 'US', 'CA', DEFAULT_POLICY_KEY];
const BANDS: AgeBand[] = ['under13', '13_17', '13', '14_15', '16_17', '18plus'];

function* matrix() {
  for (const country of COUNTRIES)
    for (const band of BANDS)
      for (const assurance of AGE_ASSURANCE_LEVELS)
        for (const guardianStatus of FAN_GUARDIAN_STATUSES)
          for (const guardianLinked of [false, true])
            for (const frozen of [false, true])
              for (const capability of AGE_CAPABILITIES) {
                const policy = P[country]!;
                const fan: FanAgeFacts = { band, assurance, guardianStatus, guardianLinked, frozen };
                yield { country, policy, fan, capability, result: gate(policy, fan, capability) };
              }
}

describe('portão de idade (#1106)', () => {
  it('cobre as fichas dos 9 países e a DEFAULT', () => {
    for (const c of COUNTRIES) expect(P[c], c).toBeDefined();
  });

  it('matriz país × faixa × método × responsável × capacidade: as regras fixas da Galaxie valem em todas', () => {
    // sem um expect por combinação (são dezenas de milhares): junta as violações e confere no fim
    const bad: string[] = [];
    let n = 0;
    for (const { country, policy, fan, capability, result } of matrix()) {
      n++;
      const fail = (why: string) => bad.push(`${country} ${JSON.stringify(fan)} ${capability}: ${why}`);
      if (!result.allowed) {
        if (result.reason === 'ok') fail('recusa sem motivo');
        continue;
      }
      if (result.reason !== 'ok' || result.next !== undefined) fail('liberado com motivo');
      const floor = ageBandFloor(fan.band);
      // menor de 13 fora de tudo
      if (floor < Math.max(13, policy.minAgeParticipate)) fail('abaixo da idade para participar');
      // proteção e defesa: só a idade para participar
      if (capability === 'safety') continue;
      // só 18+ (e sem faixa congelada) nos recursos de adulto
      if (ADULT_ONLY_CAPABILITIES.includes(capability) && (floor < 18 || fan.frozen))
        fail('recurso de adulto');
      // a ficha: autorização, vínculo e comprovação
      if (floor < policy.parentalConsentUnder && fan.guardianStatus !== 'granted') fail('sem autorização');
      if (
        policy.guardianLinkRequiredUnder !== null &&
        floor < policy.guardianLinkRequiredUnder &&
        !fan.guardianLinked
      )
        fail('sem vínculo');
      const feature = capability === 'viewRestrictedContent' ? 'restrictedContent' : 'social';
      if (!assuranceAtLeast(fan.assurance, policy.ageAssuranceMin[feature])) fail('sem comprovação');
      if (capability === 'marketplace' && !policy.gamification.marketplace) fail('marketplace desligado');
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(n).toBe(COUNTRIES.length * BANDS.length * 3 * 4 * 2 * 2 * AGE_CAPABILITIES.length);
  });

  it('o portão e o age_status do /v1/fans/me dizem a mesma coisa', () => {
    const bad: string[] = [];
    for (const { country, policy, fan, capability, result } of matrix()) {
      if (capability !== 'read' && capability !== 'write') continue;
      const status = fanAgeStatus(fan, policy);
      const expected =
        capability === 'read' ? status === 'read_only' || status === 'can_write' : status === 'can_write';
      if (result.allowed !== expected) bad.push(`${country} ${JSON.stringify(fan)} ${capability} ${status}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('o motivo da recusa aponta o que falta, na ordem em que o cliente resolve', () => {
    expect(gate(BR, teen('under13'), 'read')).toEqual({ allowed: false, reason: 'under_min_age' });
    // adulto-só vem antes da autorização: não adianta pedir o responsável para o menor resgatar
    expect(gate(BR, teen('14_15'), 'redeem')).toEqual({ allowed: false, reason: 'adult_only' });
    expect(gate(BR, teen('14_15'), 'read')).toEqual({
      allowed: false,
      reason: 'guardian_consent',
      next: 'guardian_consent',
    });
    expect(gate(BR, teen('14_15', { guardianStatus: 'granted' }), 'read')).toEqual({
      allowed: false,
      reason: 'guardian_link',
      next: 'guardian_link',
    });
    expect(
      gate(BR, teen('14_15', { guardianStatus: 'granted', guardianLinked: true, assurance: 'self' }), 'read'),
    ).toEqual({ allowed: false, reason: 'age_assurance', next: 'verify_age' });
    expect(gate(BR, teen('14_15', { guardianStatus: 'granted', guardianLinked: true }), 'predict')).toEqual({
      allowed: true,
      reason: 'ok',
    });
  });

  it('revogação da autorização corta o menor na hora', () => {
    const ok = teen('14_15', { guardianStatus: 'granted', guardianLinked: true });
    expect(gate(BR, ok, 'earnPoints').allowed).toBe(true);
    expect(gate(BR, { ...ok, guardianStatus: 'revoked' }, 'earnPoints')).toMatchObject({
      allowed: false,
      reason: 'guardian_consent',
    });
  });

  it('16 e 17 no Brasil participam sem o responsável; na Colômbia, não', () => {
    expect(gate(BR, teen('16_17'), 'react').allowed).toBe(true);
    expect(gate(CO, teen('16_17'), 'react').reason).toBe('guardian_consent');
    expect(gate(CO, teen('16_17', { guardianStatus: 'granted' }), 'react').allowed).toBe(true);
  });

  it('só 18+ escreve, resgata, recebe Prêmio e contato direto; faixa congelada pede comprovação', () => {
    for (const c of ['write', 'redeem', 'receivePrize', 'directContact'] as const) {
      expect(gate(US, adult, c).allowed, c).toBe(true);
      expect(gate(US, teen('16_17'), c).reason, c).toBe('adult_only');
      expect(gate(US, { ...adult, band: '13_17', frozen: true }, c), c).toEqual({
        allowed: false,
        reason: 'frozen',
        next: 'verify_age',
      });
    }
    // ficha que pede 21 para escrever recusa todo mundo
    expect(gate({ ...US, minAgeWrite: 21 }, adult, 'write').reason).toBe('adult_only');
  });

  it('conteúdo restrito usa a comprovação mais forte da ficha', () => {
    expect(gate(BR, { ...adult, assurance: 'estimated' }, 'read').allowed).toBe(true);
    expect(gate(BR, { ...adult, assurance: 'estimated' }, 'viewRestrictedContent')).toEqual({
      allowed: false,
      reason: 'age_assurance',
      next: 'verify_age',
    });
    expect(gate(BR, adult, 'viewRestrictedContent').allowed).toBe(true);
  });

  it('marketplace e publicidade para menores seguem a ficha do país', () => {
    expect(gate(US, adult, 'marketplace').reason).toBe('not_in_country');
    expect(
      gate({ ...US, gamification: { ...US.gamification, marketplace: true } }, adult, 'marketplace').allowed,
    ).toBe(true);
    expect(gate(US, adult, 'receiveMarketing').allowed).toBe(true);
    expect(gate(US, teen('14_15'), 'receiveMarketing').reason).toBe('not_in_country');
    expect(gate({ ...US, adsToMinors: true }, teen('14_15'), 'receiveMarketing').allowed).toBe(true);
  });

  it('sem ficha, só o adulto lê', () => {
    expect(gate(null, adult, 'read').allowed).toBe(true);
    expect(gate(null, adult, 'write')).toEqual({ allowed: false, reason: 'no_policy' });
    expect(gate(null, teen('16_17', { guardianStatus: 'granted' }), 'read').reason).toBe('no_policy');
  });

  it('a ficha sobe o piso de participação, nunca desce', () => {
    expect(gate({ ...US, minAgeParticipate: 16 }, teen('14_15'), 'read').reason).toBe('under_min_age');
    expect(gate({ ...US, minAgeParticipate: 10 }, teen('under13'), 'read').reason).toBe('under_min_age');
  });

  it('denunciar, bloquear e apelar não dependem do responsável nem da comprovação', () => {
    expect(gate(BR, teen('14_15', { guardianStatus: 'revoked', assurance: 'self' }), 'safety').allowed).toBe(
      true,
    );
    expect(gate(null, teen('14_15'), 'safety').allowed).toBe(true);
    expect(gate(BR, teen('under13'), 'safety').reason).toBe('under_min_age');
    expect(gate({ ...US, minAgeParticipate: 16 }, teen('14_15'), 'safety').reason).toBe('under_min_age');
  });

  it('ficha que baixa a idade de escrever não libera o menor, e o age_status diz o mesmo', () => {
    const low = { ...US, minAgeWrite: 16 };
    const fan = teen('16_17');
    expect(gate(low, fan, 'write').reason).toBe('adult_only');
    expect(fanAgeStatus(fan, low)).toBe('read_only');
    for (const band of BANDS)
      for (const minAgeWrite of [13, 16, 18, 21]) {
        const p = { ...US, minAgeWrite };
        const f = { ...adult, band, assurance: 'self' as const, guardianStatus: 'granted' as const };
        expect(gate(p, f, 'write').allowed, `${band} ${minAgeWrite}`).toBe(
          fanAgeStatus(f, p) === 'can_write',
        );
      }
  });
});
