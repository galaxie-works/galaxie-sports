import { describe, expect, it } from 'vitest';
import { ageOn, bandForAge, canonicalJson, diditOutcome, diditStatus } from './age-verification.js';

const NOW = new Date('2026-11-14T12:00:00Z');

describe('verificação de idade (#1109)', () => {
  it('idade completa pela data de nascimento, com aniversário e data inválida', () => {
    expect(ageOn('2008-11-14', NOW)).toBe(18);
    expect(ageOn('2008-11-15', NOW)).toBe(17);
    expect(ageOn('2010-02-29', NOW)).toBeNull();
    expect(ageOn('2030-01-01', NOW)).toBeNull();
    expect(ageOn('14/11/2008', NOW)).toBeNull();
  });

  it('faixa fina pela idade', () => {
    expect([12, 13, 14, 15, 16, 17, 18].map(bandForAge)).toEqual([
      'under13',
      '13',
      '14_15',
      '14_15',
      '16_17',
      '16_17',
      '18plus',
    ]);
  });

  it('estado desconhecido do provedor fica pendente', () => {
    expect(diditStatus('Approved')).toBe('approved');
    expect(diditStatus('Kyc Expired')).toBe('expired');
    expect(diditStatus('Algo Novo')).toBe('pending');
    expect(diditStatus(undefined)).toBe('pending');
  });

  it('aprovada só pela estimativa = estimated e 18plus, cobrada como estimativa', () => {
    expect(
      diditOutcome(
        {
          status: 'Approved',
          liveness_checks: [{ status: 'Approved', age_estimation: 31.2 }],
          face_matches: null,
        },
        NOW,
      ),
    ).toEqual({ status: 'approved', path: 'estimate', band: '18plus', method: 'estimated', billable: true });
  });

  it('aprovada pelo documento = verified com a faixa da data, cobrada como documento', () => {
    expect(
      diditOutcome(
        {
          status: 'Approved',
          liveness_checks: [{ status: 'Approved', age_estimation: 19 }],
          id_verifications: [{ status: 'Approved', date_of_birth: '2007-01-02' }],
          face_matches: [{ status: 'Approved' }],
        },
        NOW,
      ),
    ).toEqual({ status: 'approved', path: 'document', band: '18plus', method: 'verified', billable: true });
  });

  it('aprovada com documento sem data ou de menor não comprova nada', () => {
    for (const dob of [null, '2010-05-05'])
      expect(
        diditOutcome(
          { status: 'Approved', id_verifications: [{ status: 'Approved', date_of_birth: dob }] },
          NOW,
        ),
      ).toMatchObject({ status: 'review', band: null, method: null });
  });

  it('recusada pelo documento de menor traz a faixa verificada; recusada pela estimativa não', () => {
    expect(
      diditOutcome(
        { status: 'Declined', id_verifications: [{ status: 'Approved', date_of_birth: '2011-03-01' }] },
        NOW,
      ),
    ).toEqual({ status: 'declined', path: 'document', band: '14_15', method: 'verified', billable: true });
    expect(
      diditOutcome(
        { status: 'Declined', liveness_checks: [{ status: 'Declined', age_estimation: 14 }] },
        NOW,
      ),
    ).toEqual({ status: 'declined', path: 'estimate', band: null, method: null, billable: true });
  });

  it('sessão abandonada antes de qualquer etapa não é cobrada', () => {
    expect(diditOutcome({ status: 'Abandoned' }, NOW)).toEqual({
      status: 'abandoned',
      path: null,
      band: null,
      method: null,
      billable: false,
    });
    expect(diditOutcome({ status: 'Not Started' }, NOW)).toMatchObject({
      status: 'pending',
      billable: false,
    });
  });

  it('JSON canônico: chaves em ordem, compacto, Unicode como está, inteiro sem decimal', () => {
    expect(canonicalJson({ b: 1.0, a: { z: 'ção', y: [2.5, null, true] }, c: undefined })).toBe(
      '{"a":{"y":[2.5,null,true],"z":"ção"},"b":1}',
    );
  });
});
