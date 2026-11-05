-- Anonimização da cópia da produção antes de ela virar o banco de DEV (infra/ops/mirror-prod-to-dev.sh, #551).
-- Roda só no banco temporário <db>_espelho do Postgres do dev, nunca na produção, numa transação: ou tudo vale ou
-- nada. O script chama com `psql -v suffix='<sufixo das contas de teste>' -f` (padrão @galaxie.test).
--
-- O que sai e o que fica:
--   1. demo_auth: negar por padrão. Toda tabela do schema é esvaziada (sessões, códigos de login, contas, convites,
--      atividade, tentativas erradas, o que o Better Auth criar amanhã), menos "user", que fica anonimizada abaixo, e
--      cache_feed_cursor. As contas de teste do dev (user + account) voltam pelo script, do banco de dev de hoje.
--   2. "user": nome e e-mail fictícios para todo mundo que não é conta de teste; foto e campos do perfil em branco.
--      Papel e tenant ficam (o portal do cliente continua testável).
--   3. Chaves e webhooks: api.api_key, api.webhook_endpoint (cascata nas entregas) e ops.publishable_key somem; as
--      chaves do dev voltam pelo script. Os prefixos e hashes da produção ficam em espelho_tmp até a conferência final.
--   4. O painel manda mais que o ambiente (docs/runbooks/ambiente-de-dev.md): nenhuma sobrescrita de ops.runtime_setting
--      da produção pode ligar job, IA ou YouTube no dev. Pedidos pendentes e tarefas da fila da produção não são
--      executados por um worker do dev; backfills pendentes não viram chamada à api-sports.
--   5. Colunas de autoria com e-mail (admins e clientes no painel) viram usuario@exemplo.invalid.
--
-- packages/db/src/espelho.test.ts confere que toda tabela e coluna citada aqui, fora de demo_auth e espelho_tmp, existe
-- no esquema do Drizzle (packages/db/src/schema): coluna renomeada ou tabela que sumiu reprova no CI, não no NAS.
\set ON_ERROR_STOP on
begin;

select set_config('espelho.suffix', :'suffix', false);

create schema espelho_tmp;
-- o que era da produção, para a conferência do script (nada disso pode sobrar no dev)
create table espelho_tmp.prod_api_key as select prefix from api.api_key;
create table espelho_tmp.prod_publishable_key as select key_hash from ops.publishable_key;
-- o que o script preserva do dev (prefixos e hashes das chaves do dev): não conta como sobra da produção na conferência
create table espelho_tmp.dev_api_key (prefix text);
create table espelho_tmp.dev_publishable_key (key_hash text);

-- 1. demo_auth: tudo some, menos user e cache_feed_cursor
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'demo_auth' and tablename not in ('user', 'cache_feed_cursor')
  loop
    execute format('truncate table demo_auth.%I cascade', t);
  end loop;
end $$;

-- 2. usuários fictícios (numerados na ordem de criação, para o resultado ser o mesmo a cada espelho)
with numbered as (
  select id, row_number() over (order by "createdAt", id) as n
    from demo_auth."user"
   where email not like '%' || current_setting('espelho.suffix')
)
update demo_auth."user" u
   set name = 'Pessoa ' || n.n,
       email = 'pessoa-' || n.n || '@exemplo.invalid',
       image = null
  from numbered n
 where n.id = u.id;
-- campos extras do perfil (apps/demo/src/lib/auth/server.ts › additionalFields), só os que esta versão do schema tem
do $$
declare c text;
begin
  for c in
    select column_name from information_schema.columns
     where table_schema = 'demo_auth' and table_name = 'user'
       and column_name in ('job_title', 'company', 'phone', 'notes', 'banReason')
  loop
    execute format('update demo_auth."user" set %I = null where email not like %L', c, '%' || current_setting('espelho.suffix'));
  end loop;
end $$;

-- 3. chaves e webhooks
delete from api.webhook_endpoint;
delete from api.api_key;
delete from ops.publishable_key;

-- 4. nada da produção liga job, IA ou YouTube no dev, nem é executado por um worker do dev
delete from ops.runtime_setting;
delete from ops.runtime_setting_log;
delete from ops.runtime_env;
delete from ops.job_request where status in ('pending', 'running');
update ops.job_run set status = 'error', finished_at = now(), error = 'interrompido: espelho da produção no dev' where status = 'running';
delete from api.backfill_request where status = 'pending';

-- 5. e-mails de quem fez (colunas de autoria); as contas de teste ficam
update ops.widget set created_by = 'usuario@exemplo.invalid' where created_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and created_by not like '%' || current_setting('espelho.suffix');
update ops.job_request set requested_by = 'usuario@exemplo.invalid' where requested_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and requested_by not like '%' || current_setting('espelho.suffix');
update ops.lineup_review_request set resolved_by = 'usuario@exemplo.invalid' where resolved_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and resolved_by not like '%' || current_setting('espelho.suffix');
update enrich.logo_upload set uploaded_by = 'usuario@exemplo.invalid' where uploaded_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and uploaded_by not like '%' || current_setting('espelho.suffix');
update enrich.logo_upload set reverted_by = 'usuario@exemplo.invalid' where reverted_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and reverted_by not like '%' || current_setting('espelho.suffix');
update enrich.related_channel_rule set updated_by = 'usuario@exemplo.invalid' where updated_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and updated_by not like '%' || current_setting('espelho.suffix');
update semantic.review_decision set decided_by = 'usuario@exemplo.invalid' where decided_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and decided_by not like '%' || current_setting('espelho.suffix');
update api.tenant_channel_list set uploaded_by = 'usuario@exemplo.invalid' where uploaded_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and uploaded_by not like '%' || current_setting('espelho.suffix');
update api.tenant_channel_list set confirmed_by = 'usuario@exemplo.invalid' where confirmed_by ~ '^[^@[:space:]]+@[^@[:space:]]+$' and confirmed_by not like '%' || current_setting('espelho.suffix');

commit;
