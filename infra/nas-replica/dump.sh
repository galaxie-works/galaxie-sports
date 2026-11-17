#!/bin/sh
# Dump do Postgres de produção a partir da RÉPLICA do NAS (stack nas-replica; docs/runbooks/replica-no-nas.md). Roda no
# contêiner `dumper`, pelo crond (DUMP_CRON e, a cada minuto, --pedido), pelo arquivo-gatilho (/data/.dump-now) ou à mão:
#   docker exec nas-replica-dumper-1 /dump.sh                           # dump diário em daily/
#   docker exec nas-replica-dumper-1 /dump.sh pre-migrate <rótulo>      # dump de antes de um deploy, em pre-migrate/
#   /dump.sh --pedido        # (cron, a cada minuto) lê na VPS o pedido que o deploy deixou e, se houver, faz o pre-migrate
#   /dump.sh --se-velho      # só se o último de daily/ tiver mais de 20 h (partida do contêiner)
# A cada execução:
#   1. a réplica está em recuperação (pg_is_in_recovery): uma cópia promovida por engano nunca vira dump de produção. Se
#      o replay estiver pausado (alguém pausou à mão), tenta retomar e registra: o dump de um replay parado é velho;
#   2. atraso: WAL por aplicar, medido contra a produção pelo túnel (como replicador), até DUMP_MAX_LAG_MB; sem o túnel,
#      vale o que a réplica sabe (receive x replay). Slot `lost` na produção = para e manda refazer a réplica;
#   3. disco: espaço livre em /data para o dump (1,3x o último, ou 1 GB);
#   4. pg_dump, sem pausar o replay (pausar exige superusuário; o papel de backup não é): o pg_dump tem snapshot próprio e
#      a réplica roda com max_standby_streaming_delay=-1, então a consulta longa nunca é cancelada por conflito com a
#      recuperação. Mesmo formato do backup da VPS (infra/backup/backup.sh): custom, zstd, sem dono e privilégios, sem
#      os dados da API do YouTube (política de 30 dias), pg_restore --list conferido, cifrado com age se
#      DUMP_AGE_RECIPIENTS (chaves públicas), .sha256 ao lado;
#   5. daily/: com a rotação 7/4/6 da nas-lib.sh (o dump que o nas-pull.sh trouxe da VPS fica como está até a rotação);
#      pre-migrate/: os PRE_MIGRATE_KEEP mais novos, fora da rotação (como na VPS). A trava é a mesma do nas-pull.sh
#      ($NAS_DIR/.lock): os dois nunca mexem em daily/ ao mesmo tempo;
#   6. recibo .nas_last_dump na VPS (chave de recibo da stack galaxie-sports-backup-nas, comando forçado
#      galaxie-nas-receipt: "dump <quando> <bytes> <arquivo>"), que também apaga o pedido atendido: é o que o deploy
#      com DUMP_MODE=nas e o backup-check.sh da VPS conferem. Sem recibo gravado = falha (o dump fica, mas a VPS não
#      sabe dele);
#   7. com OFFSITE_RCLONE_REMOTE, envia o dump e o .sha256 para o remoto e deixa lá só os OFFSITE_KEEP mais novos
#      (opcional, desligado por padrão; só cifrado, salvo OFFSITE_ALLOW_PLAINTEXT=true).
# Estado em /data/last_dump.txt; saída 0 = dump gravado e recibo na VPS (ou nada a fazer); 1 = algo falhou (motivo no
# last_dump.txt).
set -eu

: "${NAS_DIR:=/data}"
: "${DUMP_PREFIX:=galaxie_sports_}"
: "${PGDATABASE:?defina PGDATABASE}"
: "${PRIMARY_HOST:=tunnel}"
: "${PRIMARY_PORT:=5432}"
: "${REPLICA_SLOT:=nas_replica}"
: "${REPLICATOR_USER:=replicador}"
: "${REPLICATOR_PASSWORD:=}"
: "${DUMP_MAX_LAG_MB:=256}"
: "${DUMP_COMPRESS:=zstd:5}"
: "${DUMP_AGE_RECIPIENTS:=}"
: "${PRE_MIGRATE_KEEP:=2}"
: "${VPS_HOST:?defina VPS_HOST}"
: "${VPS_USER:=root}"
: "${VPS_PORT:=22}"
: "${OFFSITE_RCLONE_REMOTE:=}"
: "${OFFSITE_KEEP:=2}"
: "${OFFSITE_ALLOW_PLAINTEXT:=false}"
# tabelas que vão só com a estrutura (as mesmas do backup.sh da VPS)
: "${DUMP_EXCLUDE_TABLE_DATA:=enrich.related_content enrich.youtube_channel enrich.related_playback_block enrich.related_playback_report}"

# rotação e nomes dos dumps, compartilhados com o nas-pull.sh (cópia de infra/nas-backup/nas-lib.sh na pasta de backups)
# shellcheck source=infra/nas-backup/nas-lib.sh
. "$NAS_DIR/nas-lib.sh"

mode=daily
label=""
only_if_old=""
pedido=""
case "${1:-}" in
  --se-velho) only_if_old=1 ;;
  --pedido) pedido=1 ;;
  pre-migrate)
    mode=pre-migrate
    label="${2:-deploy}"
    case "$label" in *[!A-Za-z0-9._-]* | '') echo "rótulo inválido: '$label'" >&2; exit 1 ;; esac
    ;;
  '') ;;
  *) echo "uso: dump.sh [--se-velho | --pedido | pre-migrate <rótulo>]" >&2; exit 1 ;;
esac

log() {
  level="$1"
  shift
  msg=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"level":"%s","time":"%s","service":"nas-replica-dumper","msg":"%s"}\n' "$level" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg"
}
state() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >"$NAS_DIR/last_dump.txt"; }

tmp=""
plain=""
recipients=""
cleanup() { rm -f "$tmp" "$plain" "$recipients"; }
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
fail() {
  log error "$*"
  state "erro: $*"
  exit 1
}

psql_replica() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$PGDATABASE" -c "$1"; }
# na produção, pelo túnel, como replicador (lê só pg_replication_slots e o LSN atual); vazio se não der
psql_primary() {
  [ -n "$REPLICATOR_PASSWORD" ] || return 1
  PGPASSWORD="$REPLICATOR_PASSWORD" psql -X -q -t -A -v ON_ERROR_STOP=1 -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" \
    -U "$REPLICATOR_USER" -d postgres -c "$1" 2>/dev/null
}
receipt_ssh="ssh -T -p $VPS_PORT -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
-o UserKnownHostsFile=$NAS_DIR/ssh/known_hosts -o ConnectTimeout=30 -o ServerAliveInterval=30 -i $NAS_DIR/ssh/receipt_ed25519"

mkdir -p "$NAS_DIR/daily" "$NAS_DIR/weekly" "$NAS_DIR/monthly" "$NAS_DIR/incoming" "$NAS_DIR/pre-migrate"
# a mesma trava do nas-pull.sh: uma execução por vez em daily/ (o --pedido de cada minuto sai calado se há dump rodando)
exec 9>"$NAS_DIR/.lock"
flock -n 9 || { [ -n "$pedido" ] || log warn "outro dump ou a cópia do NAS em andamento; saindo"; exit 0; }

if [ -n "$only_if_old" ]; then
  last=$(dumps_in "$NAS_DIR/daily" | tail -n 1)
  if [ -n "$last" ] && [ -n "$(find "$last" -mmin -1200 2>/dev/null)" ]; then
    log info "dump de partida dispensado: $(basename "$last") tem menos de 20 h"
    exit 0
  fi
fi

# --pedido: o deploy com DUMP_MODE=nas deixou um pedido na VPS? (nas-dump-check.sh grava "<quando> <rótulo>"; a VPS só
# repassa os dois campos validados). Sem pedido, nada a fazer; com pedido, é um dump pre-migrate com esse rótulo.
if [ -n "$pedido" ]; then
  out=$($receipt_ssh "$VPS_USER@$VPS_HOST" pedido 2>&1) || { log warn "não deu para consultar o pedido de dump na VPS: $out"; exit 0; }
  case "$out" in *"recibo pedido ok"*) ;; *) log warn "a VPS não entendeu 'pedido' (chave de recibo com o comando antigo? rode preparar-replica.sh): $out"; exit 0 ;; esac
  linha=$(printf '%s\n' "$out" | sed -n 's/^pedido \([0-9T:Z-]\{20\}\) \([A-Za-z0-9._-]\{1,100\}\)$/\1 \2/p' | head -n 1)
  [ -n "$linha" ] || exit 0
  label="${linha#* }"
  mode=pre-migrate
  log info "pedido de dump do deploy na VPS (de ${linha%% *}, rótulo $label): dump pre-migrate começando"
fi

# 1. É a réplica, em recuperação? Replay pausado à mão: retoma (ou avisa).
pg_isready -q -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" || fail "a réplica não responde (serviço postgres da stack nas-replica fora do ar ou ainda no basebackup)"
in_recovery=$(psql_replica "select pg_is_in_recovery()") || fail "não deu para consultar a réplica"
[ "$in_recovery" = t ] || fail "a réplica NÃO está em recuperação (foi promovida? cópia divergente): sem dump. Refaça a réplica (runbook › Refazer a réplica)"
if [ "$(psql_replica "select pg_is_wal_replay_paused()" 2>/dev/null || echo f)" = t ]; then
  if psql_replica "select pg_wal_replay_resume()" >/dev/null 2>&1; then
    log warn "o replay da réplica estava pausado (alguém pausou à mão): retomado antes do dump"
  else
    log warn "o replay da réplica está pausado e este papel não pode retomar: rode 'select pg_wal_replay_resume()' como superusuário na réplica; o dump sai do ponto em que o replay parou"
  fi
fi

# 2. Atraso e slot.
replay_lsn=$(psql_replica "select coalesce(pg_last_wal_replay_lsn()::text, '')")
receive_lsn=$(psql_replica "select coalesce(pg_last_wal_receive_lsn()::text, '')")
lag_mb=""
slot_info=""
if primary_lsn=$(psql_primary "select pg_current_wal_lsn()") && [ -n "$primary_lsn" ] && [ -n "$replay_lsn" ]; then
  lag_mb=$(psql_replica "select (pg_wal_lsn_diff('$primary_lsn', '$replay_lsn') / 1048576)::bigint")
  slot_info=$(psql_primary "select coalesce(active::text, '') || ' ' || coalesce(wal_status, '') from pg_replication_slots where slot_name = '$REPLICA_SLOT'") || slot_info=""
  case "$slot_info" in
    '') log warn "slot $REPLICA_SLOT não existe na produção: a réplica não está protegida (refaça com pg_basebackup -C -S)" ;;
    *lost*) fail "slot $REPLICA_SLOT na produção com wal_status=lost: a produção já apagou WAL que a réplica precisa. Refaça a réplica (runbook › Refazer a réplica)" ;;
    f*) log warn "slot $REPLICA_SLOT inativo na produção: a réplica não está recebendo WAL agora (túnel ou walreceiver; veja o log do serviço postgres)" ;;
  esac
else
  log warn "sem acesso à produção pelo túnel (REPLICATOR_PASSWORD vazia ou túnel caído): o atraso é o que a réplica sabe"
  if [ -n "$receive_lsn" ] && [ -n "$replay_lsn" ]; then
    lag_mb=$(psql_replica "select (pg_wal_lsn_diff('$receive_lsn', '$replay_lsn') / 1048576)::bigint")
  fi
fi
if [ -n "$lag_mb" ] && [ "$lag_mb" -gt "$DUMP_MAX_LAG_MB" ]; then
  fail "réplica atrasada: $lag_mb MB de WAL por aplicar (máximo DUMP_MAX_LAG_MB=$DUMP_MAX_LAG_MB). Espere alcançar (select pg_last_xact_replay_timestamp() na réplica) e peça o dump de novo"
fi
replay_at=$(psql_replica "select coalesce(pg_last_xact_replay_timestamp()::text, '')")

# 3. Disco.
last=$(dumps_in "$NAS_DIR/daily" | tail -n 1)
need=$((1024 * 1024 * 1024))
[ -z "$last" ] || need=$(($(wc -c <"$last") * 13 / 10))
free=$(($(df -Pk "$NAS_DIR" | awk 'NR == 2 { print $4 }') * 1024))
[ "$free" -ge "$need" ] || fail "pouco espaço em $NAS_DIR: $((free / 1048576)) MB livres, o dump precisa de ~$((need / 1048576)) MB"

# 4. O dump.
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [ "$mode" = pre-migrate ]; then
  dir="$NAS_DIR/pre-migrate"
  name="${DUMP_PREFIX}pre-migrate_${stamp}_$label.dump"
else
  dir="$NAS_DIR/daily"
  name="${DUMP_PREFIX}${stamp}.dump"
fi
# o dump em claro (plain) e o arquivo final em construção (tmp): sem cifragem são o mesmo arquivo (nada de mv de um
# arquivo sobre ele mesmo, que o mv do Linux recusa); com age, o .age é gerado a partir do em claro, que some
plain="$NAS_DIR/incoming/$name.partial"
tmp="$plain"
if [ -n "$DUMP_AGE_RECIPIENTS" ]; then
  recipients=$(mktemp)
  printf '%s\n' "$DUMP_AGE_RECIPIENTS" | tr ', \t' '\n\n\n' | sed '/^$/d' >"$recipients"
  if [ ! -s "$recipients" ] || grep -qv '^age1[02-9ac-hj-np-z]\{58\}$' "$recipients"; then
    fail "DUMP_AGE_RECIPIENTS inválido: use chaves públicas do age (age1…)"
  fi
  name="$name.age"
  tmp="$NAS_DIR/incoming/$name.partial"
fi

log info "pg_dump para $name começando (réplica em $replay_lsn; última transação aplicada: ${replay_at:-?})"
started=$(date +%s)
# shellcheck disable=SC2046,SC2086 # uma opção por tabela da lista
set -- $(for t in $DUMP_EXCLUDE_TABLE_DATA; do echo "--exclude-table-data=$t"; done)
pg_dump --format=custom --compress="$DUMP_COMPRESS" --no-owner --no-privileges "$@" --file="$plain" || fail "pg_dump na réplica falhou"
pg_restore --list "$plain" >/dev/null || fail "o dump gerado não é legível pelo pg_restore"
if [ -n "$recipients" ]; then
  age -R "$recipients" -o "$tmp" "$plain" || fail "age não cifrou o dump"
  rm -f "$plain"
fi
plain=""

# 5. Guarda, com o .sha256, e a retenção.
mv "$tmp" "$dir/$name"
tmp=""
(cd "$dir" && sha256sum "$name" >"$name.sha256")
bytes=$(wc -c <"$dir/$name" | tr -d ' ')
if [ "$mode" = pre-migrate ]; then
  count=$(ls -1 "$dir"/*.dump "$dir"/*.dump.age 2>/dev/null | sort | wc -l)
  if [ "$count" -gt "$PRE_MIGRATE_KEEP" ]; then
    ls -1 "$dir"/*.dump "$dir"/*.dump.age 2>/dev/null | sort | head -n "$((count - PRE_MIGRATE_KEEP))" | while read -r old; do
      rm -f "$old" "$old.sha256"
    done
  fi
else
  rotate_dumps
fi
duration=$(($(date +%s) - started))
log info "dump gravado: $dir/$name ($((bytes / 1048576)) MB, ${duration} s${lag_mb:+; atraso da réplica no início: $lag_mb MB})"

# 6. Recibo na VPS: "dump <quando> <bytes> <arquivo>" pelo comando forçado da chave de recibo (apaga o pedido atendido).
when=$(date -u +%Y-%m-%dT%H:%M:%SZ)
out=$($receipt_ssh "$VPS_USER@$VPS_HOST" "dump $when $bytes $name" 2>&1) || fail "recibo na VPS falhou (o dump ficou em $dir/$name): $out"
case "$out" in
  *"recibo dump ok"*) ;;
  *) fail "a VPS não gravou o recibo .nas_last_dump (o dump ficou em $dir/$name). A chave de recibo ainda tem o comando antigo? Rode preparar-replica.sh na VPS. Resposta: $out" ;;
esac

# 7. Cópia fora de casa (opcional).
offsite=""
if [ -n "$OFFSITE_RCLONE_REMOTE" ]; then
  if [ -z "$recipients" ] && [ "$OFFSITE_ALLOW_PLAINTEXT" != true ]; then
    fail "OFFSITE_RCLONE_REMOTE definido mas o dump está em claro (DUMP_AGE_RECIPIENTS vazio): a cópia fora de casa só vai cifrada (ou OFFSITE_ALLOW_PLAINTEXT=true). O dump e o recibo estão feitos"
  fi
  rclone copyto --s3-no-check-bucket "$dir/$name" "$OFFSITE_RCLONE_REMOTE/$name" || fail "rclone não enviou $name para $OFFSITE_RCLONE_REMOTE (o dump e o recibo estão feitos)"
  rclone copyto --s3-no-check-bucket "$dir/$name.sha256" "$OFFSITE_RCLONE_REMOTE/$name.sha256" || fail "rclone não enviou $name.sha256 (o dump e o recibo estão feitos)"
  # só os OFFSITE_KEEP mais novos ficam lá (o nome leva o horário: ordem de nome = ordem de tempo); os pre-migrate contam
  rclone lsf --files-only "$OFFSITE_RCLONE_REMOTE" | grep -E "^${DUMP_PREFIX}.*\.dump(\.age)?$" | sort | head -n "-$OFFSITE_KEEP" | while read -r old; do
    rclone deletefile "$OFFSITE_RCLONE_REMOTE/$old" && rclone deletefile "$OFFSITE_RCLONE_REMOTE/$old.sha256" || true
  done
  offsite="; cópia fora de casa em $OFFSITE_RCLONE_REMOTE ($OFFSITE_KEEP mais novos)"
fi

summary="$mode $name ($((bytes / 1048576)) MB, ${duration} s); $(dumps_summary); recibo na VPS $when$offsite"
state "ok: $summary"
log info "dump da réplica OK: $summary"
