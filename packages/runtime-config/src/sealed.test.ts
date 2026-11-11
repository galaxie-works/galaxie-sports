/**
 * Segredos trocados no painel (#1087): o cofre (SETTINGS_KEK) e a aplicação no env dos serviços, com a queda para o
 * .env quando a KEK falta ou não abre. Nenhum valor pode aparecer no que vai para log (`applied`, `rejected`) nem em
 * `GALAXIE_RUNTIME_BASE`.
 */
import { describe, expect, it } from 'vitest';

import {
  applyOverrides,
  RUNTIME_BASE_ENV,
  RUNTIME_SECRET_BASE_ENV,
  runtimeBaseEnv,
  validateSecretValue,
} from './resolve.js';
import { SETTINGS, isPanelSecret, settingDef } from './registry.js';
import { SettingsSecretBox, secretHint, settingsSecretBox } from './sealed.js';

const KEK = 'k'.repeat(40);
const OTHER_KEK = 'o'.repeat(40);
const box = new SettingsSecretBox([KEK]);
const API_KEY = 'a1b2c3d4'.repeat(4);
const OPENAI = 'sk-proj-novaChaveDoPainel1234567890';

describe('cofre dos segredos do painel', () => {
  it('cifra e abre, preso à chave (AAD)', () => {
    const sealed = box.seal('APISPORTS_KEY', API_KEY);
    expect(sealed).toMatch(/^enc:s1:[0-9a-f]{8}:/);
    expect(sealed).not.toContain(API_KEY);
    expect(box.open('APISPORTS_KEY', sealed)).toBe(API_KEY);
    // copiado para outra chave não abre
    expect(box.open('OPENAI_API_KEY', sealed)).toBeNull();
    // cada gravação tem IV próprio
    expect(box.seal('APISPORTS_KEY', API_KEY)).not.toBe(sealed);
  });

  it('KEK trocada, ausente, curta ou dado alterado: não abre (e não lança)', () => {
    const sealed = box.seal('APISPORTS_KEY', API_KEY);
    expect(new SettingsSecretBox([OTHER_KEK]).open('APISPORTS_KEY', sealed)).toBeNull();
    expect(new SettingsSecretBox([]).open('APISPORTS_KEY', sealed)).toBeNull();
    const short = new SettingsSecretBox(['curta']);
    expect(short.configured).toBe(false);
    expect(short.invalid).toBe(true);
    const parts = sealed.split(':');
    parts[4] = Buffer.from('outro').toString('base64url');
    expect(box.open('APISPORTS_KEY', parts.join(':'))).toBeNull();
    // texto puro nunca vale como segredo do painel
    expect(box.open('APISPORTS_KEY', API_KEY)).toBeNull();
    expect(() => new SettingsSecretBox([]).seal('APISPORTS_KEY', API_KEY)).toThrow(/SETTINGS_KEK/);
  });

  it('rotação: nova,antiga abre as duas; recifrar só o que não está na atual', () => {
    const old = new SettingsSecretBox([OTHER_KEK]).seal('APISPORTS_KEY', API_KEY);
    const both = new SettingsSecretBox([KEK, OTHER_KEK]);
    expect(both.open('APISPORTS_KEY', old)).toBe(API_KEY);
    expect(both.needsReseal('APISPORTS_KEY', old)).toBe(true);
    const fresh = both.seal('APISPORTS_KEY', API_KEY);
    expect(both.needsReseal('APISPORTS_KEY', fresh)).toBe(false);
    expect(box.open('APISPORTS_KEY', fresh)).toBe(API_KEY);
  });

  it('estado para a tela', () => {
    const sealed = box.seal('APISPORTS_KEY', API_KEY);
    expect(box.state('APISPORTS_KEY', sealed)).toBe('ok');
    expect(new SettingsSecretBox([OTHER_KEK]).state('APISPORTS_KEY', sealed)).toBe('unreadable');
    expect(new SettingsSecretBox([]).state('APISPORTS_KEY', sealed)).toBe('no-kek');
  });

  it('lê a KEK do env (várias por vírgula) e guarda o cofre enquanto ela não muda', () => {
    const a = settingsSecretBox({ SETTINGS_KEK: ` ${KEK} , ${OTHER_KEK} ` });
    expect(a.configured).toBe(true);
    expect(settingsSecretBox({ SETTINGS_KEK: ` ${KEK} , ${OTHER_KEK} ` })).toBe(a);
    expect(settingsSecretBox({}).configured).toBe(false);
  });

  it('dica: só os 4 últimos de um valor longo', () => {
    expect(secretHint(API_KEY)).toBe('c3d4');
    expect(secretHint('curta')).toBeNull();
  });
});

describe('formato por provedor', () => {
  const v = (key: string, raw: string) => validateSecretValue(settingDef(key), raw);
  it('aceita o formato do provedor e normaliza espaços nas pontas', () => {
    expect(v('OPENAI_API_KEY', `  ${OPENAI}\n`)).toEqual({ ok: true, value: OPENAI });
    expect(v('ANTHROPIC_API_KEY', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz').ok).toBe(true);
    expect(v('GEMINI_API_KEY', `AIza${'x'.repeat(35)}`).ok).toBe(true);
    expect(v('YOUTUBE_API_KEY', `AIza${'y'.repeat(35)}`).ok).toBe(true);
    expect(v('STRIPE_SECRET_KEY', 'sk_' + 'test_51abcdefghijklmno').ok).toBe(true);
    expect(v('STRIPE_WEBHOOK_SECRET', 'whsec_abcdefghijklmnop').ok).toBe(true);
    expect(v('APISPORTS_KEY', API_KEY).ok).toBe(true);
  });

  it('recusa o formato errado sem devolver o valor', () => {
    const bad = v('OPENAI_API_KEY', 'AIzaErradaParaOpenAI1234567890');
    expect(bad).toEqual({ ok: false, error: { code: 'format' } });
    expect(v('ANTHROPIC_API_KEY', OPENAI)).toEqual({ ok: false, error: { code: 'format' } });
    expect(v('APISPORTS_KEY', 'com espaço no meio 1234567890')).toEqual({
      ok: false,
      error: { code: 'format' },
    });
    expect(v('APISPORTS_KEY', '  ')).toEqual({ ok: false, error: { code: 'required' } });
  });

  it('segredos só do .env não são trocados no painel', () => {
    for (const key of [
      'SETTINGS_KEK',
      'BETTER_AUTH_SECRET',
      'ADMIN_KEY_HASHES',
      'GALAXIE_DEMO_KEY',
      'WEBHOOK_SIGNING_SECRET',
      'METRICS_TOKEN',
    ])
      expect(v(key, 'x'.repeat(40))).toEqual({ ok: false, error: { code: 'readonly' } });
    expect(v('NAO_EXISTE', 'x')).toEqual({ ok: false, error: { code: 'unknown' } });
    // todo segredo do painel tem formato
    for (const def of SETTINGS.filter(isPanelSecret)) expect(def.pattern, def.key).toBeInstanceOf(RegExp);
  });
});

describe('segredos do painel no env dos serviços', () => {
  const container = { APISPORTS_KEY: 'chave-do-env', OPENAI_API_KEY: 'sk-do-env', SETTINGS_KEK: KEK };
  const sealedRows = () => ({
    APISPORTS_KEY_SEALED: box.seal('APISPORTS_KEY', API_KEY),
    OPENAI_API_KEY_SEALED: box.seal('OPENAI_API_KEY', OPENAI),
  });

  it('abre com a KEK do processo e põe por cima do .env, só para os serviços que leem a chave', () => {
    const out = applyOverrides(
      container,
      { ...sealedRows(), LIVE_FEATURED: 'on' },
      {
        secrets: box,
        services: ['ingestor', 'live'],
      },
    );
    expect(out.env.APISPORTS_KEY).toBe(API_KEY);
    // OPENAI_API_KEY é dos agentes: fica o do .env no ingestor
    expect(out.env.OPENAI_API_KEY).toBe('sk-do-env');
    expect(out.secrets).toEqual(['APISPORTS_KEY']);
    expect(out.applied).toEqual(['LIVE_FEATURED']);
    expect(out.rejected).toEqual([]);
    // a linha cifrada não vira variável
    expect(out.env.APISPORTS_KEY_SEALED).toBeUndefined();
    // nenhum valor no que vai para log nem na base das flags
    const logged = JSON.stringify({ applied: out.applied, secrets: out.secrets, rejected: out.rejected });
    expect(logged).not.toContain(API_KEY);
    expect(out.env[RUNTIME_BASE_ENV]).not.toContain('chave-do-env');
    expect(out.env[RUNTIME_BASE_ENV]).not.toContain(API_KEY);

    const agents = applyOverrides(container, sealedRows(), { secrets: box, services: ['agents'] });
    expect(agents.env.OPENAI_API_KEY).toBe(OPENAI);
    expect(agents.env.APISPORTS_KEY).toBe('chave-do-env');
  });

  it('KEK ausente: fica o .env e a linha vai para rejected como sealed', () => {
    for (const secrets of [null, new SettingsSecretBox([])]) {
      const out = applyOverrides(container, sealedRows(), { secrets, services: ['ingestor'] });
      expect(out.env.APISPORTS_KEY).toBe('chave-do-env');
      expect(out.secrets).toEqual([]);
      expect(out.rejected).toEqual([{ key: 'APISPORTS_KEY_SEALED', error: { code: 'sealed' } }]);
    }
    // sem opções (chamada antiga): nada de segredo
    const legacy = applyOverrides(container, sealedRows());
    expect(legacy.env.APISPORTS_KEY).toBe('chave-do-env');
    expect(legacy.env.OPENAI_API_KEY).toBe('sk-do-env');
  });

  it('KEK trocada: fica o .env', () => {
    const out = applyOverrides(container, sealedRows(), {
      secrets: new SettingsSecretBox([OTHER_KEK]),
      services: ['ingestor'],
    });
    expect(out.env.APISPORTS_KEY).toBe('chave-do-env');
    expect(out.rejected.map((r) => r.error.code)).toEqual(['sealed']);
  });

  it('valor aberto fora do formato não entra (ex.: quebra de linha para injetar variável)', () => {
    const out = applyOverrides(
      container,
      { APISPORTS_KEY_SEALED: box.seal('APISPORTS_KEY', 'abc\nNODE_OPTIONS=x') },
      {
        secrets: box,
        services: ['ingestor'],
      },
    );
    expect(out.env.APISPORTS_KEY).toBe('chave-do-env');
    expect(out.rejected).toEqual([{ key: 'APISPORTS_KEY_SEALED', error: { code: 'format' } }]);
  });

  it('linha cifrada de segredo só do .env ou fora do registro é recusada', () => {
    const out = applyOverrides(
      {},
      {
        BETTER_AUTH_SECRET_SEALED: box.seal('BETTER_AUTH_SECRET', 'x'.repeat(40)),
        NODE_OPTIONS_SEALED: box.seal('NODE_OPTIONS', '--require x'),
      },
      { secrets: box, services: ['demo', 'api', 'ingestor', 'agents', 'live'] },
    );
    expect(out.env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(out.env.NODE_OPTIONS).toBeUndefined();
    expect(out.rejected.map((r) => r.error.code)).toEqual(['unknown', 'unknown']);
  });

  it('processo longo: "Voltar ao .env" no meio da execução volta ao valor do contêiner', () => {
    const child = applyOverrides(container, sealedRows(), { secrets: box, services: ['live'] }).env;
    expect(child.APISPORTS_KEY).toBe(API_KEY);
    expect(JSON.parse(child[RUNTIME_SECRET_BASE_ENV]!)).toEqual({ APISPORTS_KEY: 'chave-do-env' });
    const base = runtimeBaseEnv(child);
    expect(base.APISPORTS_KEY).toBe('chave-do-env');
    expect(base[RUNTIME_SECRET_BASE_ENV]).toBeUndefined();
    // a releitura sem a linha (voltou ao .env)
    expect(applyOverrides(base, {}, { secrets: box, services: ['live'] }).env.APISPORTS_KEY).toBe(
      'chave-do-env',
    );
    // a releitura com a linha nova
    const swapped = box.seal('APISPORTS_KEY', 'f'.repeat(32));
    expect(
      applyOverrides(base, { APISPORTS_KEY_SEALED: swapped }, { secrets: box, services: ['live'] }).env
        .APISPORTS_KEY,
    ).toBe('f'.repeat(32));
    // a base dos segredos só aceita segredos do painel
    expect(
      runtimeBaseEnv({
        [RUNTIME_SECRET_BASE_ENV]: JSON.stringify({ NODE_OPTIONS: 'y', BETTER_AUTH_SECRET: 'z' }),
      }),
    ).toEqual({});
  });
});
