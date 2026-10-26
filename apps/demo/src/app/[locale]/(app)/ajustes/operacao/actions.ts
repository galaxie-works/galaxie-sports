'use server';

/**
 * Ações do painel de Operação: gravar uma flag, voltar ao padrão e pedir "rodar agora". Cada uma revalida
 * a sessão de admin no servidor (o proxy é só a primeira barreira) e revalida o valor pelo registro da
 * flag: o navegador nunca decide o que é válido. Gravação e histórico vão na mesma transação.
 */
import {
  AI_CREDIT_CHECK,
  isSecret,
  scheduledJob,
  settingDef,
  validateSetting,
} from '@galaxie/runtime-config';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { pool } from '@/lib/auth/db';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { validationMessage } from '@/lib/ops/validation-message';

export interface OpsActionResult {
  ok: boolean;
  error?: string;
  /** Gravou, mas há algo a saber (ex.: scheduler fora do ar). */
  warning?: string;
}

const PATH = '/ajustes/sistema';
const FEATURES_PATH = '/ajustes/esportes';
/** O mesmo limite do painel: scheduler sem relatar há mais que isto não vai pegar o pedido logo. */
const ALIVE_MS = 3 * 60_000;

async function texts() {
  return getDictionary(await getRequestLocale()).ops;
}

/** Grava (`value`) ou apaga (`null`) a sobrescrita e registra no histórico. */
async function write(key: string, value: string | null, valueType: string, by: string) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const prev = await client.query<{ value: string }>(
      'select value from ops.runtime_setting where key = $1 for update',
      [key],
    );
    const old = prev.rows[0]?.value ?? null;
    if (value === old || (value === null && old === null)) {
      await client.query('rollback');
      return;
    }
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
      [key, value === null ? 'reset' : 'set', old, value, by],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function serviceAlive(service: string): Promise<boolean> {
  const { rows } = await pool.query<{ at: Date | null }>(
    'select max(reported_at) as at from ops.runtime_env where service = $1',
    [service],
  );
  const at = rows[0]?.at;
  return Boolean(at && Date.now() - at.getTime() < ALIVE_MS);
}

export async function saveSetting(key: string, raw: string): Promise<OpsActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const def = settingDef(key);
  if (!def) return { ok: false, error: t.errors.unknown };
  if (isSecret(def)) return { ok: false, error: t.errors.readonly };
  const checked = validateSetting(def, raw);
  if (!checked.ok) return { ok: false, error: validationMessage(t, checked.error) };

  // trocar de provedor sem a chave dele deixaria os agentes só no texto determinístico
  if (key === 'AI_PROVIDER') {
    const keyName = checked.value === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const { rows } = await pool.query<{ configured: boolean }>(
      `select configured from ops.runtime_env where service = 'agents' and key = $1`,
      [keyName],
    );
    if (!rows[0]?.configured) return { ok: false, error: t.errors.providerKeyMissing };
  }

  try {
    await write(key, checked.value, def.type, me.email);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t.errors.unknown };
  }
  revalidatePath(PATH);
  revalidatePath(FEATURES_PATH);
  const alive = await serviceAlive(def.services[0]!).catch(() => false);
  return def.services[0] === 'demo' || def.apply === 'restart' || alive
    ? { ok: true }
    : { ok: true, warning: t.feedback.serviceOffline };
}

/** Chaves da Política de IA (#357): o cartão grava as três juntas, conferidas pelas regras do registro. */
const AI_POLICY_KEYS = ['AI_BAND_SHARES', 'AI_DAILY_USD_BUDGET', 'AI_P0_MIN_AUDIENCE'] as const;

/**
 * Grava a Política de IA (faixas, teto global, corte P0/P1). Confere todas antes de gravar qualquer uma:
 * valor inválido (ex.: faixas que não somam 100) não grava nada. O serviço relê pelas mesmas regras.
 */
export async function saveAiPolicy(
  values: Partial<Record<(typeof AI_POLICY_KEYS)[number], string>>,
): Promise<OpsActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const checked: { key: string; value: string; type: string }[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const def = settingDef(key);
    if (!def || !(AI_POLICY_KEYS as readonly string[]).includes(key) || typeof raw !== 'string')
      return { ok: false, error: t.errors.unknown };
    const v = validateSetting(def, raw);
    if (!v.ok) return { ok: false, error: `${key}: ${validationMessage(t, v.error)}` };
    checked.push({ key, value: v.value, type: def.type });
  }
  if (!checked.length) return { ok: true };
  try {
    for (const c of checked) await write(c.key, c.value, c.type, me.email);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t.errors.unknown };
  }
  revalidatePath(PATH);
  const alive = await serviceAlive('agents').catch(() => false);
  return alive ? { ok: true } : { ok: true, warning: t.feedback.serviceOffline };
}

export async function resetSetting(key: string): Promise<OpsActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const def = settingDef(key);
  if (!def || isSecret(def)) return { ok: false, error: t.errors.unknown };
  try {
    await write(key, null, def.type, me.email);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t.errors.unknown };
  }
  revalidatePath(PATH);
  revalidatePath(FEATURES_PATH);
  return { ok: true };
}

/** Põe o job na fila do scheduler do perfil dele (que relê a fila a cada 30 s). */
async function enqueue(job: string, by: string, service: string): Promise<OpsActionResult> {
  const t = await texts();
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from ops.job_request where job = $1 and status in ('pending', 'running')`,
    [job],
  );
  if ((rows[0]?.n ?? 0) > 0) return { ok: false, error: t.errors.alreadyQueued };
  await pool.query('insert into ops.job_request (job, requested_by) values ($1, $2)', [job, by]);
  revalidatePath(PATH);
  revalidatePath(FEATURES_PATH);
  const alive = await serviceAlive(service).catch(() => false);
  return alive ? { ok: true } : { ok: true, warning: t.feedback.serviceOffline };
}

export async function runJobNow(job: string): Promise<OpsActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const def = scheduledJob(job);
  if (!def?.runNow) return { ok: false, error: t.errors.notRunnable };
  return enqueue(job, me.email, def.service);
}

export async function checkAiCreditNow(): Promise<OpsActionResult> {
  const me = await requireAdmin();
  return enqueue(AI_CREDIT_CHECK, me.email, 'agents');
}
