/** Env das CLIs dos agentes: as chaves de IA trocadas no painel (#1087) valem por cima do .env, com a SETTINGS_KEK. */
import type { Database } from '@galaxie/db';
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { describe, expect, it } from 'vitest';

import { runtimeEnv } from './common.js';

const KEK = 'k'.repeat(40);
const OPENAI = 'sk-proj-chaveNovaDoPainel1234567890';
const GEMINI = `AIza${'g'.repeat(35)}`;

/** Banco de mentira: só o `select … from ops.runtime_setting` que `readRuntimeOverrides` faz. */
const dbWith = (rows: { key: string; value: string }[]) =>
  ({ select: () => ({ from: async () => rows }) }) as unknown as Database;

const box = new SettingsSecretBox([KEK]);
const sealedRows = [
  { key: 'OPENAI_API_KEY_SEALED', value: box.seal('OPENAI_API_KEY', OPENAI) },
  { key: 'GEMINI_API_KEY_SEALED', value: box.seal('GEMINI_API_KEY', GEMINI) },
  // segredo de outro serviço: não entra no env dos agentes
  { key: 'APISPORTS_KEY_SEALED', value: box.seal('APISPORTS_KEY', 'a'.repeat(32)) },
];

describe('runtimeEnv com chaves do painel', () => {
  it('abre as chaves dos agentes com a SETTINGS_KEK e deixa as outras', async () => {
    const env = await runtimeEnv(dbWith(sealedRows), {
      OPENAI_API_KEY: 'sk-do-env',
      APISPORTS_KEY: 'do-env',
      SETTINGS_KEK: KEK,
    });
    expect(env.OPENAI_API_KEY).toBe(OPENAI);
    expect(env.GEMINI_API_KEY).toBe(GEMINI);
    expect(env.APISPORTS_KEY).toBe('do-env');
  });

  it('KEK ausente ou trocada: as chaves do .env', async () => {
    for (const kek of [undefined, 'o'.repeat(40)]) {
      const env = await runtimeEnv(dbWith(sealedRows), {
        OPENAI_API_KEY: 'sk-do-env',
        ...(kek ? { SETTINGS_KEK: kek } : {}),
      });
      expect(env.OPENAI_API_KEY).toBe('sk-do-env');
      expect(env.GEMINI_API_KEY).toBeUndefined();
    }
  });
});
