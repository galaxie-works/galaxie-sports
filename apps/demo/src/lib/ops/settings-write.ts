/**
 * Gravação das sobrescritas do painel (só no servidor): grava ou apaga em `ops.runtime_setting` e registra cada mudança
 * em `ops.runtime_setting_log`, tudo numa transação. Fica fora dos arquivos `'use server'` para não virar ação chamável
 * pelo navegador: quem chama confere a sessão e valida o valor antes.
 */
import { pool } from '@/lib/auth/db';

export interface SettingWrite {
  key: string;
  /** `null` apaga a sobrescrita (volta ao env ou ao padrão). */
  value: string | null;
  valueType: string;
  /** Segredo cifrado: o histórico registra a mudança, nunca o valor (nem o cifrado). */
  secret?: boolean;
}

/** O que o histórico mostra no lugar de um segredo. */
export const SECRET_LOG_VALUE = '••••••••';

/**
 * Grava (`value`) ou apaga (`null`) as sobrescritas e registra cada mudança no histórico, todas numa
 * transação só: ou todas valem, ou nenhuma (a Política de IA grava três chaves juntas).
 */
export async function writeAll(entries: readonly SettingWrite[], by: string) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const { key, value, valueType, secret } of entries) {
      const logged = (v: string | null) => (secret && v !== null ? SECRET_LOG_VALUE : v);
      const prev = await client.query<{ value: string }>(
        'select value from ops.runtime_setting where key = $1 for update',
        [key],
      );
      const old = prev.rows[0]?.value ?? null;
      if (value === old) continue;
      if (value === null) await client.query('delete from ops.runtime_setting where key = $1', [key]);
      else
        await client.query(
          `insert into ops.runtime_setting (key, value, value_type, updated_by, updated_at)
           values ($1, $2, $3, $4, now())
           on conflict (key) do update set value = excluded.value, value_type = excluded.value_type,
             updated_by = excluded.updated_by, updated_at = now()`,
          [key, value, valueType, by],
        );
      await client.query(
        `insert into ops.runtime_setting_log (key, action, old_value, new_value, changed_by)
         values ($1, $2, $3, $4, $5)`,
        [key, value === null ? 'reset' : 'set', logged(old), logged(value), by],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
