/**
 * Leitura da configuração das sugestões no banco (só no servidor). Sem cache de propósito: `site` e `console` são
 * processos separados e o ajuste vale sem reiniciar; são poucas linhas por chave primária.
 */
import { connection } from 'next/server';

import { pool } from '@/lib/auth/db';
import { containerEnv, settingsSecrets } from '@/lib/ops/panel-secrets';

import {
  FEEDBACK_ENABLED_KEY,
  FEEDBACK_SETTING_KEYS,
  feedbackEnabled,
  resolveFeedbackSettings,
  type FeedbackSettings,
} from './settings';

async function readOverrides(keys: readonly string[]): Promise<Map<string, string>> {
  try {
    const { rows } = await pool.query<{ key: string; value: string }>(
      'select key, value from ops.runtime_setting where key = any($1)',
      [keys],
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch (err) {
    // tabela ainda não criada (migration pendente): sem ajuste nenhum, vale o env
    if ((err as { code?: string }).code === '42P01') return new Map();
    throw err;
  }
}

export async function readFeedbackSettings(): Promise<FeedbackSettings> {
  const overrides = await readOverrides(FEEDBACK_SETTING_KEYS);
  // o .env do contêiner: o token do painel já vem da linha cifrada (e não do env que a releitura preenche)
  return resolveFeedbackSettings(overrides, containerEnv(), settingsSecrets());
}

/**
 * O botão aparece? Lido por requisição, fora do shell estático. Em caso de erro esconde: sem o banco o envio também
 * seria recusado.
 */
export async function feedbackButtonEnabled(): Promise<boolean> {
  await connection();
  try {
    return feedbackEnabled(await readOverrides([FEEDBACK_ENABLED_KEY]), process.env);
  } catch (err) {
    console.error('[feedback] não deu para ler o ajuste do botão', err);
    return false;
  }
}
