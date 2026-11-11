import { describe, expect, it } from 'vitest';

import { demoFanTokenBody, parseFanProfile, storedFanProfile } from './profile';

describe('perfil de torcedor da demo (#1020)', () => {
  it('aceita apelido, faixa e país; recusa e-mail, faixa ou país fora da lista', () => {
    expect(parseFanProfile({ nickname: '  Tricolor   77 ', ageBand: '13_17', country: 'BR' })).toEqual({
      ok: true,
      value: { nickname: 'Tricolor 77', ageBand: '13_17', country: 'BR' },
    });
    expect(parseFanProfile({ nickname: 'a@b.c', ageBand: '18plus', country: 'BR' })).toEqual({
      ok: false,
      field: 'nickname',
    });
    expect(parseFanProfile({ nickname: 'x', ageBand: '18plus', country: 'BR' })).toMatchObject({ ok: false });
    expect(parseFanProfile({ nickname: 'Torcedor', ageBand: 'adult', country: 'BR' })).toEqual({
      ok: false,
      field: 'ageBand',
    });
    expect(parseFanProfile({ nickname: 'Torcedor', ageBand: '18plus', country: 'ZZ' })).toEqual({
      ok: false,
      field: 'country',
    });
    expect(parseFanProfile(null)).toMatchObject({ ok: false });
  });

  it('sem perfil completo, sem token', () => {
    expect(storedFanProfile({ fanNickname: 'Torcedor', fanAgeBand: null, fanCountry: 'BR' })).toBeNull();
    expect(storedFanProfile({ fanNickname: 'Torcedor', fanAgeBand: '18plus', fanCountry: 'AR' })).toEqual({
      nickname: 'Torcedor',
      ageBand: '18plus',
      country: 'AR',
    });
  });

  it('o corpo do token leva o id opaco do usuário e nada do login', () => {
    const body = demoFanTokenBody('u_123', { nickname: 'Torcedor', ageBand: '18plus', country: 'BR' }, 'en');
    expect(body).toEqual({
      externalAccountId: 'demo:u_123',
      externalProfileId: 'demo:u_123',
      nickname: 'Torcedor',
      ageBand: '18plus',
      country: 'BR',
      locale: 'en',
      holderAdult: 'unknown',
      surface: 'web',
    });
    expect(demoFanTokenBody('u', { nickname: 'xx', ageBand: '18plus', country: 'BR' }, 'xx').locale).toBe(
      'pt-BR',
    );
  });
});
