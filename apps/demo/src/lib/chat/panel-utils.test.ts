import { describe, expect, it } from 'vitest';

import { authorActionSeconds, isAuthorAction, isSlowModeOption, roomTitle, sanctionOf } from './panel-utils';

describe('painel do chat', () => {
  it('só aceita as durações que a tela oferece', () => {
    expect(authorActionSeconds('mute', 5)).toBe(300);
    expect(authorActionSeconds('shadow_mute', 60)).toBe(3_600);
    expect(authorActionSeconds('mute', 7)).toBeNull();
    expect(authorActionSeconds('suspend', 7)).toBe(7 * 86_400);
    expect(authorActionSeconds('suspend', 2)).toBeNull();
    expect(authorActionSeconds('ban', undefined)).toBe(0);
  });

  it('cada botão vira um degrau da Escada', () => {
    expect(sanctionOf('shadow_mute')).toEqual({ level: 'mute', hidden: true });
    expect(sanctionOf('suspend')).toEqual({ level: 'suspension', hidden: false });
    expect(isAuthorAction('ban')).toBe(true);
    expect(isAuthorAction('expel')).toBe(false);
  });

  it('modo lento só nas opções, e null volta ao padrão', () => {
    expect(isSlowModeOption(10)).toBe(true);
    expect(isSlowModeOption(null)).toBe(true);
    expect(isSlowModeOption(7)).toBe(false);
  });

  it('nome da sala pelos times', () => {
    expect(roomTitle({ home: 'Palmeiras', away: 'Botafogo', fixtureId: 'x' })).toBe('Palmeiras x Botafogo');
    expect(roomTitle({ home: null, away: null, fixtureId: '0190f1c0-aaaa' })).toBe('#0190f1c0');
    expect(roomTitle({ home: 'Boca', away: 'River', fixtureId: 'x' }, '{home} vs {away}')).toBe(
      'Boca vs River',
    );
  });
});
