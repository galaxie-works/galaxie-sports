import type { Database } from '@galaxie/db';
import { describe, expect, it } from 'vitest';
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { applyPanelSecrets, panelEnv } from './panel-env.js';

const db = {} as Database;

describe('env do painel na ordem das fotos', () => {
  it('aplica as sobrescritas do painel (AI_STATUS=off do painel vale)', async () => {
    const env = await panelEnv(db, { AI_STATUS: 'on' }, async () => new Map([['AI_STATUS', 'off']]));
    expect(env.AI_STATUS).toBe('off');
  });

  it('banco sem a tabela (antigo): segue com o env do processo', async () => {
    const missing = Object.assign(new Error('relation "ops.runtime_setting" does not exist'), {
      code: '42P01',
    });
    const wrapped = Object.assign(new Error('Failed query'), { cause: missing });
    for (const err of [missing, wrapped]) {
      const env = await panelEnv(db, { AI_STATUS: 'on' }, async () => {
        throw err;
      });
      expect(env.AI_STATUS).toBe('on');
    }
  });

  it('outra falha de leitura aborta (não ignora o estado da IA do painel)', async () => {
    await expect(
      panelEnv(db, { AI_STATUS: 'on' }, async () => {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      }),
    ).rejects.toThrow(/Abortado/);
  });
});

describe('chaves trocadas no painel (#1087)', () => {
  const KEK = 'k'.repeat(40);
  const KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const rows = async () =>
    new Map([['APISPORTS_KEY_SEALED', new SettingsSecretBox([KEK]).seal('APISPORTS_KEY', KEY)]]);

  it('com a SETTINGS_KEK do processo, a chave do painel vale por cima do .env', async () => {
    const env = await panelEnv(db, { APISPORTS_KEY: 'do-env', SETTINGS_KEK: KEK }, rows);
    expect(env.APISPORTS_KEY).toBe(KEY);
  });

  it('sem a KEK, fica a do .env', async () => {
    expect((await panelEnv(db, { APISPORTS_KEY: 'do-env' }, rows)).APISPORTS_KEY).toBe('do-env');
  });

  it('tarefa do worker: aplica no env do processo e devolve só os nomes', async () => {
    const env: NodeJS.ProcessEnv = { APISPORTS_KEY: 'do-env', SETTINGS_KEK: KEK, AI_STATUS: 'on' };
    const applied = await applyPanelSecrets(
      db,
      env,
      async () => new Map([...(await rows()), ['AI_STATUS', 'off']]),
    );
    expect(applied).toEqual(['APISPORTS_KEY']);
    expect(env.APISPORTS_KEY).toBe(KEY);
    // só os segredos: as flags a tarefa lê do jeito dela
    expect(env.AI_STATUS).toBe('on');
    const failing = { APISPORTS_KEY: 'do-env', SETTINGS_KEK: KEK };
    expect(
      await applyPanelSecrets(db, failing, async () => {
        throw new Error('fora do ar');
      }),
    ).toEqual([]);
    expect(failing.APISPORTS_KEY).toBe('do-env');
  });
});
