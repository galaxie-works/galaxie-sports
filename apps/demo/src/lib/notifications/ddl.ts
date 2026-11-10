/**
 * Tabelas da caixa de entrada e do andamento das sugestões, no schema `demo_auth` (criadas na subida, junto com as do
 * login: lib/auth/setup.ts). Aditivas e idempotentes.
 *
 * - `notification`: o aviso na caixa de entrada de um usuário. `source` é o id do item do GitHub que gerou o aviso e
 *   impede o mesmo aviso duas vezes (job repetido, dois contêineres no deploy).
 * - `feedback_issue`: issue da repo de sugestões → quem enviou, a última coluna vista e até onde o histórico já foi lido.
 * - `feedback_progress_run`: a última conferência diária (uma linha só), para o painel e para não repetir no mesmo dia.
 */
import { indexIfMissing } from '@/lib/auth/ddl';

export const NOTIFICATION_TABLES = `
create table if not exists notification (
  id bigserial primary key,
  user_id text not null,
  kind text not null,
  source text not null,
  repo text,
  issue_number integer,
  issue_title text,
  status text,
  body text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  answered_at timestamptz
);
${indexIfMissing('notification_source_uidx', 'notification (source)').replace('create index', 'create unique index')}
${indexIfMissing('notification_user_idx', 'notification (user_id, created_at desc)')}

create table if not exists feedback_issue (
  repo text not null,
  issue_number integer not null,
  user_id text,
  status text,
  synced_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (repo, issue_number)
);

create table if not exists feedback_progress_run (
  id integer primary key default 1 check (id = 1),
  started_at timestamptz,
  finished_at timestamptz,
  ok_at timestamptz,
  error text,
  issues integer not null default 0,
  notices integer not null default 0
);
`;
