import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODERATION_CONFIG,
  categoryLevel,
  maxStepFor,
  normalizeModerationConfig,
  parseModerationConfig,
  stepFor,
  type ModerationCeiling,
  type ModerationConfig,
} from './moderation-rules.js';
import { parseModerationCeiling } from './settings.js';

const open: ModerationCeiling = { hide: 'auto', mute: 'auto', muteHours: 24 };
const full = (patch: Partial<ModerationConfig> = {}): ModerationConfig => ({
  ...DEFAULT_MODERATION_CONFIG,
  ...patch,
});

describe('padrão (D4)', () => {
  it('tudo desligado, esconde e silencia agindo e avisando, suspende e bane só sinalizando', () => {
    expect(Object.values(DEFAULT_MODERATION_CONFIG.features).every((v) => v === false)).toBe(true);
    expect(DEFAULT_MODERATION_CONFIG.autonomy).toEqual({
      hide: 'notify',
      mute: 'notify',
      suspend: 'flag',
      ban: 'flag',
    });
    expect(parseModerationConfig(DEFAULT_MODERATION_CONFIG, open).ok).toBe(true);
  });
});

describe('parseModerationConfig', () => {
  it('recusa suspensão e banimento automáticos, mesmo com payload forjado', () => {
    for (const step of ['notify', 'auto']) {
      const r = parseModerationConfig(
        full({
          autonomy: { ...DEFAULT_MODERATION_CONFIG.autonomy, suspend: step as 'auto', ban: step as 'auto' },
        }),
        open,
      );
      expect(r).toEqual({ ok: false, errors: ['autonomy.suspend', 'autonomy.ban'] });
    }
  });

  it('recusa ação que não existe (Silêncio oculto) e campo desconhecido', () => {
    const r = parseModerationConfig(
      { ...full(), autonomy: { ...DEFAULT_MODERATION_CONFIG.autonomy, shadow_mute: 'auto' }, extra: 1 },
      open,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['extra', 'autonomy.shadow_mute']));
  });

  it('respeita o teto da Galaxie no degrau e nas horas de Silêncio', () => {
    const ceiling: ModerationCeiling = { hide: 'notify', mute: 'flag', muteHours: 6 };
    const r = parseModerationConfig(
      full({ autonomy: { hide: 'auto', mute: 'notify', suspend: 'flag', ban: 'flag' }, muteHours: 12 }),
      ceiling,
    );
    expect(r).toEqual({ ok: false, errors: ['autonomy.hide', 'autonomy.mute', 'muteHours'] });
    expect(
      parseModerationConfig(
        full({ autonomy: { hide: 'notify', mute: 'flag', suspend: 'flag', ban: 'flag' }, muteHours: 6 }),
        ceiling,
      ).ok,
    ).toBe(true);
  });

  it('régua 0 a 4; apostas e menores não têm régua', () => {
    expect(parseModerationConfig(full({ level: 5 as 4 }), open).ok).toBe(false);
    const r = parseModerationConfig({ ...full(), categories: { hate: 4, betting: 1, minors: 0 } }, open);
    expect(r).toEqual({ ok: false, errors: ['categories.betting', 'categories.minors'] });
  });

  it('texto do conteúdo escondido até 150 caracteres; vazio volta ao padrão', () => {
    expect(parseModerationConfig(full({ hiddenNotice: 'x'.repeat(151) }), open).ok).toBe(false);
    const r = parseModerationConfig(full({ hiddenNotice: '  ' }), open);
    expect(r.ok && r.value.hiddenNotice).toBe(null);
  });

  it('cargos isentos só da lista de cargos', () => {
    expect(parseModerationConfig(full({ exemptRoles: ['owner', 'chefe' as 'owner'] }), open).ok).toBe(false);
    const r = parseModerationConfig(full({ exemptRoles: ['moderator', 'moderator'] }), open);
    expect(r.ok && r.value.exemptRoles).toEqual(['moderator']);
  });

  it('configuração do cliente precisa de todos os campos; a exceção aceita parte', () => {
    expect(parseModerationConfig({ level: 3 }, open).ok).toBe(false);
    expect(parseModerationConfig({ level: 3, autonomy: { hide: 'auto' } }, open, { partial: true })).toEqual({
      ok: true,
      value: { level: 3, autonomy: { hide: 'auto' } },
    });
    expect(parseModerationConfig({ autonomy: { ban: 'auto' } }, open, { partial: true }).ok).toBe(false);
  });
});

describe('normalizeModerationConfig', () => {
  it('teto baixado depois: a leitura rebaixa o degrau e as horas', () => {
    const stored = full({
      autonomy: { hide: 'auto', mute: 'auto', suspend: 'flag', ban: 'flag' },
      muteHours: 24,
    });
    const c = normalizeModerationConfig(stored, { hide: 'notify', mute: 'flag', muteHours: 2 });
    expect(c.autonomy).toEqual({ hide: 'notify', mute: 'flag', suspend: 'flag', ban: 'flag' });
    expect(c.muteHours).toBe(2);
  });

  it('gravado à mão com banimento automático: volta a só sinalizar', () => {
    const c = normalizeModerationConfig({ autonomy: { ban: 'auto', suspend: 'notify' } }, open);
    expect(c.autonomy.ban).toBe('flag');
    expect(c.autonomy.suspend).toBe('flag');
  });

  it('exceção de sala herda o cliente no que não muda', () => {
    const base = full({ level: 3, features: { ...DEFAULT_MODERATION_CONFIG.features, live_chat: true } });
    const c = normalizeModerationConfig({ level: 1, autonomy: { hide: 'auto' } }, open, base);
    expect(c.level).toBe(1);
    expect(c.features.live_chat).toBe(true);
    expect(c.autonomy).toEqual({ hide: 'auto', mute: 'notify', suspend: 'flag', ban: 'flag' });
  });
});

describe('régua e degrau efetivos', () => {
  it('categoria travada vale o máximo; sem ajuste vale o nível geral', () => {
    const c = full({ level: 1, categories: { spam: 3 } });
    expect(categoryLevel(c, 'betting')).toBe(4);
    expect(categoryLevel(c, 'minors')).toBe(4);
    expect(categoryLevel(c, 'spam')).toBe(3);
    expect(categoryLevel(c, 'hate')).toBe(1);
  });

  it('cargo isento só é sinalizado; o teto vale de novo na hora de agir', () => {
    const c = full({
      autonomy: { hide: 'auto', mute: 'auto', suspend: 'flag', ban: 'flag' },
      exemptRoles: ['moderator'],
    });
    expect(stepFor(c, 'hide', open, 'moderator')).toBe('flag');
    expect(stepFor(c, 'hide', open, null)).toBe('auto');
    expect(stepFor(c, 'hide', { ...open, hide: 'notify' })).toBe('notify');
    expect(maxStepFor('ban', open)).toBe('flag');
  });
});

describe('parseModerationCeiling', () => {
  it('valor inválido cai no degrau mais baixo; horas nunca passam de 24', () => {
    expect(parseModerationCeiling({ hide: 'x', mute: null, muteHours: '48' })).toEqual({
      hide: 'flag',
      mute: 'flag',
      muteHours: 24,
    });
  });
});

describe('público infantil (#1025)', () => {
  it('opcional na configuração inteira (vale false), recusado se não for booleano', () => {
    const { childAudience: _, ...old } = DEFAULT_MODERATION_CONFIG;
    const parsed = parseModerationConfig(old, open);
    expect(parsed.ok && parsed.value.childAudience).toBe(false);
    expect(parseModerationConfig({ ...old, childAudience: true }, open)).toMatchObject({
      ok: true,
      value: { childAudience: true },
    });
    expect(parseModerationConfig({ ...old, childAudience: 'sim' }, open)).toEqual({
      ok: false,
      errors: ['childAudience'],
    });
    expect(parseModerationConfig({ childAudience: true }, open, { partial: true })).toEqual({
      ok: true,
      value: { childAudience: true },
    });
  });

  it('a sala ou comunidade liga, mas não desliga o que o cliente ligou', () => {
    const kids = { ...DEFAULT_MODERATION_CONFIG, childAudience: true };
    expect(normalizeModerationConfig({ childAudience: false }, open, kids).childAudience).toBe(true);
    expect(normalizeModerationConfig({ childAudience: true }, open).childAudience).toBe(true);
    expect(normalizeModerationConfig({}, open).childAudience).toBe(false);
  });
});
