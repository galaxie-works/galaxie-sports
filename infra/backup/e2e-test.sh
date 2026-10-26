#!/usr/bin/env bash
# Teste ponta a ponta de backup → perda de dados → ensaio → restauração real, usando a imagem de backup.
# Pré-requisito: um banco descartável JÁ MIGRADO (o script não toca em outros bancos além dele e das cópias).
#
#   E2E_DB=galaxie_backup_e2e DOCKER_NETWORK=galaxie-sports_default PGHOST=postgres PGPORT=5432 \
#   PGUSER=galaxie PGPASSWORD=galaxie BACKUP_IMAGE=galaxie-sports-backup:dev infra/backup/e2e-test.sh
#
# No CI: DOCKER_NETWORK=host PGHOST=localhost.
set -euo pipefail

: "${E2E_DB:?Defina E2E_DB (banco descartável já migrado)}"
: "${BACKUP_IMAGE:=galaxie-sports-backup:dev}"
: "${DOCKER_NETWORK:=host}"
: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGUSER:=galaxie}" "${PGPASSWORD:=galaxie}"
volume="galaxie-backup-e2e-$$"

run() {
  docker run --rm --network "$DOCKER_NETWORK" -v "$volume:/backups" \
    -e PGHOST="$PGHOST" -e PGPORT="$PGPORT" -e PGUSER="$PGUSER" -e PGPASSWORD="$PGPASSWORD" -e PGDATABASE="$E2E_DB" \
    "$BACKUP_IMAGE" "$@"
}
psql_e2e() { run psql -X -t -A -v ON_ERROR_STOP=1 -c "$1"; }
psql_admin() { run psql -X -t -A -v ON_ERROR_STOP=1 -d postgres -c "$1"; }

cleanup() {
  psql_admin "select datname from pg_database where datname like '${E2E_DB}_pre_restore_%'" |
    while read -r db; do [ -n "$db" ] && psql_admin "drop database \"$db\" with (force)" >/dev/null; done || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# O volume nomeado nasce como root; o backup roda como usuário postgres.
docker run --rm -v "$volume:/backups" --user root --entrypoint chown "$BACKUP_IMAGE" postgres:postgres /backups

echo "1) dado marcador"
psql_e2e "insert into ops.job_run (job, status) values ('e2e-marker', 'ok')" >/dev/null

echo "2) backup"
run backup.sh
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-backup' order by started_at desc limit 1")" = ok ]

echo "3) perda de dados"
psql_e2e "delete from ops.job_run where job = 'e2e-marker'" >/dev/null
[ "$(psql_e2e "select count(*) from ops.job_run where job = 'e2e-marker'")" = 0 ]

echo "4) ensaio (--verify) não altera o banco"
run restore.sh --verify latest
[ "$(psql_e2e "select count(*) from ops.job_run where job = 'e2e-marker'")" = 0 ]

echo "4b) dump sem .sha256 só passa com --no-checksum"
run sh -c 'f=$(ls -1t /backups/*.dump | head -n 1); mv "$f.sha256" "$f.sha256.fora"'
if run restore.sh --verify latest >/dev/null 2>&1; then echo "restore sem checksum deveria falhar" >&2; exit 1; fi
run restore.sh --verify --no-checksum latest
run sh -c 'f=$(ls -1t /backups/*.dump | head -n 1); mv "$f.sha256.fora" "$f.sha256"'

echo "5) restauração real exige confirmação"
if run restore.sh latest >/dev/null 2>&1; then echo "restore sem --yes deveria falhar" >&2; exit 1; fi

echo "6) restauração real"
run restore.sh --yes latest
[ "$(psql_e2e "select count(*) from ops.job_run where job = 'e2e-marker'")" = 1 ]
# a execução de backup que estava em andamento no momento do dump é marcada como interrompida
[ "$(psql_e2e "select count(*) from ops.job_run where status = 'running'")" = 0 ]
[ -n "$(psql_admin "select datname from pg_database where datname like '${E2E_DB}_pre_restore_%'")" ]

echo "7) verificador (backup-check.sh) com o dump de agora"
run backup-check.sh
[ "$(psql_e2e "select status from ops.job_run where job = 'backup-check' order by started_at desc limit 1")" = ok ]

echo "8) ensaio de restauração no schema real (banco de CI sem partidas: só ops.job_run e sem a checagem de partida)"
run env RESTORE_DRILL_TABLES=ops.job_run RESTORE_DRILL_EVENT_MAX_AGE_H=0 restore-drill.sh
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-restore-drill' order by started_at desc limit 1")" = ok ]
[ -z "$(psql_admin "select datname from pg_database where datname like '${E2E_DB}_drill_%'")" ]
# com a checagem padrão o banco de CI (sem core.event) falha, registra o erro e também não deixa o temporário
if run restore-drill.sh >/dev/null 2>&1; then echo "ensaio sem partidas deveria falhar" >&2; exit 1; fi
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-restore-drill' order by started_at desc limit 1")" = error ]
[ -z "$(psql_admin "select datname from pg_database where datname like '${E2E_DB}_drill_%'")" ]

echo "9) retenção por contagem (BACKUP_KEEP_DAILY=2)"
run sh -c "for d in 01 02 03; do : > /backups/${E2E_DB}_202001\${d}T033000Z.dump; done"
run env BACKUP_KEEP_DAILY=2 backup.sh
[ "$(run sh -c 'ls /backups/*.dump | wc -l')" = 2 ]
[ -z "$(run sh -c 'ls /backups/*_202001*.dump 2>/dev/null')" ]

echo "OK: backup, restauração, verificador, ensaio e retenção verificados"
