/**
 * Banco descartável da execução: `galaxie_e2e_<hex>` criado a partir de `DATABASE_URL` (o mesmo servidor, outro banco),
 * com todas as migrations aplicadas, e apagado no fim. Mesmo padrão dos testes de integração
 * (`tests/integration/README.md`, `apps/demo/test/support/auth-db.ts`), com outro prefixo: o banco de desenvolvimento
 * (`galaxie_sports`) e os bancos `galaxie_test_*` da integração não são tocados.
 */
import { randomBytes } from 'node:crypto';

import { runMigrations } from '@galaxie/db';
import postgres from 'postgres';

export interface DisposableDb {
  name: string;
  /** URL do banco descartável (mesmo usuário e senha da `DATABASE_URL`). */
  url: string;
  drop(): Promise<void>;
}

/** URL do mesmo servidor, apontada para outro banco. */
export function withDatabase(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function createDisposableDb(adminUrl: string): Promise<DisposableDb> {
  const name = `galaxie_e2e_${randomBytes(4).toString('hex')}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(adminUrl, name);
  let dropped = false;
  return {
    name,
    url,
    async drop() {
      if (dropped) return;
      dropped = true;
      const c = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        // `with (force)` derruba as conexões que a API e a demo ainda tenham abertas
        await c.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

/** Todas as migrations, como o `pnpm db:migrate`, sem os papéis por serviço: a API e a demo entram com o dono. */
export async function migrate(url: string): Promise<void> {
  await runMigrations(url);
}
