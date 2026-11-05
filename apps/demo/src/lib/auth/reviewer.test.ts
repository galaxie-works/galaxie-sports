import { describe, expect, it, vi } from 'vitest';

import { isReviewerEmail, reviewerLogin, reviewerOtp } from './reviewer';

describe('conta de revisão', () => {
  const env = { DEMO_REVIEWER_EMAIL: ' Revisor@Exemplo.com ', DEMO_REVIEWER_CODE: '123456' };

  it('lê o e-mail normalizado e o código', () => {
    expect(reviewerLogin(env, 6)).toEqual({ email: 'revisor@exemplo.com', code: '123456' });
  });

  it('fica desligada sem as duas variáveis', () => {
    expect(reviewerLogin({}, 6)).toBeNull();
    expect(reviewerLogin({ DEMO_REVIEWER_EMAIL: 'a@b.c' }, 6)).toBeNull();
    expect(reviewerLogin({ DEMO_REVIEWER_CODE: '123456' }, 6)).toBeNull();
  });

  it('fica desligada com código fora do formato', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reviewerLogin({ ...env, DEMO_REVIEWER_CODE: '12345' }, 6)).toBeNull();
    expect(reviewerLogin({ ...env, DEMO_REVIEWER_CODE: 'abc123' }, 6)).toBeNull();
    err.mockRestore();
  });

  it('dá o código fixo só no login do e-mail configurado', () => {
    const r = reviewerLogin(env, 6);
    expect(reviewerOtp(r, { email: 'revisor@exemplo.com', type: 'sign-in' })).toBe('123456');
    expect(reviewerOtp(r, { email: 'outro@exemplo.com', type: 'sign-in' })).toBeUndefined();
    expect(reviewerOtp(r, { email: 'revisor@exemplo.com', type: 'forget-password' })).toBeUndefined();
    expect(reviewerOtp(null, { email: 'revisor@exemplo.com', type: 'sign-in' })).toBeUndefined();
    expect(isReviewerEmail(r, 'REVISOR@exemplo.com')).toBe(true);
    expect(isReviewerEmail(null, 'revisor@exemplo.com')).toBe(false);
  });
});
