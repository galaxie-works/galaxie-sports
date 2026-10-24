import { describe, expect, it } from 'vitest';
import { lineupMinReviewStatus, settingDef } from './registry.js';
import { validateSettingKey } from './resolve.js';

describe('LINEUP_MIN_REVIEW_STATUS (piso editorial da grade de canais e ofertas)', () => {
  it('é flag da API, padrão approved, como o piso da semântica', () => {
    expect(settingDef('LINEUP_MIN_REVIEW_STATUS')).toMatchObject({
      section: 'wtw',
      type: 'enum',
      services: ['api'],
      default: 'approved',
      options: ['draft', 'reviewed', 'approved'],
    });
    expect(validateSettingKey('LINEUP_MIN_REVIEW_STATUS', 'draft')).toMatchObject({ ok: true });
    expect(validateSettingKey('LINEUP_MIN_REVIEW_STATUS', 'auto')).toMatchObject({ ok: false });
  });

  it('lê o env: vazio = approved, inválido = erro na partida', () => {
    expect(lineupMinReviewStatus({})).toBe('approved');
    expect(lineupMinReviewStatus({ LINEUP_MIN_REVIEW_STATUS: ' reviewed ' })).toBe('reviewed');
    expect(() => lineupMinReviewStatus({ LINEUP_MIN_REVIEW_STATUS: 'tudo' })).toThrow(/inválido/);
  });
});
