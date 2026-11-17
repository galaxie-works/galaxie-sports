#!/bin/sh
# Verificador do backup, rodado pelo agendador a cada BACKUP_CHECK_INTERVAL_H horas (e avulso):
#   backup-check.sh
# Acusa (job_run "backup-check" com erro → alerta BackupCheckFailed) quando:
#   - com BACKUP_DUMP_SOURCE=vps (padrão): o dump mais recente em BACKUP_DIR tem mais de BACKUP_MAX_AGE_H horas (padrão
#     26), ou não há dump;
#   - com BACKUP_DUMP_SOURCE=nas (o diário vem da réplica do NAS; docs/runbooks/replica-no-nas.md): não há prova de
#     backup com até BACKUP_MAX_AGE_H horas, sendo prova o recibo $BACKUP_DIR/.nas_last_dump (que o dump.sh do NAS grava
#     pelo comando forçado da chave de recibo, "<quando> <bytes> <arquivo>") OU o dump local mais recente, o que for
#     mais novo; e, à parte, quando o dump local (o semanal, BACKUP_DAYS) tem mais de BACKUP_LOCAL_MAX_AGE_H horas
#     (padrão 192 = 8 dias). O recibo fresco vira uma linha `nas-dump` em ops.job_run com a hora real do dump
#     (lib.sh › job_record): é o que alimenta NasDumpStale e cala o BackupStale no Prometheus;
#   - com BACKUP_NAS_RECEIPT=true, o recibo do NAS ($BACKUP_DIR/.nas_last_pull, que o NAS toca depois de copiar;
#     ver docs/runbooks/exercicio-dr.md) tem mais de BACKUP_MAX_AGE_H horas, ou não existe;
#   - com BACKUP_S3_SYNC_PREFIXES ou BACKUP_S3_SYNC_TASKS_BUCKET=true, o recibo do sync do S3 ($BACKUP_DIR/.s3_last_sync,
#     que o s3-sync.sh grava depois de copiar tudo) tem mais de BACKUP_MAX_AGE_H horas, ou não existe.
set -eu
# shellcheck source=infra/backup/lib.sh
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"
: "${BACKUP_NAS_RECEIPT:=false}"
: "${BACKUP_DUMP_SOURCE:=vps}"
: "${BACKUP_LOCAL_MAX_AGE_H:=192}"
case "$BACKUP_DUMP_SOURCE" in vps | nas) ;; *)
  log error "BACKUP_DUMP_SOURCE='$BACKUP_DUMP_SOURCE' inválido (vps ou nas)"
  exit 1
  ;;
esac

max_s=$((BACKUP_MAX_AGE_H * 3600))
run_id=$(job_start backup-check)
problems=""
add() { problems="${problems:+$problems; }$1"; }

dump=$(latest_dump)
dump_age=-1
[ -z "$dump" ] || dump_age=$(file_age_s "$dump")

nas_dump_age=-1
nas_dump_name=""
if [ "$BACKUP_DUMP_SOURCE" = vps ]; then
  if [ -z "$dump" ]; then
    add "nenhum dump em $BACKUP_DIR"
  else
    [ "$dump_age" -le "$max_s" ] || add "último dump ($(basename "$dump")) tem $((dump_age / 3600)) h (máximo ${BACKUP_MAX_AGE_H} h)"
  fi
else
  receipt="$BACKUP_DIR/.nas_last_dump"
  nas_why=""
  if [ ! -f "$receipt" ]; then
    nas_why="sem recibo do dump do NAS ($receipt)"
  else
    read -r when bytes name <"$receipt" || true
    nas_dump_age=$(file_age_s "$receipt")
    if [ -z "${name:-}" ] || ! printf '%s' "${bytes:-}" | grep -Eq '^[0-9]+$'; then
      nas_why="recibo do dump do NAS ilegível"
      nas_dump_age=-1
    else
      nas_dump_name="$name"
      if [ "$nas_dump_age" -le "$max_s" ]; then
        # a hora real do dump vai para ops.job_run (uma linha por recibo): métrica do NasDumpStale
        job_record nas-dump "$when" "{\"file\":\"$name\",\"bytes\":$bytes,\"receipt_age_s\":$nas_dump_age}"
      else
        nas_why="último dump do NAS ($name) há $((nas_dump_age / 3600)) h"
      fi
    fi
  fi
  if [ -n "$nas_why" ]; then
    if [ -n "$dump" ] && [ "$dump_age" -le "$max_s" ]; then
      log warn "$nas_why; vale o dump local $(basename "$dump") (há $((dump_age / 60)) min)"
    else
      add "sem prova de backup recente: $nas_why; dump local ${dump:+$(basename "$dump") há $((dump_age / 3600)) h}${dump:-nenhum} (máximo ${BACKUP_MAX_AGE_H} h)"
    fi
  fi
  # o dump local semanal ainda é cobrado, com folga de uma semana
  if [ -z "$dump" ]; then
    add "nenhum dump local em $BACKUP_DIR (o semanal da VPS, BACKUP_DAYS)"
  else
    [ "$dump_age" -le $((BACKUP_LOCAL_MAX_AGE_H * 3600)) ] || add "dump local ($(basename "$dump")) tem $((dump_age / 3600)) h (máximo BACKUP_LOCAL_MAX_AGE_H=${BACKUP_LOCAL_MAX_AGE_H} h)"
  fi
fi

nas_age=-1
if [ "$BACKUP_NAS_RECEIPT" = true ]; then
  receipt="$BACKUP_DIR/.nas_last_pull"
  if [ ! -f "$receipt" ]; then
    add "sem recibo da cópia do NAS ($receipt)"
  else
    nas_age=$(file_age_s "$receipt")
    [ "$nas_age" -le "$max_s" ] || add "última cópia do NAS há $((nas_age / 3600)) h (máximo ${BACKUP_MAX_AGE_H} h)"
  fi
fi

s3_age=-1
s3_sync=false
if s3_sync_enabled; then
  s3_sync=true
  receipt=$(s3_sync_receipt)
  if [ ! -f "$receipt" ]; then
    add "sem recibo do sync do S3 ($receipt)"
  else
    s3_age=$(file_age_s "$receipt")
    [ "$s3_age" -le "$max_s" ] || add "último sync do S3 há $((s3_age / 3600)) h (máximo ${BACKUP_MAX_AGE_H} h)"
  fi
fi

stats="{\"dump\":\"$(basename "${dump:-}")\",\"dump_age_s\":$dump_age,\"dump_source\":\"$BACKUP_DUMP_SOURCE\",\"nas_dump\":\"$nas_dump_name\",\"nas_dump_age_s\":$nas_dump_age,\"nas_receipt\":$BACKUP_NAS_RECEIPT,\"nas_age_s\":$nas_age,\"s3_sync\":$s3_sync,\"s3_age_s\":$s3_age}"
if [ -n "$problems" ]; then
  log error "verificação do backup: $problems"
  job_finish "$run_id" error "$problems" "$stats"
  exit 1
fi
job_finish "$run_id" ok "" "$stats"
log info "verificação do backup OK: $(basename "${dump:-nenhum dump local}") há $((dump_age / 60)) min$([ "$nas_dump_age" -ge 0 ] && echo "; dump do NAS $nas_dump_name há $((nas_dump_age / 60)) min")$([ "$nas_age" -ge 0 ] && echo "; NAS há $((nas_age / 60)) min")$([ "$s3_age" -ge 0 ] && echo "; sync do S3 há $((s3_age / 60)) min")"
