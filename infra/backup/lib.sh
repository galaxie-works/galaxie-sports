#!/bin/sh
# Funções comuns dos scripts de backup/restore. Conexão via variáveis padrão do libpq:
# PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.

: "${PGDATABASE:?Defina PGDATABASE}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_RETENTION_DAYS:=30}"
# Sem NOTICEs do servidor ("does not exist, skipping") poluindo os logs.
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

# Log em JSON de uma linha (mesmo formato dos serviços Node), para o mesmo coletor de logs.
log() {
  level="$1"
  shift
  msg=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"level":"%s","time":"%s","service":"backup","db":"%s","msg":"%s"}\n' \
    "$level" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PGDATABASE" "$msg"
}

# Executa SQL no banco da aplicação sem ruído (falha silenciosa: o banco pode ainda não ter o schema ops).
sql_quiet() {
  psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$PGDATABASE" -c "$1" 2>/dev/null || true
}

# Registro em ops.job_run → aparece nas métricas (galaxie_job_*{job="pg-backup"}) e nos alertas.
job_start() {
  sql_quiet "insert into ops.job_run (job, status) values ('$1', 'running') returning id"
}

job_finish() {
  id="$1"
  status="$2"
  error="$3"
  stats="$4"
  [ -n "$id" ] || return 0
  error_sql="null"
  [ -n "$error" ] && error_sql="'$(printf '%s' "$error" | sed "s/'/''/g")'"
  sql_quiet "update ops.job_run set status = '$status', finished_at = now(), error = $error_sql, stats = '$stats'::jsonb where id = '$id'"
}

s3_enabled() {
  [ -n "${BACKUP_S3_BUCKET:-}" ]
}

aws_s3() {
  if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 "$@"
  else
    aws s3 "$@"
  fi
}

s3_uri() {
  printf 's3://%s/%s' "$BACKUP_S3_BUCKET" "${BACKUP_S3_PREFIX:-postgres}"
}
