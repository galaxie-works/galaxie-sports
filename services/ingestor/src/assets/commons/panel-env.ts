/**
 * Env do processo com as sobrescritas do painel (ops.runtime_setting) por cima, para a ordem das fotos
 * respeitar o AI_STATUS e os tetos gravados no painel. Só o banco sem a tabela (antigo) cai no env do
 * processo; qualquer outra falha de leitura aborta, para um AI_STATUS=off do painel não ser ignorado.
 */
import { readRuntimeOverrides, type Database } from '@galaxie/db';
import { applyOverrides } from '@galaxie/runtime-config';
import { settingsSecretBox } from '@galaxie/runtime-config/sealed';

/** Postgres `undefined_table` (42P01), direto ou embrulhado pelo driver. */
function missingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === '42P01' || e?.cause?.code === '42P01';
}

export async function panelEnv(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
  read: (db: Database) => Promise<ReadonlyMap<string, string>> = readRuntimeOverrides,
): Promise<NodeJS.ProcessEnv> {
  let overrides: ReadonlyMap<string, string>;
  try {
    overrides = await read(db);
  } catch (err) {
    if (missingTable(err)) return env;
    throw new Error(
      `Não deu para ler as sobrescritas do painel (ops.runtime_setting): ${err instanceof Error ? err.message : String(err)}. Abortado para não ignorar o que foi gravado no painel (estado da IA, espelho).`,
      { cause: err },
    );
  }
  // chaves trocadas no painel (#1087) abertas com a SETTINGS_KEK do contêiner; sem ela, as do .env
  return applyOverrides(env, overrides, { secrets: settingsSecretBox(env), services: ['ingestor'] }).env;
}

/**
 * Tarefa da fila (worker, #542): põe no env do próprio processo as chaves trocadas no painel (#1087), como o scheduler
 * faz para os jobs. Qualquer falha (banco antigo, sem SETTINGS_KEK, cifrado que não abre) deixa as chaves do .env.
 * Devolve só os nomes das chaves aplicadas.
 */
export async function applyPanelSecrets(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
  read: (db: Database) => Promise<ReadonlyMap<string, string>> = readRuntimeOverrides,
): Promise<string[]> {
  let overrides: ReadonlyMap<string, string>;
  try {
    overrides = await read(db);
  } catch {
    return [];
  }
  const sealed = new Map([...overrides].filter(([key]) => key.endsWith('_SEALED')));
  const out = applyOverrides(env, sealed, { secrets: settingsSecretBox(env), services: ['ingestor'] });
  for (const key of out.secrets) env[key] = out.env[key];
  return out.secrets;
}
