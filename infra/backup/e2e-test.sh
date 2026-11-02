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

echo "11) cópia dos assets (s3-sync.sh) com um S3 de verdade: RustFS, o mesmo da stack, com dois buckets (assets e remoto)"
s3_port="${E2E_S3_PORT:-19000}"
s3_name="galaxie-backup-e2e-s3-$$"
# chaves descartáveis do RustFS de teste, geradas na hora (nada de segredo no repositório)
s3_key="e2e$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
s3_secret="e2e$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
s3_net=(--network "$DOCKER_NETWORK")
s3_ep="http://localhost:$s3_port"
# fora do modo host (rede da stack), o RustFS fala pelo nome do contêiner
[ "$DOCKER_NETWORK" = host ] || s3_ep="http://$s3_name:$s3_port"
docker run -d --rm --name "$s3_name" "${s3_net[@]}" -e RUSTFS_ACCESS_KEY="$s3_key" -e RUSTFS_SECRET_KEY="$s3_secret"   -e RUSTFS_CONSOLE_ENABLE=false -e RUSTFS_ADDRESS=":$s3_port" "${E2E_RUSTFS_IMAGE:-rustfs/rustfs:1.0.4}" >/dev/null
trap 'docker rm -f "$s3_name" >/dev/null 2>&1 || true; cleanup' EXIT
# o aws da própria imagem de backup, com as chaves do RustFS do teste
aws_e2e() {
  docker run --rm "${s3_net[@]}" -v "$volume:/backups" -e AWS_ACCESS_KEY_ID="$s3_key" -e AWS_SECRET_ACCESS_KEY="$s3_secret"     -e AWS_DEFAULT_REGION=us-east-1 "$BACKUP_IMAGE" aws --endpoint-url "$s3_ep" "$@"
}
for i in $(seq 1 30); do aws_e2e s3api list-buckets >/dev/null 2>&1 && break; [ "$i" -lt 30 ] || { echo "RustFS não subiu" >&2; docker logs "$s3_name" >&2; exit 1; }; sleep 2; done
aws_e2e s3api create-bucket --bucket assets-e2e >/dev/null
aws_e2e s3api create-bucket --bucket remoto-e2e >/dev/null
# objetos de quatro prefixos: três valem cópia (um com subpasta), um não
sync_env=(-e S3_ENDPOINT="$s3_ep" -e S3_BUCKET=assets-e2e -e S3_ACCESS_KEY="$s3_key" -e S3_SECRET_KEY="$s3_secret"
  -e BACKUP_S3_BUCKET=remoto-e2e -e BACKUP_S3_ENDPOINT="$s3_ep" -e AWS_ACCESS_KEY_ID="$s3_key" -e AWS_SECRET_ACCESS_KEY="$s3_secret"
  -e AWS_DEFAULT_REGION=us-east-1)
for f in broadcasters/a.svg broadcasters/b.png platforms/p.png commons/people/q.jpg api-sports/football/teams/1.png; do
  docker run --rm "${s3_net[@]}" "${sync_env[@]}" "$BACKUP_IMAGE" sh -c "echo 'conteudo $f' | aws --endpoint-url '$s3_ep' s3 cp - 's3://assets-e2e/$f'" >/dev/null
done
sync_run() { docker run --rm "${s3_net[@]}" -v "$volume:/backups" -e PGHOST="$PGHOST" -e PGPORT="$PGPORT" -e PGUSER="$PGUSER"   -e PGPASSWORD="$PGPASSWORD" -e PGDATABASE="$E2E_DB" -e BACKUP_S3_SYNC_PREFIXES="broadcasters,platforms commons/people" "${sync_env[@]}" "$@"; }
sync_run "$BACKUP_IMAGE" s3-sync.sh
# espelho no volume (de onde o NAS puxa) e no bucket remoto, só dos prefixos pedidos
[ "$(run sh -c 'cat /backups/s3/broadcasters/a.svg /backups/s3/platforms/p.png /backups/s3/commons/people/q.jpg | wc -l')" = 3 ]
[ -z "$(run sh -c 'ls /backups/s3/api-sports 2>/dev/null')" ] || { echo "prefixo fora da lista foi copiado" >&2; exit 1; }
remote=$(aws_e2e s3 ls s3://remoto-e2e/assets/ --recursive | awk '{print $4}' | sort | tr '
' ' ')
[ "$remote" = "assets/broadcasters/a.svg assets/broadcasters/b.png assets/commons/people/q.jpg assets/platforms/p.png " ] ||
  { echo "bucket remoto com objetos errados: $remote" >&2; exit 1; }
[ -n "$(run sh -c 'ls /backups/.s3_last_sync')" ]
# o verificador exige o recibo quando o sync está ligado, e aceita o recibo de agora
sync_run "$BACKUP_IMAGE" backup-check.sh
run rm -f /backups/.s3_last_sync
if sync_run "$BACKUP_IMAGE" backup-check.sh >/dev/null 2>&1; then echo "backup-check sem recibo do S3 deveria falhar" >&2; exit 1; fi
# nada é apagado por padrão: o objeto que sumiu do RustFS continua no espelho e no remoto
aws_e2e s3 rm s3://assets-e2e/broadcasters/b.png >/dev/null
sync_run "$BACKUP_IMAGE" s3-sync.sh
[ "$(run sh -c 'cat /backups/s3/broadcasters/b.png | wc -l')" = 1 ]
aws_e2e s3 ls s3://remoto-e2e/assets/broadcasters/b.png | grep -q b.png
# prefixo que não existe no RustFS (nome errado): o sync real termina com sucesso sem copiar nada, e o s3-sync.sh acusa
if sync_run -e BACKUP_S3_SYNC_PREFIXES="broadcasters inexistente" "$BACKUP_IMAGE" s3-sync.sh >/dev/null 2>&1; then
  echo "prefixo inexistente deveria falhar" >&2
  exit 1
fi
# com BACKUP_S3_SYNC_DELETE=true, a remoção chega aos dois lados
sync_run -e BACKUP_S3_SYNC_DELETE=true "$BACKUP_IMAGE" s3-sync.sh
[ -z "$(run sh -c 'ls /backups/s3/broadcasters/b.png 2>/dev/null')" ]
[ -z "$(aws_e2e s3 ls s3://remoto-e2e/assets/broadcasters/b.png)" ]
# restauração do prefixo: do bucket remoto de volta para um RustFS vazio, e o objeto volta a ser servido
aws_e2e s3api create-bucket --bucket restaurado-e2e >/dev/null
aws_e2e s3 sync --only-show-errors s3://remoto-e2e/assets/broadcasters/ s3://restaurado-e2e/broadcasters/
[ "$(aws_e2e s3 cp s3://restaurado-e2e/broadcasters/a.svg - | tr -d '
')" = "conteudo broadcasters/a.svg" ]
# recibo do sync no registro do verificador
sync_run "$BACKUP_IMAGE" s3-sync.sh
sync_run "$BACKUP_IMAGE" backup-check.sh

echo "OK: backup, restauração, verificador, ensaio, retenção, cifragem e cópia dos assets verificados"
