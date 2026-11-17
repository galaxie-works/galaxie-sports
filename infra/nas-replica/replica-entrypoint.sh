#!/bin/sh
# Entrypoint do serviço `postgres` da stack nas-replica (infra/nas-replica/compose.yml): o hot standby da produção.
# Roda como root (como o docker-entrypoint.sh da imagem postgres) e:
#   1. sem cluster em $PGDATA: espera o túnel (tunnel:5432) responder e faz o pg_basebackup da produção como o usuário
#      postgres, numa pasta temporária ao lado (basebackup.tmp), com -R (standby.signal + primary_conninfo em
#      postgresql.auto.conf) e o slot REPLICA_SLOT criado pelo próprio basebackup (-C -S). Só com o basebackup completo
#      a pasta vira $PGDATA; interrompido, a temporária é apagada e o contêiner sai (restart: unless-stopped tenta de
#      novo, do zero). A senha vai pelo .pgpass do usuário postgres, nunca na linha de comando nem no auto.conf;
#   2. com cluster: regrava o .pgpass (a senha pode ter mudado no ambiente da stack) e confere o standby.signal: um
#      cluster que saiu da recuperação (promovido por engano) NÃO sobe, para a cópia divergente nunca passar por réplica;
#   3. exec docker-entrypoint.sh postgres ... (os -c do compose).
# Nunca toca na produção além de ler o WAL. Runbook: docs/runbooks/replica-no-nas.md.
set -eu

: "${PGDATA:=/var/lib/postgresql/data}"
: "${PRIMARY_HOST:=tunnel}"
: "${PRIMARY_PORT:=5432}"
: "${REPLICA_SLOT:=nas_replica}"
: "${REPLICATOR_USER:=replicador}"
: "${REPLICATOR_PASSWORD:?defina REPLICATOR_PASSWORD}"
PGHOME=/var/lib/postgresql
TMP="$PGHOME/basebackup.tmp"

log() { printf '{"level":"%s","time":"%s","service":"nas-replica","msg":"%s"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2"; }

# .pgpass do usuário postgres: host:porta:banco:usuário:senha (replication casa com *)
write_pgpass() {
  umask 077
  printf '%s:%s:*:%s:%s\n' "$PRIMARY_HOST" "$PRIMARY_PORT" "$REPLICATOR_USER" "$REPLICATOR_PASSWORD" >"$PGHOME/.pgpass"
  chown postgres:postgres "$PGHOME/.pgpass"
  chmod 600 "$PGHOME/.pgpass"
  umask 022
}

mkdir -p "$PGHOME"
chown postgres:postgres "$PGHOME"
write_pgpass

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  rm -rf "$TMP"
  log info "sem cluster em $PGDATA: esperando o túnel $PRIMARY_HOST:$PRIMARY_PORT para o pg_basebackup"
  i=0
  until pg_isready -q -h "$PRIMARY_HOST" -p "$PRIMARY_PORT"; do
    i=$((i + 1))
    [ "$i" -le 120 ] || { log error "túnel sem resposta depois de 10 min (o serviço tunnel está no ar? a chave está no authorized_keys da VPS?)"; exit 1; }
    sleep 5
  done
  log info "basebackup da produção começando (pode levar horas num link residencial; o progresso sai neste log)"
  # -R: standby.signal e primary_conninfo (com passfile, sem a senha) no postgresql.auto.conf; -C -S: cria o slot
  # (falha se já existir: slot de uma réplica anterior se apaga na produção, runbook › Refazer a réplica)
  if ! su-exec postgres env HOME="$PGHOME" PGPASSFILE="$PGHOME/.pgpass" pg_basebackup \
    -d "host=$PRIMARY_HOST port=$PRIMARY_PORT user=$REPLICATOR_USER application_name=$REPLICA_SLOT" \
    -D "$TMP" -X stream -R -C -S "$REPLICA_SLOT" --checkpoint=fast --progress --no-password; then
    rm -rf "$TMP"
    log error "pg_basebackup falhou; nada ficou em $PGDATA (o contêiner tenta de novo ao reiniciar)"
    exit 1
  fi
  [ -f "$TMP/standby.signal" ] || { rm -rf "$TMP"; log error "basebackup sem standby.signal (pg_basebackup sem -R?)"; exit 1; }
  rm -rf "$PGDATA"
  mv "$TMP" "$PGDATA"
  chmod 700 "$PGDATA"
  log info "basebackup completo em $PGDATA; a réplica sobe e começa a aplicar o WAL"
fi

if [ ! -f "$PGDATA/standby.signal" ]; then
  log error "o cluster em $PGDATA não é mais um standby (sem standby.signal: foi promovido?). Não sobe: apague o volume e refaça a réplica (runbook › Refazer a réplica)"
  exit 1
fi

exec docker-entrypoint.sh "$@"
