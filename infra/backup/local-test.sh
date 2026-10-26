#!/usr/bin/env bash
# Teste dos scripts de backup SEM Docker, contra um Postgres qualquer (o do ambiente de desenvolvimento), com um banco
# sintético descartável: retenção por contagem, verificador (backup-check.sh) e ensaio de restauração
# (restore-drill.sh), incluindo as falhas. Precisa de psql/pg_dump/pg_restore da mesma versão do servidor.
#
#   PGHOST=localhost PGPORT=5433 PGUSER=galaxie PGPASSWORD=galaxie infra/backup/local-test.sh
#
# O ciclo com a imagem de backup e o schema real é o infra/backup/e2e-test.sh (CI).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
db="galaxie_backup_local_$$"
dir="$(mktemp -d)"
export PGDATABASE="$db" BACKUP_DIR="$dir" BACKUP_LIB="$here/lib.sh"
admin() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d postgres -c "$1"; }
q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "$1"; }
last() { q "select status || ' ' || coalesce(error, '') from ops.job_run where job = '$1' order by started_at desc limit 1"; }
expect() {
  if [ "$1" != "$2" ]; then
    echo "FALHOU: $3 (esperado '$2', veio '$1')" >&2
    exit 1
  fi
}
expect_prefix() {
  case "$1" in "$2"*) ;; *)
    echo "FALHOU: $3 (esperado começar com '$2', veio '$1')" >&2
    exit 1
    ;;
  esac
}
cleanup() {
  for d in $(admin "select datname from pg_database where datname like '${db}%'"); do
    admin "drop database if exists \"$d\" with (force)" >/dev/null || true
  done
  rm -rf "$dir"
}
trap cleanup EXIT

echo "0) banco sintético"
admin "create database \"$db\"" >/dev/null
q "
  create schema ops; create schema core; create schema raw; create schema drizzle;
  create table ops.job_run (id uuid primary key default gen_random_uuid(), job text not null, status text not null,
    calls_spent int not null default 0, started_at timestamptz not null default clock_timestamp(),
    finished_at timestamptz, error text, stats jsonb);
  create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);
  insert into drizzle.__drizzle_migrations (hash, created_at) select md5(g::text), g from generate_series(1, 3) g;
  create table core.competition (id int primary key, name text);
  insert into core.competition values (1, 'Liga');
  create table core.event (id int primary key, starts_at timestamptz not null, updated_at timestamptz not null);
  insert into core.event values (1, now() - interval '2 days', now() - interval '1 hour');
  create table raw.api_response (id int primary key, body jsonb);
  insert into raw.api_response values (1, '{}');" >/dev/null

echo "1) backup e retenção por contagem (BACKUP_KEEP_DAILY=3)"
for d in 01 02 03 04 05; do
  : >"$dir/${db}_202001${d}T033000Z.dump"
  : >"$dir/${db}_202001${d}T033000Z.dump.sha256"
done
BACKUP_KEEP_DAILY=3 "$here/backup.sh" >/dev/null
expect "$(ls "$dir"/*.dump | wc -l | tr -d ' ')" 3 "ficam 3 dumps"
expect "$(ls "$dir"/*.dump.sha256 | wc -l | tr -d ' ')" 3 "cada dump com o seu .sha256"
expect "$(find "$dir" -maxdepth 1 -name '*_2020010[123]T*' | wc -l | tr -d ' ')" 0 "os mais antigos saem primeiro"
expect "$(last pg-backup)" "ok " "pg-backup registrado"
# os dois vazios que sobraram não são restauráveis: o ensaio usa o mais recente (o de agora)
rm -f "$dir/${db}_202001"*

echo "2) verificador: dump recente passa; dump velho e recibo do NAS ausente acusam"
"$here/backup-check.sh" >/dev/null
expect "$(last backup-check)" "ok " "verificador ok"
if BACKUP_NAS_RECEIPT=true "$here/backup-check.sh" >/dev/null 2>&1; then echo "sem recibo do NAS deveria falhar" >&2; exit 1; fi
expect "$(last backup-check)" "error sem recibo da cópia do NAS ($dir/.nas_last_pull)" "recibo ausente"
touch "$dir/.nas_last_pull"
BACKUP_NAS_RECEIPT=true "$here/backup-check.sh" >/dev/null
expect "$(last backup-check)" "ok " "recibo recente"
dump="$(ls "$dir"/*.dump)"
touch -d '30 hours ago' "$dump"
if "$here/backup-check.sh" >/dev/null 2>&1; then echo "dump de 30 h deveria falhar" >&2; exit 1; fi
expect_prefix "$(last backup-check)" "error último dump ($(basename "$dump")) tem 30 h" "dump velho"

echo "3) ensaio de restauração: dump velho falha, recente passa e o temporário some"
if "$here/restore-drill.sh" >/dev/null 2>&1; then echo "ensaio com dump de 30 h deveria falhar" >&2; exit 1; fi
expect_prefix "$(last pg-restore-drill)" "error dump mais recente ($(basename "$dump")) tem 30 h" "dump velho no ensaio"
touch "$dump"
"$here/restore-drill.sh" >/dev/null
expect "$(last pg-restore-drill)" "ok " "ensaio ok"
expect "$(q "select stats->>'migrations' || '/' || (stats->'counts'->>'core.event') from ops.job_run where job = 'pg-restore-drill' and status = 'ok'")" "3/1" "conferência registrada"
expect "$(admin "select count(*) from pg_database where datname like '${db}_drill_%'")" 0 "temporário apagado"

echo "4) ensaio acusa tabela vazia, partida velha e checksum errado (e nunca deixa o temporário)"
q "delete from raw.api_response" >/dev/null
"$here/backup.sh" >/dev/null
if "$here/restore-drill.sh" >/dev/null 2>&1; then echo "raw vazio deveria falhar" >&2; exit 1; fi
expect "$(last pg-restore-drill)" "error tabela raw.api_response vazia no restaurado" "tabela vazia"
if RESTORE_DRILL_TABLES=ops.job_run RESTORE_DRILL_EVENT_MAX_AGE_H=0 "$here/restore-drill.sh" >/dev/null; then :; else
  echo "sem exigir o raw nem a partida o ensaio deveria passar" >&2
  exit 1
fi
q "update core.event set updated_at = now() - interval '5 days'" >/dev/null
"$here/backup.sh" >/dev/null
if RESTORE_DRILL_TABLES=ops.job_run "$here/restore-drill.sh" >/dev/null 2>&1; then echo "partida velha deveria falhar" >&2; exit 1; fi
expect_prefix "$(last pg-restore-drill)" "error última atualização de partida" "partida velha"
newest="$(ls "$dir"/*.dump | tail -n 1)"
echo "0000  $(basename "$newest")" >"$newest.sha256"
if RESTORE_DRILL_TABLES=ops.job_run RESTORE_DRILL_EVENT_MAX_AGE_H=0 "$here/restore-drill.sh" >/dev/null 2>&1; then
  echo "checksum errado deveria falhar" >&2
  exit 1
fi
expect "$(last pg-restore-drill)" "error checksum não confere: $(basename "$newest")" "checksum"
expect "$(admin "select count(*) from pg_database where datname like '${db}_drill_%'")" 0 "nenhum temporário sobrou"

echo "OK: retenção, verificador e ensaio de restauração"
