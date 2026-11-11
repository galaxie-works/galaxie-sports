/**
 * Chaves trocadas no painel (#1087) dentro da própria demo (só no servidor). Os serviços recebem as chaves pelo
 * `applyOverrides` do scheduler; a demo não tem scheduler, então relê as linhas `<CHAVE>_SEALED` a cada minuto (e logo
 * depois de gravar) e põe o valor aberto no env do processo, por cima do .env. Quem lê `process.env` na hora de usar
 * (Stripe, S3, SMTP, token das sugestões) pega a chave nova sem reiniciar. `site` e `console` são processos separados:
 * cada um relê a sua.
 *
 * O env do contêiner (o .env) é guardado na subida do módulo, antes de qualquer troca: é para ele que o "Voltar ao .env"
 * volta e é ele que o painel relata como "configurada no .env".
 */
import { SETTINGS, applyOverrides, isPanelSecret } from '@galaxie/runtime-config';
import { settingsSecretBox, type SettingsSecretBox } from '@galaxie/runtime-config/sealed';

import { pool } from '@/lib/auth/db';

/** Segredos do painel que a demo lê. */
const DEMO_SECRETS = SETTINGS.filter((d) => isPanelSecret(d) && d.services.includes('demo')).map(
  (d) => d.key,
);

/** O .env do contêiner para as chaves da demo, antes de qualquer troca pelo painel. */
const CONTAINER: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  DEMO_SECRETS.map((key) => [key, process.env[key]]),
);

/** O env do contêiner (sem as chaves do painel): o que a demo relata ao painel como "no .env". */
export function containerEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env };
  for (const key of DEMO_SECRETS) {
    if (CONTAINER[key] === undefined) delete out[key];
    else out[key] = CONTAINER[key];
  }
  return out;
}

/** O cofre deste processo (`SETTINGS_KEK`); `null` sem KEK válida: nada é gravado nem aberto. */
export function settingsSecrets(): SettingsSecretBox | null {
  const box = settingsSecretBox(process.env);
  return box.configured ? box : null;
}

/** Linhas cifradas do banco (sem a tabela, nenhuma). */
export async function readSealedRows(): Promise<Map<string, string>> {
  try {
    const { rows } = await pool.query<{ key: string; value: string }>(
      `select key, value from ops.runtime_setting where key like '%\\_SEALED'`,
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return new Map();
    throw err;
  }
}

/**
 * Põe no env do processo as chaves da demo trocadas no painel; sem linha (ou se não abrir), volta ao .env. Devolve só
 * os nomes das chaves aplicadas. Leitura que falha mantém o que estava.
 */
export async function refreshPanelSecrets(
  read: () => Promise<ReadonlyMap<string, string>> = readSealedRows,
): Promise<string[]> {
  const rows = await read();
  const base = containerEnv();
  const out = applyOverrides(base, rows, { secrets: settingsSecrets(), services: ['demo'] });
  for (const key of DEMO_SECRETS) {
    const value = out.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return out.secrets;
}

let timer: NodeJS.Timeout | undefined;

/** Releitura a cada minuto (na subida do servidor, instrumentation.ts). */
export function startPanelSecretsSync(everyMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    refreshPanelSecrets().catch((err: unknown) =>
      // só o nome do erro: a mensagem do banco não leva segredo, mas não precisa ir para o log
      console.warn(
        '[ajustes] não deu para reler as chaves do painel',
        err instanceof Error ? err.name : 'erro',
      ),
    );
  }, everyMs);
  timer.unref();
}
