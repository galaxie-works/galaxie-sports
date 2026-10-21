#!/bin/sh
# Dump completo do Postgres (formato custom, comprimido), validado, com retenção local e cópia opcional para S3.
#   backup.sh                  # um backup agora
# Variáveis: BACKUP_DIR (/backups), BACKUP_RETENTION_DAYS (30), BACKUP_COMPRESS (zstd:5),
#            BACKUP_S3_BUCKET / BACKUP_S3_PREFIX / BACKUP_S3_ENDPOINT + AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
set -eu
. /usr/local/lib/galaxie-backup/lib.sh

mkdir -p "$BACKUP_DIR"
started=$(date -u +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$BACKUP_DIR/${PGDATABASE}_${stamp}.dump"
tmp="$file.partial"
run_id=$(job_start pg-backup)

fail() {
  rm -f "$tmp"
  log error "backup falhou: $1"
  job_finish "$run_id" error "$1" '{}'
  exit 1
}

log info "iniciando pg_dump para $file"
pg_dump --format=custom --compress="${BACKUP_COMPRESS:-zstd:5}" --no-owner --no-privileges --file="$tmp" ||
  fail "pg_dump retornou erro"
# Um dump que o pg_restore não consegue listar não é backup.
pg_restore --list "$tmp" >/dev/null || fail "arquivo gerado não é legível pelo pg_restore"
mv "$tmp" "$file"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" >"$(basename "$file").sha256")
size=$(wc -c <"$file" | tr -d ' ')

uploaded=false
if s3_enabled; then
  dest="$(s3_uri)/$(basename "$file")"
  if aws_s3 cp --only-show-errors "$file" "$dest" && aws_s3 cp --only-show-errors "$file.sha256" "$dest.sha256"; then
    uploaded=true
    log info "cópia remota enviada para $dest"
  else
    fail "falha ao enviar a cópia remota para $dest"
  fi
fi

# Retenção local: apaga dumps com mais de BACKUP_RETENTION_DAYS dias (a remota usa regra de ciclo de vida do bucket).
deleted=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PGDATABASE}_*.dump*" -mtime +"$BACKUP_RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')

duration=$(($(date -u +%s) - started))
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$file" >"$BACKUP_DIR/.last_success"
job_finish "$run_id" ok "" "{\"file\":\"$(basename "$file")\",\"bytes\":$size,\"duration_s\":$duration,\"uploaded\":$uploaded,\"deleted_old\":$deleted}"
log info "backup concluído: $(basename "$file") ($size bytes, ${duration}s, remota=$uploaded, removidos=$deleted)"
