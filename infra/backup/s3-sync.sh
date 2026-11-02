#!/bin/sh
# Cópia dos prefixos do bucket de assets (RustFS da stack) que valem backup: o que não se refaz a partir do pacote do
# acervo nem da CDN de mídia (logos enviados no painel, pacotes de tarefas...). Opcional: sem BACKUP_S3_SYNC_PREFIXES,
# nada acontece.
#   s3-sync.sh                 # um sync agora (o backup.sh chama no fim de cada dump; o entrypoint, na partida)
# Para cada prefixo:
#   1. RustFS → $BACKUP_S3_SYNC_DIR/<prefixo>/ (no volume `backups`: o NAS puxa dali, nas-pull.sh);
#   2. com BACKUP_S3_BUCKET, dali → s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_DEST_PREFIX/<prefixo>/ (padrão: assets/).
# `aws s3 sync` só copia o que mudou. Nada é apagado (BACKUP_S3_SYNC_DELETE=true espelha as remoções): objeto sumido do
# RustFS por engano continua na cópia, e um sync que lê um bucket vazio não esvazia o backup. A retenção do remoto é do
# bucket (versionamento, ou regra de ciclo de vida só no prefixo dos dumps: ver README).
# Variáveis: BACKUP_S3_SYNC_PREFIXES, BACKUP_S3_SYNC_DIR ($BACKUP_DIR/s3), BACKUP_S3_SYNC_DEST_PREFIX (assets),
#            BACKUP_S3_SYNC_DELETE (false), S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY (o RustFS),
#            BACKUP_S3_BUCKET / BACKUP_S3_ENDPOINT + AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (o bucket remoto).
# Registro em ops.job_run (job s3-sync) e recibo $BACKUP_DIR/.s3_last_sync, que o backup-check.sh confere.
set -eu
# shellcheck source=infra/backup/lib.sh
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"

if ! s3_sync_enabled; then
  log info "sync do S3 desligado (BACKUP_S3_SYNC_PREFIXES vazio)"
  exit 0
fi

started=$(date -u +%s)
run_id=$(job_start s3-sync)
fail() {
  log error "sync do S3 falhou: $1"
  job_finish "$run_id" error "$1" '{}'
  exit 1
}

[ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ] ||
  fail "BACKUP_S3_SYNC_PREFIXES precisa de S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY e S3_SECRET_KEY (o RustFS da stack)"
delete=""
[ "$BACKUP_S3_SYNC_DELETE" = true ] && delete="--delete"

remote_enabled=false
s3_enabled && remote_enabled=true

# todos os nomes valem antes de copiar qualquer um (um erro de digitação não deixa o sync pela metade)
for p in $(s3_sync_prefixes); do
  s3_sync_prefix_valid "$p" || fail "prefixo inválido em BACKUP_S3_SYNC_PREFIXES: $p"
done

prefixes=0
for p in $(s3_sync_prefixes); do
  mkdir -p "$BACKUP_S3_SYNC_DIR/$p"
  # shellcheck disable=SC2086 # delete vazio some de propósito
  aws_assets sync --only-show-errors $delete "s3://$S3_BUCKET/$p/" "$BACKUP_S3_SYNC_DIR/$p/" ||
    fail "copiar o prefixo $p do RustFS"
  if [ "$remote_enabled" = true ]; then
    # shellcheck disable=SC2086
    aws_s3 sync --only-show-errors $delete "$BACKUP_S3_SYNC_DIR/$p/" \
      "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_DEST_PREFIX/$p/" ||
      fail "enviar o prefixo $p para o bucket remoto"
  fi
  prefixes=$((prefixes + 1))
done

objects=$(find "$BACKUP_S3_SYNC_DIR" -type f | wc -l | tr -d ' ')
bytes=$(find "$BACKUP_S3_SYNC_DIR" -type f -exec stat -c %s {} + 2>/dev/null | awk '{s += $1} END {print s + 0}')
duration=$(($(date -u +%s) - started))
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(s3_sync_prefixes | tr '\n' ' ')" >"$(s3_sync_receipt)"
job_finish "$run_id" ok "" "{\"prefixes\":$prefixes,\"objects\":$objects,\"bytes\":$bytes,\"duration_s\":$duration,\"remote\":$remote_enabled}"
log info "sync do S3 concluído: $prefixes prefixo(s), $objects objeto(s), $bytes bytes, ${duration}s, remoto=$remote_enabled"
