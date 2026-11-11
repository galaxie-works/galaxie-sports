/**
 * Chaves do painel dentro da demo (#1087): a releitura põe a chave aberta no env do processo e volta ao .env quando a
 * linha some ou não abre; a situação mandada à tela nunca leva o valor.
 */
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { settingDef } from '@galaxie/runtime-config';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/db', () => ({ pool: {} }));

const KEK = 'k'.repeat(40);
const ENV_STRIPE = 'sk_' + 'test_doEnvDoContainer123';
const PANEL_STRIPE = 'sk_' + 'test_doPainelNovo1234567890';
const before = { ...process.env };
process.env.SETTINGS_KEK = KEK;
process.env.STRIPE_SECRET_KEY = ENV_STRIPE;
delete process.env.SMTP_PASSWORD;

// o módulo guarda o .env do contêiner ao carregar
const { containerEnv, refreshPanelSecrets } = await import('./panel-secrets');
const { panelSecretState } = await import('./data');

afterAll(() => {
  process.env = before;
});

const box = new SettingsSecretBox([KEK]);
const rows = (entries: Record<string, string>) => async () => new Map(Object.entries(entries));

describe('releitura das chaves na demo', () => {
  it('a chave do painel vale por cima do .env; sem a linha, volta ao .env', async () => {
    const applied = await refreshPanelSecrets(
      rows({
        STRIPE_SECRET_KEY_SEALED: box.seal('STRIPE_SECRET_KEY', PANEL_STRIPE),
        SMTP_PASSWORD_SEALED: box.seal('SMTP_PASSWORD', 'senha do smtp'),
        // chave de outro serviço: não entra na demo
        APISPORTS_KEY_SEALED: box.seal('APISPORTS_KEY', 'a'.repeat(32)),
      }),
    );
    expect(applied.sort()).toEqual(['SMTP_PASSWORD', 'STRIPE_SECRET_KEY']);
    expect(process.env.STRIPE_SECRET_KEY).toBe(PANEL_STRIPE);
    expect(process.env.SMTP_PASSWORD).toBe('senha do smtp');
    expect(process.env.APISPORTS_KEY).not.toBe('a'.repeat(32));
    // o relato ao painel continua sendo o do contêiner
    expect(containerEnv().STRIPE_SECRET_KEY).toBe(ENV_STRIPE);
    expect(containerEnv().SMTP_PASSWORD).toBeUndefined();

    await refreshPanelSecrets(rows({}));
    expect(process.env.STRIPE_SECRET_KEY).toBe(ENV_STRIPE);
    expect(process.env.SMTP_PASSWORD).toBeUndefined();
  });

  it('cifrado com outra KEK: fica o .env', async () => {
    const other = new SettingsSecretBox(['o'.repeat(40)]).seal('STRIPE_SECRET_KEY', PANEL_STRIPE);
    expect(await refreshPanelSecrets(rows({ STRIPE_SECRET_KEY_SEALED: other }))).toEqual([]);
    expect(process.env.STRIPE_SECRET_KEY).toBe(ENV_STRIPE);
  });
});

describe('duas cópias do módulo no mesmo processo (instrumentation.ts e App Router)', () => {
  it('a cópia que sobe depois de uma releitura ainda relata o .env do contêiner', async () => {
    await refreshPanelSecrets(
      rows({ STRIPE_SECRET_KEY_SEALED: box.seal('STRIPE_SECRET_KEY', PANEL_STRIPE) }),
    );
    expect(process.env.STRIPE_SECRET_KEY).toBe(PANEL_STRIPE);
    vi.resetModules();
    const second = await import('./panel-secrets');
    expect(second.containerEnv().STRIPE_SECRET_KEY).toBe(ENV_STRIPE);
    // "Voltar ao .env" pela segunda cópia volta mesmo ao .env, não à chave do painel
    await second.refreshPanelSecrets(rows({}));
    expect(process.env.STRIPE_SECRET_KEY).toBe(ENV_STRIPE);
  });

  it('releituras não se cruzam: a pedida durante outra lê de novo e vence', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reads: string[] = [];
    // leitura antiga (lenta) com a chave do painel; a nova, depois de "Voltar ao .env", sem linha
    const slow = refreshPanelSecrets(async () => {
      reads.push('antiga');
      await gate;
      return new Map([['STRIPE_SECRET_KEY_SEALED', box.seal('STRIPE_SECRET_KEY', PANEL_STRIPE)]]);
    });
    const fresh = refreshPanelSecrets(async () => {
      reads.push('nova');
      return new Map();
    });
    expect(reads).toEqual(['antiga']);
    release();
    await Promise.all([slow, fresh]);
    expect(reads).toEqual(['antiga', 'nova']);
    expect(process.env.STRIPE_SECRET_KEY).toBe(ENV_STRIPE);
  });
});

describe('situação da chave para a tela', () => {
  const row = (value: string) =>
    new Map([
      ['APISPORTS_KEY_SEALED', { value, updated_by: 'ana', updated_at: new Date('2026-11-11T12:00:00Z') }],
    ]);
  const def = settingDef('APISPORTS_KEY')!;
  const KEY = 'a1b2c3d4'.repeat(4);

  it('do painel: só os 4 últimos e quem trocou; nunca o valor nem o cifrado', () => {
    const sealed = box.seal('APISPORTS_KEY', KEY);
    const state = panelSecretState(def, row(sealed), box, (svc) => svc !== 'live');
    expect(state).toMatchObject({
      editable: true,
      inPanel: true,
      unreadable: false,
      hint: 'c3d4',
      kekMissing: ['live'],
      canSave: true,
      testable: true,
      changedBy: 'ana',
    });
    expect(JSON.stringify(state)).not.toContain(KEY);
    expect(JSON.stringify(state)).not.toContain(sealed);
  });

  it('não abre (KEK trocada ou ausente): marca e não dá dica', () => {
    const sealed = new SettingsSecretBox(['o'.repeat(40)]).seal('APISPORTS_KEY', KEY);
    expect(panelSecretState(def, row(sealed), box, () => true)).toMatchObject({
      inPanel: true,
      unreadable: true,
      hint: null,
    });
    expect(panelSecretState(def, row(sealed), null, () => true)).toMatchObject({
      unreadable: true,
      canSave: false,
    });
  });

  it('serviço com outra KEK ou KEK curta: avisa que não abre lá', () => {
    const sealed = box.seal('APISPORTS_KEY', KEY);
    const [kid] = box.kids;
    const other = new SettingsSecretBox(['o'.repeat(40)]).kids;
    const state = panelSecretState(
      def,
      row(sealed),
      box,
      () => true,
      (svc) => (svc === 'live' ? { kids: other, invalid: false } : { kids: [kid!], invalid: false }),
    );
    expect(state.kekMismatch).toEqual(['live']);
    expect(
      panelSecretState(
        def,
        row(sealed),
        box,
        () => true,
        () => ({ kids: [kid!], invalid: true }),
      ).kekMismatch,
    ).toEqual(['ingestor', 'live']);
    // serviço que não relata os ids: sem aviso
    expect(panelSecretState(def, row(sealed), box, () => true).kekMismatch).toEqual([]);
  });

  it('senha do SMTP: nunca mostra o final', () => {
    const pass = 'senha-longa-de-gente-' + 'x1y2';
    const sealed = box.seal('SMTP_PASSWORD', pass);
    const state = panelSecretState(
      settingDef('SMTP_PASSWORD')!,
      new Map([['SMTP_PASSWORD_SEALED', { value: sealed, updated_by: 'ana', updated_at: new Date() }]]),
      box,
      () => true,
    );
    expect(state.hint).toBeNull();
    expect(state.inPanel).toBe(true);
  });

  it('segredo só do .env: sem Trocar, sem teste', () => {
    expect(panelSecretState(settingDef('SETTINGS_KEK')!, new Map(), box, () => true)).toMatchObject({
      editable: false,
      inPanel: false,
      canSave: false,
      testable: false,
      kekMissing: [],
    });
  });
});
