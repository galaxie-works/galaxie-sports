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
# Como na stack: backup, verificador e ensaios com o papel do backup (DB_URL_BACKUP; packages/db/src/roles.ts), sem
# superusuário. Sem BACKUP_ROLE_URL, com o dono. A restauração real continua com o dono.
run_role() {
  docker run --rm --network "$DOCKER_NETWORK" -v "$volume:/backups" \
    -e PGHOST="$PGHOST" -e PGPORT="$PGPORT" -e PGUSER="$PGUSER" -e PGPASSWORD="$PGPASSWORD" -e PGDATABASE="$E2E_DB" \
    -e DB_URL_BACKUP="${BACKUP_ROLE_URL:-}" "$BACKUP_IMAGE" "$@"
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
if [ -n "${BACKUP_ROLE_URL:-}" ]; then
  # o lib.sh troca para o usuário da URL: o backup não roda como superusuário
  # shellcheck disable=SC2016 # expandido dentro do contêiner
  who=$(run_role sh -c '. /usr/local/lib/galaxie-backup/lib.sh && psql -X -t -A -c "select current_user || chr(32) || rolsuper from pg_roles where rolname = current_user"')
  [ "$who" = "galaxie_backup false" ] || { echo "backup deveria rodar como galaxie_backup sem superusuário: $who" >&2; exit 1; }
fi
run_role backup.sh
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-backup' order by started_at desc limit 1")" = ok ]

echo "3) perda de dados"
psql_e2e "delete from ops.job_run where job = 'e2e-marker'" >/dev/null
[ "$(psql_e2e "select count(*) from ops.job_run where job = 'e2e-marker'")" = 0 ]

echo "4) ensaio (--verify) não altera o banco"
run_role restore.sh --verify latest
[ "$(psql_e2e "select count(*) from ops.job_run where job = 'e2e-marker'")" = 0 ]

echo "4b) dump sem .sha256 só passa com --no-checksum"
run sh -c 'f=$(ls -1t /backups/*.dump | head -n 1); mv "$f.sha256" "$f.sha256.fora"'
if run restore.sh --verify latest >/dev/null 2>&1; then echo "restore sem checksum deveria falhar" >&2; exit 1; fi
run_role restore.sh --verify --no-checksum latest
run sh -c 'f=$(ls -1t /backups/*.dump | head -n 1); mv "$f.sha256.fora" "$f.sha256"'

echo "5) restauração real exige confirmação"
if run restore.sh latest >/dev/null 2>&1; then echo "restore sem --yes deveria falhar" >&2; exit 1; fi

echo "6) restauração real"
run restore.sh --yes latest
[ "$(psql_e2e "select count(*) from ops.job_run where job = 'e2e-marker'")" = 1 ]
# a execução de backup que estava em andamento no momento do dump é marcada como interrompida
[ "$(psql_e2e "select count(*) from ops.job_run where status = 'running'")" = 0 ]
[ -n "$(psql_admin "select datname from pg_database where datname like '${E2E_DB}_pre_restore_%'")" ]
# o dump vai sem GRANTs (--no-privileges): depois da restauração real, o migrate aplica os papéis de novo
# (README › Papéis do banco); MIGRATE_CMD é esse passo aqui
if [ -n "${MIGRATE_CMD:-}" ]; then
  echo "6b) papéis de novo depois da restauração (migrate)"
  sh -c "$MIGRATE_CMD"
fi

echo "7) verificador (backup-check.sh) com o dump de agora"
run_role backup-check.sh
[ "$(psql_e2e "select status from ops.job_run where job = 'backup-check' order by started_at desc limit 1")" = ok ]

echo "8) ensaio de restauração no schema real (banco de CI sem partidas: só ops.job_run e sem a checagem de partida)"
run_role env RESTORE_DRILL_TABLES=ops.job_run RESTORE_DRILL_EVENT_MAX_AGE_H=0 restore-drill.sh
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-restore-drill' order by started_at desc limit 1")" = ok ]
[ -z "$(psql_admin "select datname from pg_database where datname like '${E2E_DB}_drill_%'")" ]
# com a checagem padrão o banco de CI (sem core.event) falha, registra o erro e também não deixa o temporário
if run_role restore-drill.sh >/dev/null 2>&1; then echo "ensaio sem partidas deveria falhar" >&2; exit 1; fi
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-restore-drill' order by started_at desc limit 1")" = error ]
[ -z "$(psql_admin "select datname from pg_database where datname like '${E2E_DB}_drill_%'")" ]

echo "9) retenção por contagem (BACKUP_KEEP_DAILY=2)"
run sh -c "for d in 01 02 03; do : > /backups/${E2E_DB}_202001\${d}T033000Z.dump; done"
run_role env BACKUP_KEEP_DAILY=2 backup.sh
[ "$(run sh -c 'ls /backups/*.dump | wc -l')" = 2 ]
[ -z "$(run sh -c 'ls /backups/*_202001*.dump 2>/dev/null')" ]

echo "10) dumps cifrados (age): sai só o .age, o ensaio e o --verify decifram com a chave do ensaio"
# duas chaves, como na produção: a do ensaio (privada na VPS) e a de recuperação (privada só com o Wagner)
drill_keys=$(run age-keygen 2>/dev/null)
drill_id=$(printf '%s\n' "$drill_keys" | grep '^AGE-SECRET-KEY-1')
drill_pub=$(printf '%s\n' "$drill_keys" | sed -n 's/^# public key: //p')
recovery_keys=$(run age-keygen 2>/dev/null)
recovery_id=$(printf '%s\n' "$recovery_keys" | grep '^AGE-SECRET-KEY-1')
recovery_pub=$(printf '%s\n' "$recovery_keys" | sed -n 's/^# public key: //p')
cipher() { run env BACKUP_AGE_RECIPIENTS="$drill_pub, $recovery_pub" BACKUP_AGE_IDENTITY="$drill_id" "$@"; }
# sobra em claro de um backup morto no meio (mais velha que 12 h) sai no backup seguinte
run touch -t 202001010000 "/backups/${E2E_DB}_20200101T000000Z.dump.partial"
cipher backup.sh
[ -z "$(run sh -c "ls /backups/${E2E_DB}_20200101T000000Z.dump.partial 2>/dev/null")" ] || { echo "sobra em claro não foi apagada" >&2; exit 1; }
enc=$(run sh -c "ls -1 /backups/${E2E_DB}_*.dump.age | tail -n 1")
[ -n "$enc" ] || { echo "backup cifrado não gerou .dump.age" >&2; exit 1; }
# nada em claro sobrou do backup cifrado (o dump em claro existe só durante a execução)
[ -z "$(run sh -c 'ls /backups/*.partial 2>/dev/null')" ]
[ "$(run sh -c "ls -1 /backups/${E2E_DB}_*.dump | tail -n 1")" \< "$enc" ]
# cifrado de verdade: o pg_restore não lê o arquivo, e o .sha256 é o do arquivo cifrado
if run pg_restore --list "$enc" >/dev/null 2>&1; then echo "o .age não deveria ser legível sem decifrar" >&2; exit 1; fi
run sh -c "cd /backups && sha256sum -c -s $(basename "$enc").sha256"
# a chave de recuperação, sozinha, também decifra num dump legível
# shellcheck disable=SC2016 # expandido dentro do contêiner
run env ID="$recovery_id" F="$enc" sh -c 'printf "%s\n" "$ID" > /tmp/r && age -d -i /tmp/r "$F" | pg_restore --list >/dev/null'
cipher restore.sh --verify latest
cipher env RESTORE_DRILL_TABLES=ops.job_run RESTORE_DRILL_EVENT_MAX_AGE_H=0 restore-drill.sh
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-restore-drill' order by started_at desc limit 1")" = ok ]
[ -z "$(run sh -c 'ls /backups/.drill-* /backups/.restore-* 2>/dev/null')" ]
# sem a chave do ensaio, o ensaio de um dump cifrado falha e registra o erro (não passa em silêncio)
if run env RESTORE_DRILL_TABLES=ops.job_run RESTORE_DRILL_EVENT_MAX_AGE_H=0 restore-drill.sh >/dev/null 2>&1; then
  echo "ensaio de dump cifrado sem a chave deveria falhar" >&2
  exit 1
fi
[ "$(psql_e2e "select status from ops.job_run where job = 'pg-restore-drill' order by started_at desc limit 1")" = error ]
# destinatário inválido: o backup falha em vez de gravar sem cifrar
if run env BACKUP_AGE_RECIPIENTS=nao-e-chave backup.sh >/dev/null 2>&1; then
  echo "BACKUP_AGE_RECIPIENTS inválido deveria falhar" >&2
  exit 1
fi
# cifragem ligada sem a chave do ensaio: o backup falha na hora, não no ensaio do mês seguinte
if run env BACKUP_AGE_RECIPIENTS="$drill_pub" backup.sh >/dev/null 2>&1; then
  echo "BACKUP_AGE_RECIPIENTS sem BACKUP_AGE_IDENTITY deveria falhar" >&2
  exit 1
fi
cipher backup-check.sh

echo "OK: backup, restauração, verificador, ensaio, retenção e cifragem verificados"
