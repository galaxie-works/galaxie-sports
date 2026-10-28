import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, createDb } from './client.js';

/** Pasta de migrations versionada no pacote (packages/db/drizzle). */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface RunMigrationsOptions {
  /** Tentativas quando a migration desiste de esperar trava (lock_timeout). Padrão 5. */
  attempts?: number;
  /** Espera entre as tentativas (ms). Padrão 10 s. */
  retryDelayMs?: number;
  onRetry?: (attempt: number, err: unknown) => void;
}

/** SQLSTATE 55P03 (lock_not_available): o lock_timeout venceu esperando a trava de outra sessão. */
export function isLockTimeout(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; depth++) {
    if ((e as { code?: unknown }).code === '55P03') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Aplica todas as migrations pendentes. Idempotente: rodar de novo não altera nada.
 *
 * O drizzle aplica as pendentes numa transação só: se uma delas esbarra no lock_timeout (um job segurando a
 * tabela), nada fica aplicado pela metade e dá para tentar de novo logo depois.
 */
export async function runMigrations(url: string, options: RunMigrationsOptions = {}): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 5);
  for (let attempt = 1; ; attempt++) {
    const db = createDb(url, { profile: 'migrate', applicationName: 'galaxie-migrate' });
    try {
      await migrate(db, { migrationsFolder });
      return;
    } catch (err) {
      if (!isLockTimeout(err) || attempt >= attempts) throw err;
      options.onRetry?.(attempt, err);
    } finally {
      await closeDb(db);
    }
    await sleep(options.retryDelayMs ?? 10_000);
  }
}
