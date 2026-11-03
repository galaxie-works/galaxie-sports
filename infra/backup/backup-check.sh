#!/bin/sh
# Verificador do backup, rodado pelo agendador a cada BACKUP_CHECK_INTERVAL_H horas (e avulso):
#   backup-check.sh
# Acusa (job_run "backup-check" com erro → alerta BackupCheckFailed) quando:
#   - o dump mais recente em BACKUP_DIR tem mais de BACKUP_MAX_AGE_H horas (padrão 26), ou não há dump;
#   - com BACKUP_NAS_RECEIPT=true, o recibo do NAS ($BACKUP_DIR/.nas_last_pull, que o NAS toca depois de copiar;
#     ver docs/runbooks/exercicio-dr.md) tem mais de BACKUP_MAX_AGE_H horas, ou não existe;
#   - com BACKUP_S3_SYNC_PREFIXES ou BACKUP_S3_SYNC_TASKS_BUCKET=true, o recibo do sync do S3 ($BACKUP_DIR/.s3_last_sync,
#     que o s3-sync.sh grava depois de copiar tudo) tem mais de BACKUP_MAX_AGE_H horas, ou não existe.
set -eu
# shellcheck source=infra/backup/lib.sh
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"
: "${BACKUP_NAS_RECEIPT:=false}"

max_s=$((BACKUP_MAX_AGE_H * 3600))
run_id=$(job_start backup-check)
problems=""
add() { problems="${problems:+$problems; }$1"; }

dump=$(latest_dump)
dump_age=-1
if [ -z "$dump" ]; then
  add "nenhum dump em $BACKUP_DIR"
else
  dump_age=$(file_age_s "$dump")
  [ "$dump_age" -le "$max_s" ] || add "último dump ($(basename "$dump")) tem $((dump_age / 3600)) h (máximo ${BACKUP_MAX_AGE_H} h)"
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

stats="{\"dump\":\"$(basename "${dump:-}")\",\"dump_age_s\":$dump_age,\"nas_receipt\":$BACKUP_NAS_RECEIPT,\"nas_age_s\":$nas_age,\"s3_sync\":$s3_sync,\"s3_age_s\":$s3_age}"
if [ -n "$problems" ]; then
  log error "verificação do backup: $problems"
  job_finish "$run_id" error "$problems" "$stats"
  exit 1
fi
job_finish "$run_id" ok "" "$stats"
log info "verificação do backup OK: $(basename "$dump") há $((dump_age / 60)) min$([ "$nas_age" -ge 0 ] && echo "; NAS há $((nas_age / 60)) min")$([ "$s3_age" -ge 0 ] && echo "; sync do S3 há $((s3_age / 60)) min")"
