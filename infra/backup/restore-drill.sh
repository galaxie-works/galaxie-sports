#!/bin/sh
# Ensaio de restauração (mensal, pelo agendador; ou avulso): restaura o dump mais recente num banco TEMPORÁRIO
# (<PGDATABASE>_drill_<data>, nunca o de produção), confere a sanidade, registra o resultado em ops.job_run do banco
# de produção (job "pg-restore-drill" → métricas e alertas RestoreDrillFailed/RestoreDrillStale) e apaga o temporário.
#   restore-drill.sh
# Conferências:
#   - o dump tem no máximo RESTORE_DRILL_MAX_DUMP_AGE_H horas (padrão BACKUP_MAX_AGE_H, 26) e o .sha256 confere;
#   - há espaço: livre no disco dos volumes >= RESTORE_DRILL_SPACE_FACTOR (2) x tamanho do banco de produção;
#   - pg_restore sem erro;
#   - migrations aplicadas no restaurado: > 0 e não mais que na produção;
#   - cada tabela de RESTORE_DRILL_TABLES tem linhas;
#   - a última atualização de partida (core.event.updated_at) está a no máximo RESTORE_DRILL_EVENT_MAX_AGE_H horas
#     (padrão 72; 0 desliga) antes do dump.
set -eu
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"
: "${RESTORE_DRILL_MAX_DUMP_AGE_H:=$BACKUP_MAX_AGE_H}"
: "${RESTORE_DRILL_SPACE_FACTOR:=2}"
: "${RESTORE_DRILL_TABLES:=core.competition core.event raw.api_response ops.job_run}"
: "${RESTORE_DRILL_EVENT_MAX_AGE_H:=72}"

prod="$PGDATABASE"
prefix="${prod}_drill_"
work="${prefix}$(date -u +%Y%m%d%H%M%S)"
# trava contra engano: o temporário nunca é o banco de produção e sempre tem o sufixo do ensaio
case "$work" in "$prefix"[0-9]*) ;; *)
  log error "nome do banco temporário inválido: $work"
  exit 1
  ;;
esac
[ "$work" != "$prod" ] || exit 1

admin() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d postgres "$@"; }
in_work() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$work" -c "$1"; }
in_prod() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$prod" -c "$1"; }
drop_work() { admin -c "drop database if exists \"$work\" with (force)" >/dev/null 2>&1 || true; }

started=$(date -u +%s)
run_id=$(job_start pg-restore-drill)
dump=""
finish_fail() {
  drop_work
  log error "ensaio de restauração falhou: $1"
  job_finish "$run_id" error "$1" "{\"dump\":\"$(basename "${dump:-}")\",\"db\":\"$work\"}"
  exit 1
}
trap drop_work EXIT

# Temporários de um ensaio interrompido (contêiner reiniciado no meio) não ficam ocupando disco.
for old in $(admin -c "select datname from pg_database where datname like '${prefix}%'"); do
  case "$old" in "$prefix"[0-9]*)
    log warn "apagando banco de ensaio anterior que ficou para trás: $old"
    admin -c "drop database if exists \"$old\" with (force)" >/dev/null
    ;;
  esac
done

dump=$(latest_dump)
[ -n "$dump" ] || finish_fail "nenhum dump em $BACKUP_DIR"
age=$(file_age_s "$dump")
[ "$age" -le $((RESTORE_DRILL_MAX_DUMP_AGE_H * 3600)) ] ||
  finish_fail "dump mais recente ($(basename "$dump")) tem $((age / 3600)) h (máximo ${RESTORE_DRILL_MAX_DUMP_AGE_H} h)"
[ -f "$dump.sha256" ] || finish_fail "sem $(basename "$dump").sha256"
(cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256" >/dev/null 2>&1) ||
  finish_fail "checksum não confere: $(basename "$dump")"

# Espaço: o volume de backups fica no mesmo disco dos volumes do Postgres (padrão do Docker), então o livre dele
# é o livre para o banco temporário. A restauração ocupa ~ o tamanho do banco (mais índices e WAL).
db_bytes=$(in_prod "select pg_database_size(current_database())")
free_bytes=$(($(df -Pk "$BACKUP_DIR" | awk 'NR == 2 { print $4 }') * 1024))
need=$((db_bytes * RESTORE_DRILL_SPACE_FACTOR))
[ "$free_bytes" -ge "$need" ] ||
  finish_fail "espaço insuficiente para o ensaio: livre $((free_bytes / 1048576)) MiB, precisa de $((need / 1048576)) MiB"

log info "ensaio: restaurando $(basename "$dump") em $work"
admin -c "create database \"$work\"" >/dev/null || finish_fail "não deu para criar $work"
restore_started=$(date -u +%s)
pg_restore --no-owner --no-privileges --exit-on-error --jobs="${RESTORE_JOBS:-2}" -d "$work" "$dump" ||
  finish_fail "pg_restore falhou"
restore_s=$(($(date -u +%s) - restore_started))

# ── sanidade ──────────────────────────────────────────────────────────────────────────────────────
mig_work=$(in_work "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null) ||
  finish_fail "o restaurado não tem drizzle.__drizzle_migrations"
mig_prod=$(in_prod "select count(*) from drizzle.__drizzle_migrations")
[ "$mig_work" -gt 0 ] || finish_fail "nenhuma migration aplicada no restaurado"
[ "$mig_work" -le "$mig_prod" ] ||
  finish_fail "o restaurado tem mais migrations ($mig_work) que a produção ($mig_prod)"

counts=""
for t in $RESTORE_DRILL_TABLES; do
  n=$(in_work "select count(*) from $t" 2>/dev/null) || finish_fail "tabela $t ausente no restaurado"
  [ "$n" -gt 0 ] || finish_fail "tabela $t vazia no restaurado"
  counts="${counts:+$counts,}\"$t\":$n"
done

last_event=$(in_work "select coalesce(extract(epoch from max(updated_at))::bigint, 0) from core.event" 2>/dev/null) ||
  last_event=0
last_start=$(in_work "select coalesce(to_char(max(starts_at) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '')
  from core.event where starts_at <= now()" 2>/dev/null) || last_start=""
if [ "$RESTORE_DRILL_EVENT_MAX_AGE_H" -gt 0 ]; then
  dump_at=$(stat -c %Y "$dump")
  [ "$last_event" -gt 0 ] || finish_fail "nenhuma partida no restaurado"
  [ $((dump_at - last_event)) -le $((RESTORE_DRILL_EVENT_MAX_AGE_H * 3600)) ] ||
    finish_fail "última atualização de partida $(((dump_at - last_event) / 3600)) h antes do dump (máximo ${RESTORE_DRILL_EVENT_MAX_AGE_H} h)"
fi

drop_work
trap - EXIT
duration=$(($(date -u +%s) - started))
job_finish "$run_id" ok "" "{\"dump\":\"$(basename "$dump")\",\"dump_bytes\":$(wc -c <"$dump" | tr -d ' '),\"restore_s\":$restore_s,\"duration_s\":$duration,\"migrations\":$mig_work,\"migrations_prod\":$mig_prod,\"counts\":{$counts},\"last_event_update\":$last_event,\"last_match_start\":\"$last_start\"}"
log info "ensaio de restauração OK: $(basename "$dump") em ${restore_s}s; migrations $mig_work/$mig_prod; $counts; última partida $last_start"
