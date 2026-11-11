/**
 * Chaves trocadas no painel (#1087) dentro da própria demo (só no servidor). Os serviços recebem as chaves pelo
 * `applyOverrides` do scheduler; a demo não tem scheduler, então relê as linhas `<CHAVE>_SEALED` a cada minuto (e logo
 * depois de gravar) e põe o valor aberto no env do processo, por cima do .env. Quem lê `process.env` na hora de usar
 * (Stripe, S3, SMTP, token das sugestões) pega a chave nova sem reiniciar. `site` e `console` são processos separados:
 * cada um relê a sua.
 *
 * O env do contêiner (o .env) é guardado na primeira subida do módulo, antes de qualquer troca: é para ele que o "Voltar
 * ao .env" volta e é ele que o painel relata como "configurada no .env". Fica em `globalThis` (como o pool de
 * lib/auth/db.ts): o Next empacota instrumentation.ts à parte do App Router, então este módulo sobe duas vezes no mesmo
 * processo, e a segunda cópia já encontraria no env as chaves que a primeira aplicou. As releituras também ficam
 * enfileiradas no global: a do relógio (numa cópia) e a de depois de gravar (na outra) nunca se cruzam.
 */
import { SETTINGS, applyOverrides, isPanelSecret } from '@galaxie/runtime-config';
import { settingsSecretBox, type SettingsSecretBox } from '@galaxie/runtime-config/sealed';

import { pool } from '@/lib/auth/db';

/** Segredos do painel que a demo lê. */
const DEMO_SECRETS = SETTINGS.filter((d) => isPanelSecret(d) && d.services.includes('demo')).map(
  (d) => d.key,
);

interface PanelSecretsState {
  /** O .env do contêiner para as chaves da demo, antes de qualquer troca pelo painel. */
  container: Readonly<Record<string, string | undefined>>;
  /** Releitura em andamento e a que vem depois dela (uma só, por mais que peçam). */
  running: Promise<string[]> | null;
  queued: Promise<string[]> | null;
  timer: NodeJS.Timeout | undefined;
}

declare global {
  var __galaxiePanelSecrets: PanelSecretsState | undefined;
}

// a primeira cópia do módulo tira a foto do .env; as outras usam a mesma
const state: PanelSecretsState = (globalThis.__galaxiePanelSecrets ??= {
  container: Object.fromEntries(DEMO_SECRETS.map((key) => [key, process.env[key]])),
  running: null,
  queued: null,
  timer: undefined,
});
const CONTAINER = state.container;

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
 *
 * Uma releitura por vez: pedida durante outra, roda de novo (lendo o banco outra vez) quando a primeira acaba, e quem
 * pediu espera essa. Assim uma leitura antiga nunca grava por cima de uma mais nova (ex.: o relógio lendo antes de
 * "Salvar" e terminando depois).
 */
export function refreshPanelSecrets(
  read: () => Promise<ReadonlyMap<string, string>> = readSealedRows,
): Promise<string[]> {
  if (!state.running) {
    state.running = applyPanelSecrets(read).finally(() => {
      state.running = null;
    });
    return state.running;
  }
  state.queued ??= state.running
    .catch(() => undefined)
    .then(() => {
      state.queued = null;
      return refreshPanelSecrets(read);
    });
  return state.queued;
}

async function applyPanelSecrets(read: () => Promise<ReadonlyMap<string, string>>): Promise<string[]> {
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

/** Releitura a cada minuto (na subida do servidor, instrumentation.ts); um relógio por processo. */
export function startPanelSecretsSync(everyMs = 60_000): void {
  if (state.timer) return;
  state.timer = setInterval(() => {
    refreshPanelSecrets().catch((err: unknown) => {
      // só o nome do erro: a mensagem do banco não leva segredo, mas não precisa ir para o log
      const why = err instanceof Error ? err.name : 'erro';
      console.warn('[ajustes] não deu para reler as chaves do painel', why);
    });
  }, everyMs);
  state.timer.unref();
}
