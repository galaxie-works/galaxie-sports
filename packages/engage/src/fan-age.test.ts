import { describe, expect, it } from 'vitest';
import { INITIAL_COUNTRY_POLICIES, LATAM_POLICY_KEY, policyAllows } from './country-policy.js';
import { detailAgeBand, fanAgeStatus, type FanAgeFacts } from './fan-age.js';

const BR = INITIAL_COUNTRY_POLICIES.BR!;
const US = INITIAL_COUNTRY_POLICIES.US!;
const CO = INITIAL_COUNTRY_POLICIES.CO!;
const adult: FanAgeFacts = {
  band: '18plus',
  assurance: 'estimated',
  guardianStatus: 'none',
  guardianLinked: false,
  frozen: false,
};

describe('estado de idade do torcedor (#1105)', () => {
  it('a faixa larga 13_17 vale como 13, a mais restritiva', () => {
    expect(detailAgeBand('13_17')).toBe('13');
    expect(detailAgeBand('16_17')).toBe('16_17');
    expect(policyAllows('13_17', 'participate', { ...BR, minAgeParticipate: 14 })).toBe(false);
    expect(policyAllows('14_15', 'participate', { ...BR, minAgeParticipate: 14 })).toBe(true);
  });

  it('adulto com a comprovação que a ficha pede escreve; sem ela, precisa comprovar', () => {
    expect(fanAgeStatus(adult, BR)).toBe('can_write');
    expect(fanAgeStatus({ ...adult, assurance: 'self' }, BR)).toBe('needs_verification');
    expect(fanAgeStatus({ ...adult, assurance: 'self' }, US)).toBe('can_write');
  });

  it('menor abaixo da idade da autorização precisa do responsável e, no Brasil, do vínculo', () => {
    const teen: FanAgeFacts = { ...adult, band: '14_15' };
    expect(fanAgeStatus(teen, BR)).toBe('needs_guardian');
    expect(fanAgeStatus({ ...teen, guardianStatus: 'granted' }, BR)).toBe('needs_guardian');
    expect(fanAgeStatus({ ...teen, guardianStatus: 'granted', guardianLinked: true }, BR)).toBe('read_only');
    expect(fanAgeStatus({ ...teen, guardianStatus: 'revoked', guardianLinked: true }, BR)).toBe(
      'needs_guardian',
    );
    // 16 e 17 no Brasil: sem autorização nem vínculo, só lê
    expect(fanAgeStatus({ ...adult, band: '16_17' }, BR)).toBe('read_only');
    // Colômbia: autorização até os 18
    expect(fanAgeStatus({ ...adult, band: '16_17', assurance: 'self' }, CO)).toBe('needs_guardian');
  });

  it('menor de 13 e faixa abaixo da idade da ficha ficam de fora', () => {
    expect(fanAgeStatus({ ...adult, band: 'under13' }, US)).toBe('blocked');
    expect(fanAgeStatus({ ...adult, band: '13' }, { ...US, minAgeParticipate: 16 })).toBe('blocked');
  });

  it('faixa congelada depois de descer só lê', () => {
    expect(fanAgeStatus({ ...adult, frozen: true }, BR)).toBe('read_only');
  });

  it('sem ficha, só adulto participa, e só lendo', () => {
    expect(fanAgeStatus(adult, null)).toBe('read_only');
    expect(fanAgeStatus({ ...adult, band: '16_17' }, null)).toBe('blocked');
    expect(INITIAL_COUNTRY_POLICIES[LATAM_POLICY_KEY]).toBeDefined();
  });
});
