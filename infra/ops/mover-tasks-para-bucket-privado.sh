#!/usr/bin/env bash
# Move o que ficou em tasks/ do bucket público de assets (S3_BUCKET, leitura anônima por chave) para o bucket privado das
# tarefas (S3_TASKS_BUCKET, padrão galaxie-sports-tasks; #587), com a mesma chave. Roda na VPS, no diretório da stack
# (/docker/galaxie-sports), e usa o aws-cli e o psql do contêiner `backup` (as chaves do RustFS já estão no env dele):
#
#   ssh root@<vps> 'cd /docker/galaxie-sports && bash -s -- --plan' < infra/ops/mover-tasks-para-bucket-privado.sh
#   ssh root@<vps> 'cd /docker/galaxie-sports && bash -s' < infra/ops/mover-tasks-para-bucket-privado.sh
#
#   --plan                só lista o que faria (copiar, já copiado, conflito) e as tarefas vivas que apontam para o
#                         bucket público; não grava nada
#   --origem <bucket>     bucket público (padrão: S3_BUCKET do contêiner `backup`)
#   --destino <bucket>    bucket privado (padrão: S3_TASKS_BUCKET do contêiner, senão galaxie-sports-tasks)
#   --forcar              remove do bucket público mesmo com tarefa viva (pending/running) apontando para ele
#
# Para cada objeto de tasks/ no bucket público:
#   1. ausente no privado: copia (cópia no próprio RustFS, com o mesmo tipo de conteúdo), confere o tamanho no destino;
#   2. já no privado com o mesmo tamanho: nada a copiar (rodar de novo é seguro: idempotente);
#   3. no privado com outro tamanho: conflito, não sobrescreve nem apaga a origem (resolva à mão);
#   4. só depois de 1 ou 2 conferidos, apaga do bucket público.
# Tarefa viva (pending/running em ops.job_request) com params apontando para s3://<origem>/tasks/ ainda vai ler de lá:
# com ela, a cópia acontece mas a remoção não (a não ser com --forcar). Prévia concluída e ainda não aprovada também
# lê o pacote de lá na aprovação: rode a prévia de novo com o endereço novo (docs/runbooks/tarefas.md).
#
# Pré-requisito: o s3-init já criou o bucket privado (docker compose -f compose.dados.yml up -d s3-init) e o `backup`
# está no ar. Variáveis: MOVER_DADOS_COMPOSE (compose.dados.yml), MOVER_SERVICE (backup).
set -euo pipefail

plan=false
force=false
src=""
dst=""
while [ $# -gt 0 ]; do
  case "$1" in
  --plan) plan=true ;;
  --forcar) force=true ;;
  --origem)
    src="${2:?--origem precisa do nome do bucket}"
    shift
    ;;
  --destino)
    dst="${2:?--destino precisa do nome do bucket}"
    shift
    ;;
  -h | --help)
    echo "uso: mover-tasks-para-bucket-privado.sh [--plan] [--origem <bucket>] [--destino <bucket>] [--forcar]"
    echo "(detalhes no cabeçalho do script; roda na VPS em /docker/galaxie-sports)"
    exit 0
    ;;
  *)
    echo "opção desconhecida: $1 (use --plan, --origem, --destino, --forcar)" >&2
    exit 2
    ;;
  esac
  shift
done

compose_file="${MOVER_DADOS_COMPOSE:-compose.dados.yml}"
service="${MOVER_SERVICE:-backup}"

# Um comando dentro do contêiner do backup (sem TTY: a saída vem limpa para o script). O stdin fecha: rodando por
# `ssh … bash -s < script`, o `exec` leria o resto do próprio script.
in_backup() { docker compose -f "$compose_file" exec -T "$service" "$@" </dev/null; }
# aws contra o RustFS da stack, com as chaves do RustFS (as AWS_* do contêiner são as do bucket remoto do backup).
rustfs() {
  # shellcheck disable=SC2016 # as variáveis são do contêiner, expandidas lá dentro
  in_backup sh -c 'AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" exec aws --endpoint-url "$S3_ENDPOINT" "$@"' aws "$@"
}
die() {
  echo "erro: $*" >&2
  exit 1
}
valid_bucket() { printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9.-]{1,62}$'; }

# shellcheck disable=SC2016
env_lines=$(in_backup sh -c 'printf "%s\n%s\n" "${S3_BUCKET:-}" "${S3_TASKS_BUCKET:-}"') ||
  die "o contêiner '$service' de $compose_file não respondeu (o projeto dados está no ar? rodando em /docker/galaxie-sports?)"
[ -n "$src" ] || src=$(printf '%s\n' "$env_lines" | sed -n 1p)
[ -n "$dst" ] || dst=$(printf '%s\n' "$env_lines" | sed -n 2p)
[ -n "$dst" ] || dst=galaxie-sports-tasks
[ -n "$src" ] || die "sem bucket de origem: o contêiner não tem S3_BUCKET (use --origem)"
valid_bucket "$src" || die "bucket de origem inválido: $src"
valid_bucket "$dst" || die "bucket de destino inválido: $dst"
[ "$src" != "$dst" ] || die "origem e destino são o mesmo bucket ($src)"

rustfs s3api head-bucket --bucket "$dst" >/dev/null 2>&1 ||
  die "o bucket privado $dst não existe: aplique antes o s3-init (docker compose -f $compose_file up -d s3-init)"

# Objetos de um prefixo, um por linha: "<tamanho>\t<chave>". `aws s3 ls` sai 1 quando o prefixo não tem nada.
list_objects() {
  local out rc=0
  out=$(rustfs s3 ls --recursive "s3://$1/tasks/" 2>/dev/null) || rc=$?
  if [ "$rc" != 0 ] && { [ "$rc" != 1 ] || [ -n "$out" ]; }; then
    die "listar s3://$1/tasks/ (saída $rc)"
  fi
  [ -z "$out" ] || printf '%s\n' "$out" | sed -E 's/^[0-9-]+ +[0-9:]+ +([0-9]+) +(.*)$/\1\t\2/'
}

src_list=$(list_objects "$src")
dst_list=$(list_objects "$dst")

# Tarefas vivas que ainda leem do bucket público (o papel do backup lê tudo: pg_read_all_data). Sem resposta do banco,
# não dá para saber: a remoção fica bloqueada como se houvesse (fail safe).
# shellcheck disable=SC2016
live_tasks=$(in_backup sh -c 'psql "$DB_URL_BACKUP" -XAtF " " -v ON_ERROR_STOP=1 -c "$1"' sh \
  "select id, type, status from ops.job_request where status in ('pending', 'running') and params::text like '%s3://$src/tasks/%' order by requested_at" 2>/dev/null) ||
  live_tasks="?"

echo "origem (público): s3://$src/tasks/  →  destino (privado): s3://$dst/tasks/"
if [ -z "$src_list" ]; then
  echo "nada em tasks/ do bucket público: nada a mover"
  exit 0
fi

copy=0
done_already=0
conflicts=0
bytes=0
plan_lines=""
while IFS=$'\t' read -r size key; do
  [ -n "$key" ] || continue
  bytes=$((bytes + size))
  existing=$(printf '%s\n' "$dst_list" | awk -F '\t' -v k="$key" '$2 == k { print $1; exit }')
  if [ -z "$existing" ]; then
    action=copiar
    copy=$((copy + 1))
  elif [ "$existing" = "$size" ]; then
    action=ja-no-privado
    done_already=$((done_already + 1))
  else
    action=conflito
    conflicts=$((conflicts + 1))
  fi
  plan_lines="${plan_lines}${action}	${size}	${key}
"
done <<<"$src_list"

printf '%s' "$plan_lines" | awk -F '\t' '{ printf "  %-14s %12s  %s\n", $1, $2, $3 }'
echo "total: $((copy + done_already + conflicts)) objeto(s), $bytes bytes · copiar $copy · já no privado $done_already · conflito $conflicts"
if [ "$live_tasks" = "?" ]; then
  echo "tarefas vivas apontando para s3://$src/tasks/: não deu para consultar o banco (a remoção fica bloqueada)"
elif [ -n "$live_tasks" ]; then
  echo "tarefas vivas apontando para s3://$src/tasks/ (a remoção fica bloqueada):"
  printf '%s\n' "$live_tasks" | sed 's/^/  /'
else
  echo "nenhuma tarefa viva aponta para s3://$src/tasks/"
fi

if [ "$plan" = true ]; then
  echo "prévia: nada foi gravado (rode sem --plan para mover)"
  exit 0
fi

can_remove=true
if [ -n "$live_tasks" ] && [ "$force" != true ]; then
  can_remove=false
fi

moved=0
removed=0
kept=0
while IFS=$'\t' read -r action size key; do
  [ -n "$key" ] || continue
  case "$action" in
  conflito)
    echo "conflito, mantido nos dois: $key (público $size bytes)" >&2
    kept=$((kept + 1))
    continue
    ;;
  copiar)
    rustfs s3 cp --only-show-errors "s3://$src/$key" "s3://$dst/$key" >/dev/null || die "copiar $key"
    moved=$((moved + 1))
    ;;
  esac
  got=$(rustfs s3api head-object --bucket "$dst" --key "$key" --query ContentLength --output text 2>/dev/null | tr -d '\r') ||
    die "conferir $key no bucket privado"
  [ "$got" = "$size" ] || die "$key no bucket privado com $got bytes (esperado $size): a origem fica"
  if [ "$can_remove" = true ]; then
    rustfs s3 rm --only-show-errors "s3://$src/$key" >/dev/null || die "apagar $key do bucket público"
    removed=$((removed + 1))
  else
    kept=$((kept + 1))
  fi
done <<<"$(printf '%s' "$plan_lines")"

echo "copiados $moved · apagados do público $removed · mantidos no público $kept"
if [ "$can_remove" != true ]; then
  echo "a remoção ficou para depois: termine (ou cancele) as tarefas acima e rode de novo, ou use --forcar" >&2
  exit 3
fi
[ "$conflicts" = 0 ] || exit 4
