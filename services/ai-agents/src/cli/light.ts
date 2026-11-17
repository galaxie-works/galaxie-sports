/**
 * O mínimo das CLIs dos agentes para decidir se há trabalho: banco e flags. Sem modelo, ledger nem base semântica, para
 * a execução sem trabalho sair sem carregar o resto (cada import a mais é CPU na subida de cada job). O `common.ts`
 * reexporta tudo daqui.
 */
// o cliente sem o schema inteiro: `@galaxie/db` carrega todas as tabelas (~0,5 s de CPU a mais na subida)
import { createDb, type Database } from '@galaxie/db/client';

/**
 * Conexões do job: 2 bastam (os jobs fazem no máximo duas consultas em paralelo) e cada conexão é um processo do
 * Postgres com autenticação; o pool abre só o que usa.
 */
export const JOB_DB_POOL_MAX = 2;

export function dbFromEnv(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida (veja .env.example).');
  return createDb(url, { max: JOB_DB_POOL_MAX });
}

export function intFlag(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${flag} precisa ser um inteiro ≥ 0 (recebido: ${String(value)}).`);
  return n;
}
