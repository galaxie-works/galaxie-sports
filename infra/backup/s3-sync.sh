#!/bin/sh
# Cópia dos prefixos do bucket de assets (RustFS da stack) que valem backup: o que não se refaz a partir do pacote do
# acervo nem da CDN de mídia (logos enviados no painel...) e, com BACKUP_S3_SYNC_TASKS_BUCKET=true, o bucket privado das
# tarefas inteiro (S3_TASKS_BUCKET: pacotes do acervo e relatórios em tasks/<id>/, #587). Opcional: sem
# BACKUP_S3_SYNC_PREFIXES e sem BACKUP_S3_SYNC_TASKS_BUCKET=true, nada acontece.
#   s3-sync.sh                 # um sync agora (o backup.sh chama no fim de cada dump; o entrypoint, na partida)
# Para cada prefixo:
#   1. RustFS → $BACKUP_S3_SYNC_DIR/<prefixo>/ (no volume `backups`: o NAS puxa dali, nas-pull.sh);
#   2. com BACKUP_S3_BUCKET, dali → s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_DEST_PREFIX/<prefixo>/ (padrão: assets/).
# O bucket das tarefas vai inteiro, do mesmo jeito: RustFS → $BACKUP_S3_SYNC_TASKS_DIR/ (s3-tasks/ no volume) e, com
# BACKUP_S3_BUCKET, → s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_TASKS_DEST_PREFIX/ (padrão: tasks/). Bucket vazio é normal
# (nenhuma tarefa com arquivo ainda); bucket que não existe é erro.
# `aws s3 sync` só copia o que mudou. Nada é apagado (BACKUP_S3_SYNC_DELETE=true espelha as remoções): objeto sumido do
# RustFS por engano continua na cópia, e um sync que lê um bucket vazio não esvazia o backup. O bucket remoto guarda
# tudo: sem regra de ciclo de vida, nem para os dumps (decisão de 02/11/2026); a rotação é só a local, por quantidade
# (BACKUP_KEEP_DAILY), e a do NAS.
# Variáveis: BACKUP_S3_SYNC_PREFIXES, BACKUP_S3_SYNC_DIR ($BACKUP_DIR/s3), BACKUP_S3_SYNC_DEST_PREFIX (assets),
#            BACKUP_S3_SYNC_DELETE (false), BACKUP_S3_SYNC_TASKS_BUCKET (false), BACKUP_S3_SYNC_TASKS_DIR
#            ($BACKUP_DIR/s3-tasks), BACKUP_S3_SYNC_TASKS_DEST_PREFIX (tasks),
#            S3_ENDPOINT / S3_BUCKET / S3_TASKS_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY (o RustFS),
#            BACKUP_S3_BUCKET / BACKUP_S3_ENDPOINT + AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (o bucket remoto).
# Registro em ops.job_run (job s3-sync) e recibo $BACKUP_DIR/.s3_last_sync, que o backup-check.sh confere.
set -eu
# shellcheck source=infra/backup/lib.sh
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"

if ! s3_sync_enabled; then
  log info "sync do S3 desligado (BACKUP_S3_SYNC_PREFIXES vazio e BACKUP_S3_SYNC_TASKS_BUCKET != true)"
  exit 0
fi

started=$(date -u +%s)
run_id=$(job_start s3-sync)
fail() {
  log error "sync do S3 falhou: $1"
  job_finish "$run_id" error "$1" '{}'
  exit 1
}

[ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ] ||
  fail "o sync do S3 precisa de S3_ENDPOINT, S3_ACCESS_KEY e S3_SECRET_KEY (o RustFS da stack)"
[ -z "$(s3_sync_prefixes)" ] || [ -n "${S3_BUCKET:-}" ] || fail "BACKUP_S3_SYNC_PREFIXES precisa de S3_BUCKET"
tasks_enabled=false
if s3_sync_tasks_enabled; then
  tasks_enabled=true
  [ -n "${S3_TASKS_BUCKET:-}" ] || fail "BACKUP_S3_SYNC_TASKS_BUCKET=true precisa de S3_TASKS_BUCKET"
  printf '%s' "$S3_TASKS_BUCKET" | grep -q '^[a-z0-9][a-z0-9.-]\{1,62\}$' ||
    fail "S3_TASKS_BUCKET inválido: $S3_TASKS_BUCKET"
  [ "$S3_TASKS_BUCKET" != "${S3_BUCKET:-}" ] || fail "S3_TASKS_BUCKET não pode ser o bucket de assets (S3_BUCKET)"
  s3_sync_prefix_valid "$BACKUP_S3_SYNC_TASKS_DEST_PREFIX" ||
    fail "BACKUP_S3_SYNC_TASKS_DEST_PREFIX inválido: $BACKUP_S3_SYNC_TASKS_DEST_PREFIX"
  # destino próprio no remoto: nem o dos dumps nem o dos assets
  { [ "$BACKUP_S3_SYNC_TASKS_DEST_PREFIX" != "$BACKUP_S3_SYNC_DEST_PREFIX" ] &&
    [ "$BACKUP_S3_SYNC_TASKS_DEST_PREFIX" != "${BACKUP_S3_PREFIX:-postgres}" ]; } ||
    fail "BACKUP_S3_SYNC_TASKS_DEST_PREFIX ($BACKUP_S3_SYNC_TASKS_DEST_PREFIX) colide com o destino dos dumps ou dos assets"
fi
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
  # `aws s3 sync` de um prefixo que não existe (nome errado) termina com sucesso e não copia nada: sem nenhum objeto
  # no espelho, o recibo não sai. Ponha na lista só prefixo que já tem objeto (um novo entra quando receber o primeiro).
  [ -n "$(find "$BACKUP_S3_SYNC_DIR/$p" -type f | head -n 1)" ] ||
    fail "o prefixo $p não tem nenhum objeto no RustFS (nome errado? ponha na lista só prefixos que já têm objetos)"
  if [ "$remote_enabled" = true ]; then
    # shellcheck disable=SC2086
    aws_s3 sync --only-show-errors $delete "$BACKUP_S3_SYNC_DIR/$p/" \
      "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_DEST_PREFIX/$p/" ||
      fail "enviar o prefixo $p para o bucket remoto"
  fi
  prefixes=$((prefixes + 1))
done

# Bucket das tarefas inteiro (privado). Sem a checagem de "nenhum objeto" dos prefixos: vazio é normal.
if [ "$tasks_enabled" = true ]; then
  mkdir -p "$BACKUP_S3_SYNC_TASKS_DIR"
  # shellcheck disable=SC2086
  aws_assets sync --only-show-errors $delete "s3://$S3_TASKS_BUCKET/" "$BACKUP_S3_SYNC_TASKS_DIR/" ||
    fail "copiar o bucket das tarefas ($S3_TASKS_BUCKET) do RustFS"
  if [ "$remote_enabled" = true ]; then
    # shellcheck disable=SC2086
    aws_s3 sync --only-show-errors $delete "$BACKUP_S3_SYNC_TASKS_DIR/" \
      "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_TASKS_DEST_PREFIX/" ||
      fail "enviar o bucket das tarefas para o bucket remoto"
  fi
fi

mkdir -p "$BACKUP_S3_SYNC_DIR"
mirrors="$BACKUP_S3_SYNC_DIR"
[ "$tasks_enabled" = true ] && mirrors="$mirrors $BACKUP_S3_SYNC_TASKS_DIR"
# shellcheck disable=SC2086 # mirrors: uma ou duas pastas, separadas por espaço de propósito
objects=$(find $mirrors -type f | wc -l | tr -d ' ')
# shellcheck disable=SC2086
bytes=$(find $mirrors -type f -exec stat -c %s {} + 2>/dev/null | awk '{s += $1} END {print s + 0}')
duration=$(($(date -u +%s) - started))
receipt_what="$(s3_sync_prefixes | tr '\n' ' ')"
[ "$tasks_enabled" = true ] && receipt_what="${receipt_what}bucket:$S3_TASKS_BUCKET"
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$receipt_what" >"$(s3_sync_receipt)"
job_finish "$run_id" ok "" "{\"prefixes\":$prefixes,\"tasks_bucket\":$tasks_enabled,\"objects\":$objects,\"bytes\":$bytes,\"duration_s\":$duration,\"remote\":$remote_enabled}"
log info "sync do S3 concluído: $prefixes prefixo(s), bucket das tarefas=$tasks_enabled, $objects objeto(s), $bytes bytes, ${duration}s, remoto=$remote_enabled"
