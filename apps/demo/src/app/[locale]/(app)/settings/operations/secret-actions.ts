'use server';

/**
 * Chaves de API trocadas no painel (#1087): gravar (cifrada), voltar ao .env, testar antes de salvar e recifrar com a
 * KEK atual. Cada ação revalida a sessão de admin no servidor e a chave pelo registro (só os segredos marcados como do
 * painel; os do .env, como a própria SETTINGS_KEK, são recusados). O valor:
 * - é conferido pelo formato do provedor antes de cifrar;
 * - nunca é devolvido, nem cifrado, nem vai para log ou mensagem de erro (só o nome do erro);
 * - no histórico vira a máscara: fica registrado quem trocou e quando.
 *
 * TODO(#1019): quando os cargos da equipe Galaxie chegarem à main, trocar chave de produção só com `staff` (não
 * `support`). Até lá, a mesma regra de Ajustes: `requireAdmin`.
 */
import {
  isPanelSecret,
  sealedBaseKey,
  sealedKey,
  settingApply,
  settingDef,
  validateSecretValue,
  type RuntimeService,
} from '@galaxie/runtime-config';
import { parseSettingsKekStatus } from '@galaxie/runtime-config/sealed';

import { requireAdmin } from '@/lib/auth/admin';
import { pool } from '@/lib/auth/db';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { readSealedRows, refreshPanelSecrets, settingsSecrets } from '@/lib/ops/panel-secrets';
import { revalidateSystem } from '@/lib/ops/revalidate';
import { testSecretValue, type SecretTestResult } from '@/lib/ops/secret-tests';
import { writeAll } from '@/lib/ops/settings-write';
import { validationMessage } from '@/lib/ops/validation-message';

export interface SecretActionResult {
  ok: boolean;
  error?: string;
  /** Gravou, mas há algo a saber (ex.: a chave só vale depois de reiniciar a API). */
  warning?: string;
  /** Resultado do "Testar antes de salvar". */
  test?: SecretTestResult;
}

async function texts() {
  return getDictionary(await getRequestLocale()).ops;
}

/** Só o nome do erro vai para o log: a mensagem de um driver pode citar parâmetros. */
const logFailure = (what: string, err: unknown) =>
  console.error(`[ajustes] ${what}`, err instanceof Error ? err.name : 'erro');

/**
 * Token das sugestões: gravado e testado só pelo cartão do GitHub (`saveFeedbackGithub`), que confere a repo
 * (privada, com acesso) antes de gravar. As ações genéricas daqui pulariam essa conferência.
 */
const FEEDBACK_TOKEN_KEY = 'FEEDBACK_GITHUB_TOKEN';

/**
 * Serviços que leem a chave e em que ela não vai abrir: sem SETTINGS_KEK (`missing`) ou com outra KEK / KEK curta
 * (`mismatch`, comparando com o id da KEK com que a demo acabou de cifrar). Neles vale o .env.
 */
async function kekProblems(
  services: readonly RuntimeService[],
  kid: string | null,
): Promise<{ missing: RuntimeService[]; mismatch: RuntimeService[] }> {
  const { rows } = await pool.query<{ service: RuntimeService; configured: boolean; value: string | null }>(
    `select service, configured, value from ops.runtime_env where key = 'SETTINGS_KEK' and service = any($1)`,
    [services],
  );
  const mismatch = rows.filter((r) => {
    if (!r.configured || kid === null || r.service === 'demo') return false;
    const status = parseSettingsKekStatus(r.value);
    return status !== null && (status.invalid || !status.kids.includes(kid));
  });
  return {
    missing: rows.filter((r) => !r.configured).map((r) => r.service),
    mismatch: mismatch.map((r) => r.service),
  };
}

async function afterWrite(key: string, kid: string | null = null): Promise<string | undefined> {
  const t = await texts();
  const def = settingDef(key)!;
  revalidateSystem();
  // a demo relê na hora (as outras chaves chegam aos serviços na próxima execução)
  if (def.services.includes('demo'))
    await refreshPanelSecrets().catch((err: unknown) => logFailure('releitura das chaves falhou', err));
  const names = (list: readonly RuntimeService[]) => list.map((x) => t.services[x]).join(', ');
  const { missing, mismatch } = await kekProblems(def.services, kid).catch(() => ({
    missing: [] as RuntimeService[],
    mismatch: [] as RuntimeService[],
  }));
  if (missing.length) return fill(t.secretKeys.kekMissingIn, { services: names(missing) });
  if (mismatch.length) return fill(t.secretKeys.kekMismatchIn, { services: names(mismatch) });
  const restart = def.services.filter((svc) => settingApply(def, svc) === 'restart');
  if (restart.length) return fill(t.secretKeys.restartNeeded, { services: names(restart) });
  return undefined;
}

export async function saveSecret(key: string, raw: string): Promise<SecretActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const T = t.secretKeys;
  if (typeof key !== 'string' || typeof raw !== 'string') return { ok: false, error: t.errors.unknown };
  const def = settingDef(key);
  if (!isPanelSecret(def)) return { ok: false, error: T.serverOnly };
  if (key === FEEDBACK_TOKEN_KEY) return { ok: false, error: T.feedbackCardOnly };
  const checked = validateSecretValue(def, raw);
  if (!checked.ok) return { ok: false, error: validationMessage(t, checked.error) };
  const box = settingsSecrets();
  // sem a KEK a chave ficaria em texto puro no banco: não grava
  if (!box) return { ok: false, error: T.noKek };
  try {
    await writeAll(
      [{ key: sealedKey(key), value: box.seal(key, checked.value), valueType: 'secret', secret: true }],
      me.email,
    );
  } catch (err) {
    logFailure('falha ao gravar a chave', err);
    return { ok: false, error: T.saveFailed };
  }
  const warning = await afterWrite(key, box.kids[0] ?? null);
  return warning ? { ok: true, warning } : { ok: true };
}

/** "Voltar ao .env": apaga a chave do painel; os serviços voltam à do .env na próxima releitura. */
export async function resetSecret(key: string): Promise<SecretActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const def = typeof key === 'string' ? settingDef(key) : undefined;
  if (!isPanelSecret(def)) return { ok: false, error: t.secretKeys.serverOnly };
  try {
    await writeAll([{ key: sealedKey(key), value: null, valueType: 'secret', secret: true }], me.email);
  } catch (err) {
    logFailure('falha ao apagar a chave', err);
    return { ok: false, error: t.secretKeys.saveFailed };
  }
  const warning = await afterWrite(key);
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * "Testar antes de salvar": uma chamada barata ao provedor com a chave candidata (nada é gravado). Sem candidata,
 * não testa: a chave em uso não sai do servidor nem é reaproveitada aqui.
 */
export async function testSecret(key: string, raw: string): Promise<SecretActionResult> {
  await requireAdmin();
  const t = await texts();
  const T = t.secretKeys;
  if (typeof key !== 'string' || typeof raw !== 'string') return { ok: false, error: t.errors.unknown };
  const def = settingDef(key);
  if (!isPanelSecret(def)) return { ok: false, error: T.serverOnly };
  if (key === FEEDBACK_TOKEN_KEY) return { ok: false, error: T.feedbackCardOnly };
  const checked = validateSecretValue(def, raw);
  if (!checked.ok) return { ok: false, error: validationMessage(t, checked.error) };
  const result = await testSecretValue(key, checked.value);
  if (result === null) return { ok: false, error: T.noTest };
  if (result === 'ok') return { ok: true, test: result };
  return { ok: false, test: result, error: result === 'rejected' ? T.testRejected : T.testUnreachable };
}

/**
 * Recifra com a KEK atual as chaves gravadas com uma KEK antiga (rotação da SETTINGS_KEK) ou no formato antigo (token
 * das sugestões). As que não abrem ficam como estão. Devolve quantas foram recifradas, em `warning`.
 */
export async function resealSecrets(): Promise<SecretActionResult> {
  const me = await requireAdmin();
  const T = (await texts()).secretKeys;
  const box = settingsSecrets();
  if (!box) return { ok: false, error: T.noKek };
  try {
    const rows = await readSealedRows();
    const writes = [];
    for (const [rowKey, stored] of rows) {
      const key = sealedBaseKey(rowKey);
      if (!key || !isPanelSecret(settingDef(key)) || !box.needsReseal(key, stored)) continue;
      const value = box.open(key, stored);
      if (value === null) continue;
      writes.push({ key: rowKey, value: box.seal(key, value), valueType: 'secret', secret: true });
    }
    if (writes.length) await writeAll(writes, me.email);
    revalidateSystem();
    return { ok: true, warning: fill(T.resealed, { n: String(writes.length) }) };
  } catch (err) {
    logFailure('falha ao recifrar as chaves', err);
    return { ok: false, error: T.saveFailed };
  }
}
