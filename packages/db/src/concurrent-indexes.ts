/**
 * Índice novo em tabela grande sem travar a escrita. O migrator do Drizzle aplica as migrations pendentes numa
 * transação só, e `CREATE INDEX CONCURRENTLY` não roda dentro de transação. A migration que começa com
 * `-- galaxie:concurrently` só pode ter `CREATE [UNIQUE] INDEX IF NOT EXISTS`: o `runMigrations` aplica as
 * anteriores, cria cada índice dela com CONCURRENTLY fora de transação (a escrita na tabela segue) e então o
 * migrator aplica o arquivo, em que o IF NOT EXISTS vira no-op. Num banco vazio (CI, ambiente novo) o próprio
 * arquivo cria os índices, rápido, dentro da transação.
 *
 * Um CONCURRENTLY interrompido deixa o índice inválido: ele é apagado (DROP INDEX CONCURRENTLY) e refeito. Se a
 * construção falha, o migrate para com erro e a migration fica pendente, para não ficar registrada com um
 * índice inválido no lugar.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

export const CONCURRENTLY_MARKER = '-- galaxie:concurrently';

export interface ConcurrentIndex {
  name: string;
  schema: string;
  table: string;
  /** O comando do arquivo (`CREATE INDEX IF NOT EXISTS ...`). */
  statement: string;
}

const CREATE_INDEX =
  /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+"([^"]+)"\s+ON\s+"([^"]+)"\."([^"]+)"/i;

/** Comandos de um arquivo de migration, sem as linhas de comentário. */
function statementsOf(text: string): string[] {
  return text
    .split('--> statement-breakpoint')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
        .replace(/;$/, ''),
    )
    .filter(Boolean);
}

export function isConcurrentMigration(text: string): boolean {
  return text.trimStart().startsWith(CONCURRENTLY_MARKER);
}

/** Índices de uma migration marcada; qualquer outro comando nela é erro (o arquivo é só de índices). */
export function concurrentIndexesOf(text: string): ConcurrentIndex[] {
  return statementsOf(text).map((statement) => {
    const m = CREATE_INDEX.exec(statement);
    if (!m)
      throw new Error(
        `Migration ${CONCURRENTLY_MARKER} só aceita CREATE [UNIQUE] INDEX IF NOT EXISTS "nome" ON "schema"."tabela": ${statement.slice(0, 120)}`,
      );
    return { name: m[2]!, schema: m[3]!, table: m[4]!, statement };
  });
}

/** `CREATE INDEX IF NOT EXISTS` → `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. */
export function toConcurrent(statement: string): string {
  return statement.replace(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i,
    (_m, unique: string | undefined) => `CREATE ${unique ? 'UNIQUE ' : ''}INDEX CONCURRENTLY IF NOT EXISTS`,
  );
}

export function readConcurrentIndexes(file: string): ConcurrentIndex[] | null {
  const text = readFileSync(file, 'utf8');
  return isConcurrentMigration(text) ? concurrentIndexesOf(text) : null;
}

export interface BuildConcurrentOptions {
  /** Teto de cada CREATE INDEX CONCURRENTLY (ms). Padrão 30 min. */
  statementTimeoutMs?: number;
  onIndex?: (index: ConcurrentIndex, outcome: 'created' | 'exists' | 'skipped', ms: number) => void;
}

/**
 * Cria os índices com CONCURRENTLY numa conexão própria, sem transação. Sem lock_timeout: o CONCURRENTLY
 * espera as transações abertas na tabela terminarem, mas não bloqueia a escrita nesse meio tempo.
 * Tabela que ainda não existe fica para o arquivo da migration (`skipped`).
 */
export async function buildConcurrentIndexes(
  url: string,
  indexes: readonly ConcurrentIndex[],
  options: BuildConcurrentOptions = {},
): Promise<void> {
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: {
      application_name: 'galaxie-migrate-concurrently',
      statement_timeout: options.statementTimeoutMs ?? 30 * 60_000,
      lock_timeout: 0,
      idle_in_transaction_session_timeout: 0,
    },
  });
  try {
    for (const index of indexes) {
      const startedAt = Date.now();
      const qualified = `"${index.schema}"."${index.name}"`;
      const [table] = await sql<{ oid: string | null }[]>`
        select to_regclass(${`"${index.schema}"."${index.table}"`})::text as oid`;
      if (!table?.oid) {
        options.onIndex?.(index, 'skipped', 0);
        continue;
      }
      const [found] = await sql<{ valid: boolean }[]>`
        select i.indisvalid as valid
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_index i on i.indexrelid = c.oid
         where n.nspname = ${index.schema} and c.relname = ${index.name}`;
      if (found?.valid) {
        options.onIndex?.(index, 'exists', 0);
        continue;
      }
      // sobra de um CONCURRENTLY interrompido: o IF NOT EXISTS pularia o índice inválido
      if (found) await sql.unsafe(`drop index concurrently if exists ${qualified}`);
      try {
        await sql.unsafe(toConcurrent(index.statement));
      } catch (err) {
        await sql.unsafe(`drop index concurrently if exists ${qualified}`).catch(() => {});
        throw err;
      }
      options.onIndex?.(index, 'created', Date.now() - startedAt);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
