#!/bin/sh
# Entrypoint do serviço `postgres` da stack nas-replica (infra/nas-replica/compose.yml): o hot standby da produção.
# Roda como root (como o docker-entrypoint.sh da imagem postgres) e:
#   1. sem cluster em $PGDATA (um subdiretório do volume nomeado, /var/lib/postgresql/data/pgdata, para o Docker não
#      criar um volume anônimo por cima do VOLUME da imagem): espera o túnel (tunnel:5432) responder, apaga na
#      produção um slot REPLICA_SLOT que tenha sobrado INATIVO de um basebackup interrompido (senão o -C falha com
#      "already exists" e o contêiner entra em laço; um slot ATIVO é de outra réplica e para aqui) e faz o
#      pg_basebackup da produção como o usuário postgres, numa pasta temporária no mesmo volume (basebackup.tmp), com
#      -R (standby.signal + primary_conninfo em postgresql.auto.conf) e o slot criado pelo próprio basebackup (-C -S).
#      Só com o basebackup completo a pasta vira $PGDATA; interrompido, a temporária é apagada e o contêiner sai
#      (restart: unless-stopped tenta de novo, do zero). A senha vai pelo .pgpass (PGPASSFILE, no volume), nunca na
#      linha de comando nem no auto.conf;
#   2. com cluster: regrava o .pgpass (a senha pode ter mudado no ambiente da stack) e confere o standby.signal: um
#      cluster que saiu da recuperação (promovido por engano) NÃO sobe, para a cópia divergente nunca passar por réplica;
#   3. exec docker-entrypoint.sh postgres ... (os -c do compose).
# Nunca toca na produção além de ler o WAL e, no caso 1, apagar o próprio slot inativo. Runbook: docs/runbooks/replica-no-nas.md.
# Teste com binários falsos: replica-entrypoint.test.sh.
set -eu

: "${PGDATA:=/var/lib/postgresql/data/pgdata}"
: "${PRIMARY_HOST:=tunnel}"
: "${PRIMARY_PORT:=5432}"
: "${REPLICA_SLOT:=nas_replica}"
: "${REPLICATOR_USER:=replicador}"
: "${REPLICATOR_PASSWORD:?defina REPLICATOR_PASSWORD}"
VOL="$(dirname "$PGDATA")"
: "${PGPASSFILE:=$VOL/.pgpass}"
TMP="$VOL/basebackup.tmp"

log() { printf '{"level":"%s","time":"%s","service":"nas-replica","msg":"%s"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2"; }
# como o usuário postgres: a imagem postgres:17-alpine traz o gosu (su-exec ficou nas versões antigas; na primeira subida
# em 17/11/2026 o basebackup falhou com "su-exec: not found"); num teste sem root, direto
as_postgres() {
  if [ "$(id -u)" != 0 ]; then "$@"
  elif command -v gosu >/dev/null 2>&1; then gosu postgres "$@"
  elif command -v su-exec >/dev/null 2>&1; then su-exec postgres "$@"
  else log error "nem gosu nem su-exec na imagem: não dá para rodar como postgres"; exit 1
  fi
}
own() { [ "$(id -u)" != 0 ] || chown postgres:postgres "$@"; }

# .pgpass do usuário postgres: host:porta:banco:usuário:senha (replication casa com *)
write_pgpass() {
  umask 077
  printf '%s:%s:*:%s:%s\n' "$PRIMARY_HOST" "$PRIMARY_PORT" "$REPLICATOR_USER" "$REPLICATOR_PASSWORD" >"$PGPASSFILE"
  own "$PGPASSFILE"
  chmod 600 "$PGPASSFILE"
  umask 022
}
# na produção, pelo túnel, como replicador (só pg_replication_slots)
psql_primary() {
  as_postgres env PGPASSFILE="$PGPASSFILE" psql -X -q -t -A -v ON_ERROR_STOP=1 -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" \
    -U "$REPLICATOR_USER" -d postgres -w -c "$1"
}

mkdir -p "$VOL"
own "$VOL"
export PGPASSFILE
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
  # slot que sobrou de um basebackup interrompido: inativo, some; ativo é de outra réplica usando o mesmo nome
  slot=$(psql_primary "select active from pg_replication_slots where slot_name = '$REPLICA_SLOT'" 2>/dev/null || echo "?")
  case "$slot" in
    "") ;;
    f)
      psql_primary "select pg_drop_replication_slot('$REPLICA_SLOT')" >/dev/null || { log error "slot $REPLICA_SLOT inativo na produção e não deu para apagá-lo (sobra de um basebackup interrompido): apague à mão, select pg_drop_replication_slot('$REPLICA_SLOT')"; exit 1; }
      log warn "slot $REPLICA_SLOT inativo na produção (sobra de um basebackup interrompido): apagado; o basebackup cria outro"
      ;;
    t) log error "slot $REPLICA_SLOT ATIVO na produção: outra réplica o usa. Troque REPLICA_SLOT ou pare a outra"; exit 1 ;;
    *) log warn "não deu para consultar o slot na produção (papel sem acesso ao banco postgres?); seguindo para o basebackup" ;;
  esac
  log info "basebackup da produção começando (pode levar horas num link residencial; o progresso sai neste log)"
  # -R: standby.signal e primary_conninfo (com passfile, sem a senha) no postgresql.auto.conf; -C -S: cria o slot
  if ! as_postgres env PGPASSFILE="$PGPASSFILE" pg_basebackup \
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
