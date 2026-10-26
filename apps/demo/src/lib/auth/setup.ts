/**
 * Preparação do banco da demo na subida do servidor (instrumentation.ts): schema `demo_auth`, tabelas do
 * Better Auth (migração aditiva, idempotente), tabelas próprias (convites, atividade, pedidos e tentativas
 * erradas de código) e o primeiro admin.
 */
import { getMigrations } from 'better-auth/db/migration';

import { AUTH_SCHEMA, hasDatabase, pool } from './db';
import { sendInvite } from './invite';
import { OTP_GUARD_TABLES } from './otp-guard';

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

/**
 * Passagem do login por senha para o código por e-mail (idempotente). Quem já definiu senha pelo link
 * do convite provou ser dono do e-mail: marca o e-mail como verificado, senão o primeiro login por código
 * apagaria as contas antigas e derrubaria as sessões abertas (proteção do Better Auth para contas sem
 * e-mail verificado). A coluna password_set_at fica no banco, só não é mais usada.
 */
const OTP_TRANSITION = `
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = current_schema() and table_name = 'user' and column_name = 'password_set_at'
  ) then
    update "user" set "emailVerified" = true where "emailVerified" = false and password_set_at is not null;
  end if;
end $$;
`;

/** Chave da trava do setup (pg_advisory_lock): número fixo, só desta rotina. */
const SETUP_LOCK = 7_301_202_601;

export async function setupAuthDatabase(): Promise<void> {
  if (!hasDatabase) {
    console.warn('[demo-auth] DEMO_DATABASE_URL não definido: login desativado até configurar o banco.');
    return;
  }
  // Duas subidas ao mesmo tempo (troca de contêiner no deploy) não podem criar as mesmas tabelas juntas:
  // `create ... if not exists` concorrente ainda esbarra no catálogo. A trava vale até o fim do setup.
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [SETUP_LOCK]);
    await pool.query(`create schema if not exists ${AUTH_SCHEMA}`);
    const { auth } = await import('./server');
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    await pool.query(OWN_TABLES);
    await pool.query(OTP_GUARD_TABLES);
    await pool.query(OTP_TRANSITION);
    await ensureFirstAdmin();
  } finally {
    await lock.query('select pg_advisory_unlock($1)', [SETUP_LOCK]).catch(() => {});
    lock.release();
  }
}

/**
 * Sem nenhum admin: cria um a partir de DEMO_ADMIN_EMAIL/DEMO_ADMIN_NAME (ou promove a conta que já
 * existe) e manda o convite. Nenhuma senha passa por variável de ambiente: o admin entra com o código
 * enviado ao e-mail.
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
  let userId = existing.rows[0]?.id;
  if (userId) {
    await pool.query(`update "user" set role = 'admin' where id = $1`, [userId]);
  } else {
    const created = await auth.api.createUser({ body: { email, name, role: 'admin' } });
    userId = created.user.id;
  }
  await sendInvite(userId);
  console.info(`[demo-auth] primeiro admin criado para ${email}; convite enviado.`);
}
