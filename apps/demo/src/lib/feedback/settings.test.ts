import { WebhookSecretBox } from '@galaxie/db/webhooks';
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { describe, expect, it, vi } from 'vitest';

import {
  FEEDBACK_ENABLED_KEY,
  FEEDBACK_REPO_KEY,
  FEEDBACK_SEALED_TOKEN_KEY,
  isValidFeedbackToken,
  resolveFeedbackSettings,
  sealFeedbackToken,
} from './settings';

vi.mock('@/lib/auth/db', () => ({ pool: {} }));

const KEK = 'k'.repeat(40);
const box = new SettingsSecretBox([KEK]);
const TOKEN = 'github_pat_do_painel_1234567890';
const ENV = { FEEDBACK_GITHUB_TOKEN: 'github_pat_do_env_0987654321', FEEDBACK_GITHUB_REPO: 'o/env' };
const sealed = sealFeedbackToken(TOKEN, box);
const panel = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('liga/desliga', () => {
  it('nunca salvo = ligado', () => {
    expect(resolveFeedbackSettings(panel({}), {}, box).enabled).toBe(true);
  });

  it('o painel manda, nos dois sentidos', () => {
    expect(resolveFeedbackSettings(panel({ [FEEDBACK_ENABLED_KEY]: 'off' }), {}, box).enabled).toBe(false);
    expect(
      resolveFeedbackSettings(panel({ [FEEDBACK_ENABLED_KEY]: 'on' }), { FEEDBACK_ENABLED: 'off' }, box)
        .enabled,
    ).toBe(true);
  });
});

describe('precedência: painel e depois env', () => {
  it('sem nada no painel, vale o .env atual (sem migração)', () => {
    const s = resolveFeedbackSettings(panel({}), ENV, box);
    expect(s.config).toEqual({ token: ENV.FEEDBACK_GITHUB_TOKEN, repo: 'o/env' });
    expect(s.tokenInPanel).toBe(false);
  });

  it('token e repo do painel vencem o env', () => {
    const s = resolveFeedbackSettings(
      panel({ [FEEDBACK_SEALED_TOKEN_KEY]: sealed, [FEEDBACK_REPO_KEY]: 'o/painel' }),
      ENV,
      box,
    );
    expect(s.config).toEqual({ token: TOKEN, repo: 'o/painel' });
    expect(s).toMatchObject({ tokenInPanel: true, tokenUnreadable: false });
  });

  it('repo do painel fora do formato é ignorada', () => {
    const s = resolveFeedbackSettings(panel({ [FEEDBACK_REPO_KEY]: '../x' }), ENV, box);
    expect(s.config?.repo).toBe('o/env');
  });

  it('sem repo em lugar nenhum, não há destino (sem padrão para a repo principal)', () => {
    expect(
      resolveFeedbackSettings(panel({ [FEEDBACK_SEALED_TOKEN_KEY]: sealed }), {}, box).config,
    ).toBeNull();
  });
});

describe('token cifrado', () => {
  it('o que vai para o banco não contém o token (mecanismo geral, SETTINGS_KEK)', () => {
    expect(sealed.startsWith('enc:s1:')).toBe(true);
    expect(sealed).not.toContain(TOKEN);
  });

  it('não abre como outra chave do painel nem como segredo de um endpoint de webhook', () => {
    expect(box.open('APISPORTS_KEY', sealed)).toBeNull();
    // a caixa dos webhooks trata o formato novo como texto opaco: nunca chega ao token
    expect(new WebhookSecretBox([KEK]).open(sealed, '019a0000-0000-7000-8000-000000000001')).not.toBe(TOKEN);
  });

  it('o token gravado antes (cifrado com a KEK dos webhooks) continua abrindo', () => {
    const legacy = new WebhookSecretBox(['w'.repeat(40)]).seal(
      TOKEN,
      `ops.runtime_setting:${FEEDBACK_SEALED_TOKEN_KEY}`,
    );
    const migrated = SettingsSecretBox.fromEnv({ SETTINGS_KEK: KEK, WEBHOOK_SIGNING_SECRET: 'w'.repeat(40) });
    const s = resolveFeedbackSettings(panel({ [FEEDBACK_SEALED_TOKEN_KEY]: legacy }), ENV, migrated);
    expect(s).toMatchObject({ token: TOKEN, tokenUnreadable: false });
    // e precisa ser recifrado com a SETTINGS_KEK
    expect(migrated.needsReseal('FEEDBACK_GITHUB_TOKEN', legacy)).toBe(true);
    // a legado só vale para o token das sugestões
    expect(migrated.open('APISPORTS_KEY', legacy)).toBeNull();
  });

  it.each([
    ['KEK trocada', new SettingsSecretBox(['z'.repeat(40)])],
    ['sem KEK', null],
  ])('%s: marca como ilegível e cai no env', (_, other) => {
    const s = resolveFeedbackSettings(panel({ [FEEDBACK_SEALED_TOKEN_KEY]: sealed }), ENV, other);
    expect(s).toMatchObject({ tokenUnreadable: true, token: ENV.FEEDBACK_GITHUB_TOKEN });
  });

  it('texto puro gravado direto no banco nunca é usado', () => {
    const s = resolveFeedbackSettings(panel({ [FEEDBACK_SEALED_TOKEN_KEY]: TOKEN }), {}, box);
    expect(s).toMatchObject({ tokenUnreadable: true, token: null });
  });
});

describe('formato do token', () => {
  it('recusa curto, com espaço ou quebra de linha (viraria cabeçalho HTTP)', () => {
    expect(isValidFeedbackToken(TOKEN)).toBe(true);
    expect(isValidFeedbackToken('curto')).toBe(false);
    expect(isValidFeedbackToken(`${TOKEN} x`)).toBe(false);
    expect(isValidFeedbackToken(`${TOKEN}\nx-outro: 1`)).toBe(false);
  });
});
