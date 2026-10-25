#!/bin/sh
# Restaura um dump do backup.sh.
#
#   restore.sh --list                         # dumps disponíveis (local e, se configurado, S3)
#   restore.sh --verify latest                # ensaio: restaura num banco temporário, confere e apaga (não toca no banco real)
#   restore.sh --yes latest                   # restaura o mais recente POR CIMA do banco PGDATABASE
#   restore.sh --yes galaxie_sports_20261021T033000Z.dump
#   restore.sh --yes s3://bucket/postgres/galaxie_sports_20261021T033000Z.dump
#   restore.sh --yes --no-checksum <dump>     # sem o .sha256 ao lado (só quando ele se perdeu de verdade)
#
# A restauração real é feita num banco novo (<db>_restoring), conferida e só então trocada pelo nome:
# o banco anterior fica guardado como <db>_pre_restore_<data> para rollback (apague quando não precisar mais).
# Pare API e ingestor antes (ver infra/portainer/README.md) — conexões abertas ao banco antigo são encerradas.
set -eu
. /usr/local/lib/galaxie-backup/lib.sh

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

mode=restore
confirmed=false
checksum=true
source_arg=""
for a in "$@"; do
  case "$a" in
    --verify) mode=verify ;;
    --yes) confirmed=true ;;
    --list) mode=list ;;
    --no-checksum) checksum=false ;;
    -h | --help) usage ;;
    *) source_arg="$a" ;;
  esac
done

if [ "$mode" = list ]; then
  ls -1t "$BACKUP_DIR"/"${PGDATABASE}"_*.dump 2>/dev/null || true
  if s3_enabled; then aws_s3 ls "$(s3_uri)/" || true; fi
  exit 0
fi
[ -n "$source_arg" ] || usage

# ── resolve o arquivo ───────────────────────────────────────────────────────────────────────────
case "$source_arg" in
  latest)
    file=$(ls -1t "$BACKUP_DIR"/"${PGDATABASE}"_*.dump 2>/dev/null | head -n 1 || true)
    [ -n "$file" ] || { log error "nenhum dump em $BACKUP_DIR"; exit 1; }
    ;;
  s3://*)
    file="$BACKUP_DIR/$(basename "$source_arg")"
    log info "baixando $source_arg"
    aws_s3 cp --only-show-errors "$source_arg" "$file"
    aws_s3 cp --only-show-errors "$source_arg.sha256" "$file.sha256" || log warn "não deu para baixar $source_arg.sha256"
    ;;
  /*) file="$source_arg" ;;
  *) file="$BACKUP_DIR/$source_arg" ;;
esac
[ -f "$file" ] || { log error "arquivo não encontrado: $file"; exit 1; }
# O backup.sh grava o .sha256 ao lado de cada dump (local e S3): sem ele não dá para saber se o arquivo está inteiro.
if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum -c -s "$(basename "$file").sha256") ||
    { log error "checksum não confere: $file"; exit 1; }
elif [ "$checksum" = true ]; then
  log error "sem $file.sha256 para conferir o dump; repita com --no-checksum se tiver certeza de que o arquivo está inteiro"
  exit 1
else
  log warn "restaurando sem conferir o checksum (--no-checksum): $file"
fi

target="$PGDATABASE"
if [ "$mode" = verify ]; then work="${target}_restore_check"; else work="${target}_restoring"; fi
admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }

if [ "$mode" = restore ] && [ "$confirmed" != true ]; then
  log error "restauração real substitui o banco $target; repita com --yes (ou use --verify para ensaiar)"
  exit 1
fi

# ── restaura num banco novo ─────────────────────────────────────────────────────────────────────
log info "restaurando $(basename "$file") em $work"
admin -c "drop database if exists \"$work\" with (force)"
admin -c "create database \"$work\""
if ! pg_restore --no-owner --no-privileges --exit-on-error --jobs="${RESTORE_JOBS:-2}" -d "$work" "$file"; then
  log error "pg_restore falhou; banco $target intacto"
  admin -c "drop database if exists \"$work\" with (force)"
  exit 1
fi

# Execuções "running" no momento do dump nunca terminam neste estado restaurado. A do pg-backup é justamente
# o backup que gerou este arquivo (deu certo); as demais ficam como interrompidas.
psql -X -q -d "$work" -c "
  update ops.job_run set status = 'ok', finished_at = now(), error = null where status = 'running' and job = 'pg-backup';
  update ops.job_run set status = 'error', finished_at = now(), error = 'interrompido: estado restaurado de backup' where status = 'running';
" >/dev/null 2>&1 || true

# ── conferência ─────────────────────────────────────────────────────────────────────────────────
counts=$(psql -X -t -A -F '=' -d "$work" -c "
  select 'raw.api_response', count(*) from raw.api_response
  union all select 'ops.quota_ledger', count(*) from ops.quota_ledger
  union all select 'ops.job_run', count(*) from ops.job_run
  union all select 'core.event', count(*) from core.event
  union all select 'migrations', count(*) from drizzle.__drizzle_migrations" 2>/dev/null | tr '\n' ' ') ||
  counts=""
[ -n "$counts" ] || { log error "o banco restaurado não tem o schema esperado"; admin -c "drop database if exists \"$work\" with (force)"; exit 1; }
log info "conferência do banco restaurado: $counts"

if [ "$mode" = verify ]; then
  admin -c "drop database \"$work\" with (force)"
  log info "ensaio de restauração OK: $(basename "$file") é restaurável"
  exit 0
fi

# ── troca pelo nome (o banco antigo fica para rollback) ─────────────────────────────────────────
previous="${target}_pre_restore_$(date -u +%Y%m%dT%H%M%SZ)"
# Bloqueia novas conexões antes de derrubar as abertas (pools da API/ingestor reconectariam no meio da troca).
admin -c "alter database \"$target\" with allow_connections false"
admin -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$target' and pid <> pg_backend_pid()" >/dev/null
admin -c "alter database \"$target\" rename to \"$previous\""
admin -c "alter database \"$work\" rename to \"$target\""
log info "restauração concluída: $target agora contém $(basename "$file"); banco anterior guardado como $previous (sem conexões; ver rollback no README)"
