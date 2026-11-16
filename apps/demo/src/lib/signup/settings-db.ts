/**
 * Leitura das chaves do cadastro no banco (só no servidor). Sem cache de propósito, como as sugestões: `site` e
 * `console` são processos separados e ligar o cadastro vale sem reiniciar; são quatro linhas por chave primária.
 */
import { pool } from '@/lib/auth/db';

import { resolveSignupSettings, SIGNUP_SETTING_KEYS, type SignupSettings } from './settings';

export async function readSignupSettings(): Promise<SignupSettings> {
  let overrides = new Map<string, string>();
  try {
    const { rows } = await pool.query<{ key: string; value: string }>(
      'select key, value from ops.runtime_setting where key = any($1)',
      [SIGNUP_SETTING_KEYS],
    );
    overrides = new Map(rows.map((r) => [r.key, r.value]));
  } catch (err) {
    // tabela ainda não criada (migration pendente): sem ajuste nenhum, vale o env (e o padrão: fechado)
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
  return resolveSignupSettings(overrides, process.env);
}
