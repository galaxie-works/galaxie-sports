/**
 * Preparação do banco da demo na subida do servidor (instrumentation.ts): schema `demo_auth`, tabelas do
 * Better Auth (migração aditiva, idempotente), tabelas próprias (convites e atividade) e o primeiro admin.
 */
import { getMigrations } from 'better-auth/db/migration';

import { AUTH_SCHEMA, hasDatabase, pool } from './db';
import { ROLE_LABEL } from './server';

const OWN_TABLES = `
create table if not exists invite (
  id bigserial primary key,
  user_id text not null,
  kind text not null,
  delivered boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists invite_user_idx on invite (user_id, created_at desc);

create table if not exists activity (
  id bigserial primary key,
  user_id text not null,
  kind text not null,
  path text,
  title text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists activity_user_idx on activity (user_id, created_at desc);
-- Trilha de navegação (aditivo: linhas antigas ficam nulas): de onde veio e a profundidade na trilha.
alter table activity add column if not exists from_path text, add column if not exists trail_depth integer;
`;

export async function setupAuthDatabase(): Promise<void> {
  if (!hasDatabase) {
    console.warn('[demo-auth] DEMO_DATABASE_URL não definido: login desativado até configurar o banco.');
    return;
  }
  await pool.query(`create schema if not exists ${AUTH_SCHEMA}`);
  const { auth } = await import('./server');
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  await pool.query(OWN_TABLES);
  await ensureFirstAdmin();
}

/**
 * Sem nenhum admin: cria um a partir de DEMO_ADMIN_EMAIL/DEMO_ADMIN_NAME e manda o convite (o admin
 * define a própria senha pelo link; nenhuma senha passa por variável de ambiente).
 */
async function ensureFirstAdmin(): Promise<void> {
  const email = process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from "user" where role = 'admin'`,
  );
  if ((rows[0]?.n ?? 0) > 0) return;

  const { auth } = await import('./server');
  const name = process.env.DEMO_ADMIN_NAME?.trim() || 'Administrador';
  const existing = await pool.query<{ id: string }>('select id from "user" where email = $1', [email]);
  if (existing.rows[0]) {
    await pool.query(`update "user" set role = 'admin' where id = $1`, [existing.rows[0].id]);
  } else {
    // Senha aleatória só para criar a conta; o admin define a dele pelo link do convite.
    const placeholder = crypto.randomUUID() + crypto.randomUUID();
    await auth.api.createUser({ body: { email, name, role: 'admin', password: placeholder } });
  }
  await auth.api.requestPasswordReset({ body: { email, redirectTo: '/definir-senha' } });
  console.info(`[demo-auth] primeiro ${ROLE_LABEL.admin} criado para ${email}; convite enviado.`);
}
