#!/usr/bin/env bash
# Teste do wait_ci do merge-train.sh com um gh falso: cada caso é o JSON de `gh pr checks --json name,state,bucket`
# do commit do PR, e o resultado é o resumo que o trem lê ("fail" ou "timeout" = fica de fora). Precisa do jq.
#
#   bash infra/ops/merge-train.test.sh
set -u
cd "$(dirname "$0")" || exit 1
# shellcheck source=merge-train.sh
. ./merge-train.sh

checks=""
# o gh falso só responde ao pr checks, aplicando o --jq do script ao JSON do caso
gh() {
  [ "$1 $2" = "pr checks" ] || return 1
  local q="" a
  for a in "$@"; do [ "$q" = next ] && q="$a"; [ "$a" = --jq ] && q=next; done
  printf '%s' "$checks" | jq -r "$q" | tr -d '\015'  # o jq do Windows escreve CRLF
}
sleep() { :; }

fails=0
caso() {  # caso <nome> <esperado: pass|fail|timeout> <json>
  local r ok
  checks="$3"
  r=$(wait_ci 1)
  case "$2" in
    pass) echo "$r" | grep -qE "fail|timeout" && ok=no || ok=yes ;;
    fail) echo "$r" | grep -q fail && ok=yes || ok=no ;;
    timeout) [ "$r" = timeout ] && ok=yes || ok=no ;;
  esac
  if [ "$ok" = yes ]; then echo "ok   $1: $r"; else echo "FALHA $1 (esperado $2): $r"; fails=$((fails + 1)); fi
}

ci='{"name":"checks","state":"SUCCESS","bucket":"pass"}'
codex='"name":"Codex sem P1 aberto"'

caso "cancelado do push + verde do review (#395, #413)" pass \
  "[$ci,{$codex,\"state\":\"CANCELLED\",\"bucket\":\"cancel\"},{$codex,\"state\":\"SUCCESS\",\"bucket\":\"pass\"}]"
caso "gh antigo: cancelado no balde fail + verde" pass \
  "[$ci,{$codex,\"state\":\"CANCELLED\",\"bucket\":\"fail\"},{$codex,\"state\":\"SUCCESS\",\"bucket\":\"pass\"}]"
caso "cancelado sozinho" fail \
  "[$ci,{$codex,\"state\":\"CANCELLED\",\"bucket\":\"cancel\"}]"
caso "cancelado + reprovado" fail \
  "[$ci,{$codex,\"state\":\"CANCELLED\",\"bucket\":\"cancel\"},{$codex,\"state\":\"FAILURE\",\"bucket\":\"fail\"}]"
caso "reprovado + verde do mesmo nome continua falha" fail \
  "[$ci,{$codex,\"state\":\"FAILURE\",\"bucket\":\"fail\"},{$codex,\"state\":\"SUCCESS\",\"bucket\":\"pass\"}]"
caso "cancelado + outro rodando espera" timeout \
  "[$ci,{$codex,\"state\":\"CANCELLED\",\"bucket\":\"cancel\"},{$codex,\"state\":\"IN_PROGRESS\",\"bucket\":\"pending\"}]"
caso "verde de outro nome não salva o cancelado" fail \
  "[$ci,{\"name\":\"build api\",\"state\":\"CANCELLED\",\"bucket\":\"cancel\"}]"
caso "tudo verde, com pulado" pass \
  "[$ci,{\"name\":\"deploy\",\"state\":\"SKIPPED\",\"bucket\":\"skipping\"}]"

[ "$fails" -eq 0 ] || { echo "$fails caso(s) falharam"; exit 1; }
echo "todos os casos passaram"
