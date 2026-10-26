/**
 * Apoio aos testes de integração do login da demo: um Postgres descartável com o schema `demo_auth`
 * preparado como na subida do servidor (setup.ts) e um e-mail falso que guarda o código enviado.
 *
 * O arquivo de teste liga o e-mail falso com
 * `vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule)`.
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { expect, vi } from 'vitest';

/** Último código mandado para cada e-mail. */
export const sentCodes = new Map<string, string>();

export const fakeEmailModule = {
  sendAccessEmail: async ({ to, code }: { to: string; code?: string }) => {
    if (code) sentCodes.set(to, code);
    return { delivered: true };
  },
};

export interface AuthTestDb {
  /** Conexão direta ao banco, já no schema da demo. */
  sql: Client;
  drop(): Promise<void>;
}

/** Cria o banco, aponta o pool da demo para ele (lido ao importar `lib/auth/db`) e roda o setup. */
export async function createAuthTestDb(): Promise<AuthTestDb> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
  const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  process.env.DEMO_DATABASE_URL = url.toString();
  delete process.env.DEMO_ADMIN_EMAIL;
  const { setupAuthDatabase } = await import('../../src/lib/auth/setup');
  await setupAuthDatabase();
  const sql = new Client({ connectionString: url.toString(), options: '-c search_path=demo_auth' });
  await sql.connect();

  return {
    sql,
    async drop() {
      await sql.end();
      const { pool } = await import('../../src/lib/auth/db');
      await pool.end();
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      // O pool resolve o end() antes de as conexões fecharem de fato; derrubá-las no meio do caminho
      // vira erro sem dono no processo do teste. Espera (até ~2 s) elas saírem antes do drop.
      for (let i = 0; i < 40; i++) {
        const { rows } = await c.query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where datname = $1',
          [dbName],
        );
        if (!rows[0]?.n) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await c.query(`drop database if exists ${dbName} with (force)`);
      await c.end();
    },
  };
}

/** O envio do código sai fora da requisição (deliverOtp): espera o e-mail falso receber. */
export async function codeFor(email: string): Promise<string> {
  await vi.waitFor(() => expect(sentCodes.get(email)).toBeDefined());
  return sentCodes.get(email)!;
}

/**
 * Convida (`role`), pede o código e entra como a pessoa de verdade; devolve o cabeçalho `cookie` da
 * sessão, para chamar as rotas como o navegador chamaria.
 */
export async function signInAs(email: string, role: 'admin' | 'user' | 'client' = 'user'): Promise<string> {
  const { auth } = await import('../../src/lib/auth/server');
  await auth.api.createUser({ body: { email, name: email.split('@')[0]!, role } });
  sentCodes.delete(email);
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  const { headers } = await auth.api.signInEmailOTP({
    body: { email, otp: await codeFor(email) },
    returnHeaders: true,
  });
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
