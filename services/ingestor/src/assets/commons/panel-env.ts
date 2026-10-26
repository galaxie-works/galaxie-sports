/**
 * Env do processo com as sobrescritas do painel (ops.runtime_setting) por cima, para a ordem das fotos
 * respeitar o AI_STATUS e os tetos gravados no painel. Só o banco sem a tabela (antigo) cai no env do
 * processo; qualquer outra falha de leitura aborta, para um AI_STATUS=off do painel não ser ignorado.
 */
import { readRuntimeOverrides, type Database } from '@galaxie/db';
import { applyOverrides } from '@galaxie/runtime-config';

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
      `Não deu para ler as sobrescritas do painel (ops.runtime_setting): ${err instanceof Error ? err.message : String(err)}. Abortado para não ignorar o estado da IA gravado no painel.`,
      { cause: err },
    );
  }
  return applyOverrides(env, overrides).env;
}
