#!/bin/sh
# Dump completo do Postgres (formato custom, comprimido), validado, com retenção local e cópia opcional para S3.
#   backup.sh                  # um backup agora
# Variáveis: BACKUP_DIR (/backups), BACKUP_KEEP_DAILY (7 dumps), BACKUP_COMPRESS (zstd:5),
#            BACKUP_S3_BUCKET / BACKUP_S3_PREFIX / BACKUP_S3_ENDPOINT + AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
set -eu
# shellcheck source=infra/backup/lib.sh
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"

mkdir -p "$BACKUP_DIR"
started=$(date -u +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$BACKUP_DIR/${PGDATABASE}_${stamp}.dump"
tmp="$file.partial"
# cifrado: o dump em claro existe só durante esta execução (conferência do pg_restore) e sai como .dump.age
recipients=""
if age_enabled; then
  plain="$tmp"
  file="$file.age"
  tmp="$file.partial"
fi
run_id=$(job_start pg-backup)
# o dump em claro não fica no volume nem se a execução for interrompida (TERM/INT do docker stop); o que sobrou de
# uma execução morta sem aviso sai aqui (mais velho que 12 h) e na partida do agendador
clean_plaintext 720
trap 'rm -f "${plain:-}" "$tmp" "$recipients"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

fail() {
  rm -f "$tmp" "${plain:-}" "$recipients"
  log error "backup falhou: $1"
  job_finish "$run_id" error "$1" '{}'
  exit 1
}

# destinatário inválido não vira dump em claro: o backup falha (e o alerta do job dispara)
if age_enabled; then
  recipients=$(age_recipients_file) || fail "BACKUP_AGE_RECIPIENTS inválido: use chaves públicas do age (age1…)"
fi

log info "iniciando pg_dump para $file"
pg_dump --format=custom --compress="${BACKUP_COMPRESS:-zstd:5}" --no-owner --no-privileges --file="${plain:-$tmp}" ||
  fail "pg_dump retornou erro"
# Um dump que o pg_restore não consegue listar não é backup.
pg_restore --list "${plain:-$tmp}" >/dev/null || fail "arquivo gerado não é legível pelo pg_restore"
if [ -n "$recipients" ]; then
  age -R "$recipients" -o "$tmp" "$plain" || fail "age não cifrou o dump"
  rm -f "$plain" "$recipients"
  # com a chave do ensaio, confere já que o arquivo cifrado decifra num dump legível
  if id=$(age_identity_file); then
    age -d -i "$id" "$tmp" | pg_restore --list >/dev/null || {
      rm -f "$id"
      fail "o dump cifrado não decifra com a chave do ensaio (BACKUP_AGE_IDENTITY fora de BACKUP_AGE_RECIPIENTS?)"
    }
    rm -f "$id"
  fi
fi
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

# Retenção local: os BACKUP_KEEP_DAILY dumps mais recentes (a remota usa regra de ciclo de vida do bucket; o NAS, a
# rotação dele).
deleted=$(prune_dumps)

duration=$(($(date -u +%s) - started))
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$file" >"$BACKUP_DIR/.last_success"
job_finish "$run_id" ok "" "{\"file\":\"$(basename "$file")\",\"bytes\":$size,\"duration_s\":$duration,\"uploaded\":$uploaded,\"deleted_old\":$deleted}"
log info "backup concluído: $(basename "$file") ($size bytes, ${duration}s, remota=$uploaded, removidos=$deleted)"
