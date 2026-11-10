'use server';

/**
 * Ações do painel de Operação: gravar uma flag, voltar ao padrão e pedir "rodar agora". Cada uma revalida
 * a sessão de admin no servidor (o proxy é só a primeira barreira) e revalida o valor pelo registro da
 * flag: o navegador nunca decide o que é válido. Gravação e histórico vão na mesma transação.
 */
import { revalidateSystem } from '@/lib/ops/revalidate';
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
import { AI_POLICY_KEYS } from '@/components/ops/ai-policy';
import { webhookSecrets } from '@/lib/client/webhooks';
import { checkFeedbackTarget, feedbackGithubConfig, type FeedbackTargetProblem } from '@/lib/feedback/github';
import {
  FEEDBACK_REPO_KEY,
  FEEDBACK_SEALED_TOKEN_KEY,
  isValidFeedbackToken,
  sealFeedbackToken,
} from '@/lib/feedback/settings';
import { readFeedbackSettings } from '@/lib/feedback/settings-db';
import { validationMessage } from '@/lib/ops/validation-message';

export interface OpsActionResult {
  ok: boolean;
  error?: string;
  /** Gravou, mas há algo a saber (ex.: scheduler fora do ar). */
  warning?: string;
}

const FEATURES_PATH = '/ajustes/esportes';
/** O mesmo limite do painel: scheduler sem relatar há mais que isto não vai pegar o pedido logo. */
const ALIVE_MS = 3 * 60_000;

async function texts() {
  return getDictionary(await getRequestLocale()).ops;
}

interface SettingWrite {
  key: string;
  /** `null` apaga a sobrescrita (volta ao env ou ao padrão). */
  value: string | null;
  valueType: string;
  /** Segredo cifrado: o histórico registra a mudança, nunca o valor (nem o cifrado). */
  secret?: boolean;
}

/** O que o histórico mostra no lugar de um segredo. */
const SECRET_LOG_VALUE = '••••••••';

/**
 * Grava (`value`) ou apaga (`null`) as sobrescritas e registra cada mudança no histórico, todas numa
 * transação só: ou todas valem, ou nenhuma (a Política de IA grava três chaves juntas).
 */
async function writeAll(entries: readonly SettingWrite[], by: string) {
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

/** Grava (`value`) ou apaga (`null`) a sobrescrita e registra no histórico. */
const write = (key: string, value: string | null, valueType: string, by: string) =>
  writeAll([{ key, value, valueType }], by);

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
  revalidateSystem();
  revalidatePath(FEATURES_PATH);
  // a flag do ao vivo vale com o serviço `live` no ar ou, com SCHEDULER_LIVE=internal, com o ingestor
  const alive = (await Promise.all(def.services.map((s) => serviceAlive(s).catch(() => false)))).some(
    Boolean,
  );
  return def.services[0] === 'demo' || def.apply === 'restart' || alive
    ? { ok: true }
    : { ok: true, warning: t.feedback.serviceOffline };
}

/** Chaves da Política de IA (#357): o cartão grava as três juntas, conferidas pelas regras do registro. */

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
    await writeAll(
      checked.map((c) => ({ key: c.key, value: c.value, valueType: c.type })),
      me.email,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t.errors.unknown };
  }
  revalidateSystem();
  const alive = await serviceAlive('agents').catch(() => false);
  return alive ? { ok: true } : { ok: true, warning: t.feedback.serviceOffline };
}

/** Volta a Política de IA ao padrão: apaga as sobrescritas das três chaves, numa transação só. */
export async function resetAiPolicy(): Promise<OpsActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  try {
    await writeAll(
      AI_POLICY_KEYS.map((key) => ({ key, value: null, valueType: settingDef(key)!.type })),
      me.email,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t.errors.unknown };
  }
  revalidateSystem();
  return { ok: true };
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
  revalidateSystem();
  revalidatePath(FEATURES_PATH);
  return { ok: true };
}

/**
 * Grava repo e token das sugestões juntos (trocar de repo costuma exigir outro token). Token em branco mantém o atual;
 * repo em branco volta ao do env. Só grava depois que o GitHub confirmar que o par enxerga uma repo privada; sem token
 * nenhum, o repo é só conferido pelo formato, e o envio confere a repo de novo de qualquer forma.
 */
export async function saveFeedbackGithub(input: { repo: string; token: string }): Promise<OpsActionResult> {
  const me = await requireAdmin();
  const T = (await texts()).suggestions.errors;
  if (typeof input?.repo !== 'string' || typeof input?.token !== 'string')
    return { ok: false, error: T.invalid };

  const repoDef = settingDef(FEEDBACK_REPO_KEY)!;
  const checkedRepo = validateSetting(repoDef, input.repo);
  if (!checkedRepo.ok) return { ok: false, error: T.repo };
  const token = input.token.trim();
  if (token && !isValidFeedbackToken(token)) return { ok: false, error: T.tokenFormat };
  const box = webhookSecrets();
  // sem a KEK o token ficaria em texto puro no banco: não grava
  if (token && !box) return { ok: false, error: T.noKek };

  try {
    const current = await readFeedbackSettings();
    const target = feedbackGithubConfig({
      FEEDBACK_GITHUB_TOKEN: token || current.token || undefined,
      FEEDBACK_GITHUB_REPO: checkedRepo.value || process.env.FEEDBACK_GITHUB_REPO,
    });
    // token novo sem repo válida não teria como ser conferido
    if (token && !target) return { ok: false, error: T.repoRequired };
    if (target) {
      const problem = await checkFeedbackTarget(target);
      if (problem) return { ok: false, error: T[PROBLEM_TEXT[problem]] };
    }
    await writeAll(
      [
        { key: FEEDBACK_REPO_KEY, value: checkedRepo.value || null, valueType: repoDef.type },
        ...(token
          ? [
              {
                key: FEEDBACK_SEALED_TOKEN_KEY,
                value: sealFeedbackToken(token, box!),
                valueType: 'secret',
                secret: true,
              },
            ]
          : []),
      ],
      me.email,
    );
  } catch (err) {
    // só o nome: a mensagem de um erro de rede ou do banco não vai para a tela
    console.error('[feedback] falha ao gravar o ajuste', err instanceof Error ? err.name : 'erro');
    return { ok: false, error: T.save };
  }
  revalidateSystem();
  return { ok: true };
}

const PROBLEM_TEXT = {
  not_private: 'notPrivate',
  bad_token: 'badToken',
  no_access: 'noAccess',
  unreachable: 'unreachable',
} as const satisfies Record<FeedbackTargetProblem, string>;

/** Apaga o token do painel: o envio volta a usar o do env, se houver. */
export async function clearFeedbackToken(): Promise<OpsActionResult> {
  const me = await requireAdmin();
  const T = (await texts()).suggestions.errors;
  try {
    await writeAll(
      [{ key: FEEDBACK_SEALED_TOKEN_KEY, value: null, valueType: 'secret', secret: true }],
      me.email,
    );
  } catch (err) {
    console.error('[feedback] falha ao apagar o token', err instanceof Error ? err.name : 'erro');
    return { ok: false, error: T.save };
  }
  revalidateSystem();
  return { ok: true };
}

/**
 * Confere agora o andamento das sugestões (a conferência diária, fora de hora): lê as issues e grava os avisos novos na
 * caixa de entrada de quem enviou. Repetir não duplica aviso.
 */
export async function checkFeedbackProgressNow(): Promise<OpsActionResult> {
  await requireAdmin();
  const T = (await texts()).suggestions.progress;
  const { runFeedbackProgress } = await import('@/lib/feedback/progress-sync');
  const out = await runFeedbackProgress();
  revalidateSystem();
  if (out.status === 'ok') return { ok: true };
  if (out.status === 'busy') return { ok: false, error: T.busy };
  if (out.status === 'off') return { ok: false, error: T.off };
  return { ok: false, error: T.failed };
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
  revalidateSystem();
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
