#!/usr/bin/env bash
# Teste do mover-tasks-para-bucket-privado.sh com `docker`, `aws` e `psql` falsos no PATH (sem rede, sem RustFS): cada
# bucket é uma pasta. Confere a prévia, a cópia com conferência, a remoção do público, a idempotência, o conflito, a
# trava por tarefa viva e os erros de configuração.
#
#   bash infra/ops/mover-tasks-para-bucket-privado.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/mover-tasks-para-bucket-privado.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
calls="$work/calls.log"

# docker falso: `docker compose -f <arquivo> exec -T <serviço> <comando…>` roda o comando aqui, com o env do teste
cat >"$work/bin/docker" <<'FAKE'
#!/bin/sh
[ "$1 $2 $4 $5" = "compose -f exec -T" ] || { echo "docker falso: chamada inesperada: $*" >&2; exit 99; }
# como o `docker compose exec` de verdade, lê o stdin: rodando por `bash -s < script`, comeria o resto do script
cat >/dev/null
shift 6
exec "$@"
FAKE
# aws falso: cada bucket é a pasta $S3ROOT/<bucket>; registra "<chave> <argumentos>"
cat >"$work/bin/aws" <<'FAKE'
#!/bin/sh
echo "key=${AWS_ACCESS_KEY_ID:-} $*" >>"$CALLS"
[ "$1" = --endpoint-url ] && shift 2
case "$1 $2" in
"s3api head-bucket") [ -d "$S3ROOT/$4" ] ;;
"s3api head-object")
  # --bucket B --key K --query '[ContentLength,ETag,ContentType,Metadata."origem-etag"]' --output text
  f="$S3ROOT/$4/$6"
  m="$S3ROOT/.meta/$4/$6"
  [ -f "$f" ] || exit 254
  printf '%s\t"%s"\t%s\t%s\n' "$(wc -c <"$f" | tr -d ' ')" "$(md5sum <"$f" | cut -c1-32)" \
    "$(cat "$m.tipo" 2>/dev/null || echo application/gzip)" "$(cat "$m.origem" 2>/dev/null || echo None)"
  ;;
"s3api copy-object")
  # --bucket B --key K --copy-source A/K --metadata-directive REPLACE [--content-type T] --metadata origem-etag=E
  [ -n "${AWS_FAKE_FAIL_CP:-}" ] && exit 1
  b=$4 k=$6 from=$8
  shift 10
  tipo=""
  [ "$1" = --content-type ] && { tipo=$2; shift 2; }
  mkdir -p "$(dirname "$S3ROOT/$b/$k")" "$(dirname "$S3ROOT/.meta/$b/$k")"
  cp "$S3ROOT/$from" "$S3ROOT/$b/$k"
  [ -z "$tipo" ] || echo "$tipo" >"$S3ROOT/.meta/$b/$k.tipo"
  echo "${2#origem-etag=}" >"$S3ROOT/.meta/$b/$k.origem"
  ;;
"s3 ls")
  b=${4#s3://}
  b=${b%%/*}
  [ -d "$S3ROOT/$b/tasks" ] || exit 1
  out=$(cd "$S3ROOT/$b" && find tasks -type f | sort)
  [ -n "$out" ] || exit 1
  printf '%s\n' "$out" | while read -r k; do echo "2026-11-03 10:00:00 $(wc -c <"$S3ROOT/$b/$k" | tr -d ' ') $k"; done
  ;;
"s3 rm") rm "$S3ROOT/${4#s3://}" ;;
*)
  echo "aws falso: chamada inesperada: $*" >&2
  exit 99
  ;;
esac
FAKE
# psql falso: as tarefas vivas vêm de $FAKE_LIVE; FAKE_PSQL_FAIL=1 simula o banco fora
cat >"$work/bin/psql" <<'FAKE'
#!/bin/sh
echo "psql $*" >>"$CALLS"
[ -z "${FAKE_PSQL_FAIL:-}" ] || exit 2
printf '%s' "${FAKE_LIVE:-}"
FAKE
chmod +x "$work/bin/docker" "$work/bin/aws" "$work/bin/psql"

export PATH="$work/bin:$PATH" CALLS="$calls" S3ROOT="$work/s3"
export S3_ENDPOINT=http://s3:9000 S3_BUCKET=galaxie-sports-assets S3_TASKS_BUCKET=galaxie-sports-tasks
export S3_ACCESS_KEY=chave-rustfs S3_SECRET_KEY=segredo-rustfs AWS_ACCESS_KEY_ID=chave-remota
export DB_URL_BACKUP=postgres://galaxie_backup:x@postgres:5432/galaxie_sports

pub="$S3ROOT/galaxie-sports-assets"
priv="$S3ROOT/galaxie-sports-tasks"
fails=0
novo() { # dois objetos em tasks/ do público, um escudo fora de tasks/, privado vazio
  rm -rf "$S3ROOT" "$calls"
  mkdir -p "$pub/tasks/a1" "$pub/tasks/b2" "$pub/acervo" "$priv"
  echo pacote-a >"$pub/tasks/a1/acervo.tgz"
  echo manifesto-b >"$pub/tasks/b2/exemplo.yaml"
  echo escudo >"$pub/acervo/x.svg"
  : >"$calls"
  unset FAKE_LIVE FAKE_PSQL_FAIL AWS_FAKE_FAIL_CP
}
confere() { # confere <nome> <condição em sh>
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
mover() { (cd "$work" && bash "$script" "$@") >"$work/out.log" 2>&1; }

novo
mover --plan && r=0 || r=$?
confere "prévia: sai 0 e lista os dois objetos para copiar" '[ "$r" = 0 ] && grep -q "copiar 2 · já no privado 0 · conflito 0" "$work/out.log"'
confere "prévia: não grava nada" '[ -f "$pub/tasks/a1/acervo.tgz" ] && [ -z "$(find "$priv" -type f)" ] && ! grep -Eq " (s3 rm|copy-object) " "$calls"'
confere "aws com a chave do RustFS, não a do bucket remoto do backup" '! grep -q "key=chave-remota" "$calls" && grep -q "key=chave-rustfs" "$calls"'
confere "fora de tasks/ ninguém mexe" '! grep -q "acervo/x.svg" "$calls"'

novo
mover && r=0 || r=$?
confere "move: sai 0, copia os dois e apaga do público" \
  '[ "$r" = 0 ] && [ "$(cat "$priv/tasks/a1/acervo.tgz")" = pacote-a ] && [ -f "$priv/tasks/b2/exemplo.yaml" ] && [ ! -e "$pub/tasks/a1/acervo.tgz" ] && [ ! -e "$pub/tasks/b2/exemplo.yaml" ]'
confere "move: confere tamanho e ETag no privado antes de apagar" '[ "$(grep -c "s3api head-object --bucket galaxie-sports-tasks" "$calls")" = 2 ]'
confere "move: a cópia leva o tipo e o ETag da origem nos metadados" \
  'grep -q -- "--content-type application/gzip --metadata origem-etag=$(md5sum <"$priv/tasks/a1/acervo.tgz" | cut -c1-32)" "$calls"'
confere "move: o escudo fora de tasks/ fica" '[ -f "$pub/acervo/x.svg" ]'
mover && r=0 || r=$?
confere "rodar de novo: nada a mover (idempotente)" '[ "$r" = 0 ] && grep -q "nada a mover" "$work/out.log"'

novo
mkdir -p "$priv/tasks/a1" && cp "$pub/tasks/a1/acervo.tgz" "$priv/tasks/a1/"
mover && r=0 || r=$?
confere "já copiado antes (rodada que caiu no meio): não copia de novo, só apaga do público" \
  '[ "$r" = 0 ] && [ "$(grep -c " copy-object " "$calls")" = 1 ] && [ ! -e "$pub/tasks/a1/acervo.tgz" ]'

novo
mkdir -p "$priv/tasks/a1" && echo pacote-X >"$priv/tasks/a1/acervo.tgz"
mover && r=0 || r=$?
confere "mesma chave e mesmo tamanho, outro conteúdo (ETag diferente): conflito, nada sobrescrito nem apagado" \
  '[ "$r" = 4 ] && [ "$(cat "$priv/tasks/a1/acervo.tgz")" = pacote-X ] && [ -f "$pub/tasks/a1/acervo.tgz" ]'

novo
mkdir -p "$priv/tasks/a1" && echo outro-conteudo-maior >"$priv/tasks/a1/acervo.tgz"
mover && r=0 || r=$?
confere "conflito (mesma chave, outro tamanho): não sobrescreve, mantém a origem e sai 4" \
  '[ "$r" = 4 ] && [ "$(cat "$priv/tasks/a1/acervo.tgz")" = outro-conteudo-maior ] && [ -f "$pub/tasks/a1/acervo.tgz" ] && [ ! -e "$pub/tasks/b2/exemplo.yaml" ]'

novo
export FAKE_LIVE="0190aa acervo.importar pending"
mover && r=0 || r=$?
confere "tarefa viva apontando para o público: copia, não apaga e sai 3" \
  '[ "$r" = 3 ] && [ -f "$priv/tasks/a1/acervo.tgz" ] && [ -f "$pub/tasks/a1/acervo.tgz" ] && grep -q "0190aa acervo.importar pending" "$work/out.log"'
confere "a consulta procura o endereço do bucket público" "grep -q \"like '%s3://galaxie-sports-assets/tasks/%'\" \"\$calls\""
mover --forcar && r=0 || r=$?
confere "--forcar apaga mesmo com tarefa viva" '[ "$r" = 0 ] && [ ! -e "$pub/tasks/a1/acervo.tgz" ]'

novo
export FAKE_PSQL_FAIL=1
mover && r=0 || r=$?
confere "banco sem resposta: copia, mas a remoção fica bloqueada" \
  '[ "$r" = 3 ] && [ -f "$priv/tasks/b2/exemplo.yaml" ] && [ -f "$pub/tasks/b2/exemplo.yaml" ] && grep -q "não deu para consultar" "$work/out.log"'

novo
export AWS_FAKE_FAIL_CP=1
mover && r=0 || r=$?
confere "cópia que falha: sai com erro e nada sai do público" '[ "$r" = 1 ] && [ -f "$pub/tasks/a1/acervo.tgz" ] && [ -f "$pub/tasks/b2/exemplo.yaml" ]'

novo
rm -rf "$priv"
mover && r=0 || r=$?
confere "sem o bucket privado (s3-init não aplicado): falha antes de copiar" \
  '[ "$r" = 1 ] && grep -q "aplique antes o s3-init" "$work/out.log" && ! grep -Eq " (s3 rm|copy-object) " "$calls"'

novo
mover --destino galaxie-sports-assets && r=0 || r=$?
confere "origem igual ao destino: recusa" '[ "$r" = 1 ] && grep -q "mesmo bucket" "$work/out.log"'

novo
(unset S3_TASKS_BUCKET && cd "$work" && bash "$script") >"$work/out.log" 2>&1 && r=0 || r=$?
confere "contêiner sem S3_TASKS_BUCKET (backup ainda não recriado): usa galaxie-sports-tasks" \
  '[ "$r" = 0 ] && [ -f "$priv/tasks/a1/acervo.tgz" ]'

novo
rm -rf "$pub/tasks"
mover && r=0 || r=$?
confere "nada em tasks/ do público: sai 0 sem gravar" '[ "$r" = 0 ] && grep -q "nada a mover" "$work/out.log" && ! grep -Eq " (s3 rm|copy-object) " "$calls"'

novo
(cd "$work" && bash -s -- <"$script") >"$work/out.log" 2>&1 && r=0 || r=$?
confere "pelo stdin (ssh … bash -s < script), como na VPS: o script roda inteiro"   '[ "$r" = 0 ] && grep -q "copiados 2 · apagados do público 2" "$work/out.log" && [ ! -e "$pub/tasks/a1/acervo.tgz" ]'

novo
mover --help && r=0 || r=$?
confere "--help mostra o uso e sai 0" '[ "$r" = 0 ] && grep -q "uso:" "$work/out.log"'

novo
mover --sei-la && r=0 || r=$?
confere "opção desconhecida: sai 2" '[ "$r" = 2 ]'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: mover-tasks-para-bucket-privado.sh"
