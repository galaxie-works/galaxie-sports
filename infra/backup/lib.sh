#!/bin/sh
# Funções comuns dos scripts de backup/restore. Conexão via variáveis padrão do libpq:
# PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.

: "${PGDATABASE:?Defina PGDATABASE}"
: "${BACKUP_DIR:=/backups}"
# Retenção na VPS por contagem: os N dumps diários mais recentes (a camada longa fica no NAS; ver
# docs/runbooks/exercicio-dr.md). Por contagem, e não por idade: com o backup parado, nada some.
: "${BACKUP_KEEP_DAILY:=7}"
[ "$BACKUP_KEEP_DAILY" -ge 1 ] 2>/dev/null || BACKUP_KEEP_DAILY=1
# Idade máxima do último dump antes de o verificador acusar (horas): um dia + folga.
: "${BACKUP_MAX_AGE_H:=26}"
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

# Dumps do banco em BACKUP_DIR, do mais antigo ao mais recente (o nome leva o horário UTC: ordem de nome = ordem de tempo).
# Cifrado (BACKUP_AGE_RECIPIENTS) o dump termina em .dump.age; os em claro de antes da cifragem continuam na lista.
list_dumps() {
  ls -1 "$BACKUP_DIR"/"${PGDATABASE}"_*.dump "$BACKUP_DIR"/"${PGDATABASE}"_*.dump.age 2>/dev/null | sort || true
}

latest_dump() {
  list_dumps | tail -n 1
}

# Idade de um arquivo em segundos (pela data de modificação).
file_age_s() {
  echo $(($(date -u +%s) - $(stat -c %Y "$1")))
}

# Mantém os BACKUP_KEEP_DAILY dumps mais recentes (com o .sha256 de cada); imprime quantos apagou.
prune_dumps() {
  total=$(list_dumps | wc -l | tr -d ' ')
  extra=$((total - BACKUP_KEEP_DAILY))
  if [ "$extra" -le 0 ]; then
    echo 0
    return 0
  fi
  list_dumps | head -n "$extra" | while read -r f; do rm -f "$f" "$f.sha256"; done
  echo "$extra"
}

# ── Cifragem dos dumps (age) ─────────────────────────────────────────────────────────────────────────────────────
# BACKUP_AGE_RECIPIENTS: chaves públicas do age (age1…), separadas por vírgula, espaço ou quebra de linha. Com ela, o
# dump sai do contêiner (volume, NAS, S3) só cifrado: a chave de recuperação do Wagner (privada fora da VPS) e a do
# ensaio. BACKUP_AGE_IDENTITY: a chave PRIVADA do ensaio (AGE-SECRET-KEY-1…), que fica só no .env da VPS e decifra o
# dump no ensaio mensal e no restore. docs/runbooks/exercicio-dr.md › Dumps cifrados.
age_enabled() {
  [ -n "${BACKUP_AGE_RECIPIENTS:-}" ]
}

# Grava os destinatários num arquivo (um por linha) e imprime o caminho; falha se algum não for uma chave pública.
age_recipients_file() {
  f=$(mktemp)
  printf '%s\n' "$BACKUP_AGE_RECIPIENTS" | tr ', \t' '\n\n\n' | sed '/^$/d' >"$f"
  if [ ! -s "$f" ] || grep -qv '^age1[02-9ac-hj-np-z]\{58\}$' "$f"; then
    rm -f "$f"
    return 1
  fi
  echo "$f"
}

# Grava a chave privada do ensaio num arquivo só do dono (0600) e imprime o caminho; sem ela, falha.
age_identity_file() {
  [ -n "${BACKUP_AGE_IDENTITY:-}" ] || return 1
  f=$(umask 077 && mktemp)
  printf '%s\n' "$BACKUP_AGE_IDENTITY" >"$f"
  echo "$f"
}

# Dump pronto para o pg_restore: em claro, o próprio arquivo; cifrado (.age), decifra em "$2" (o chamador apaga).
# Imprime o caminho do arquivo em claro; falha sem a chave do ensaio ou se o arquivo não decifra (age confere a
# autenticidade de cada bloco: arquivo trocado ou corrompido não passa).
plain_dump() {
  case "$1" in
  *.age) ;;
  *)
    echo "$1"
    return 0
    ;;
  esac
  id=$(age_identity_file) || {
    log error "dump cifrado sem BACKUP_AGE_IDENTITY (chave do ensaio) para decifrar: $(basename "$1")" >&2
    return 1
  }
  if ! age -d -i "$id" -o "$2" "$1"; then
    rm -f "$id" "$2"
    log error "não deu para decifrar $(basename "$1") com a chave do ensaio" >&2
    return 1
  fi
  rm -f "$id"
  echo "$2"
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
