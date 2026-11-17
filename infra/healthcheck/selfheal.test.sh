#!/usr/bin/env bash
# Testes do caminho rápido do healthcheck (selfheal.sh): quando o shell sai sozinho e quando passa para o selfheal.mjs.
#   bash infra/healthcheck/selfheal.test.sh
# O `node` e o `wget` são de faz de conta (PATH) e o /proc também (SELFHEAL_PROC_DIR); o formato do estado é conferido
# com o selfheal.mjs de verdade no fim.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/selfheal.sh"
REAL_NODE=$(command -v node)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin" "$WORK/proc/1/task/1" "$WORK/proc/4242" "$WORK/state"
# node falso: registra a chamada (com o veredito SELFHEAL_PROBE) e sai com o código pedido (o selfheal.mjs de verdade decidiria)
cat >"$WORK/bin/node" <<'EOF'
#!/bin/sh
echo "probe=${SELFHEAL_PROBE:-} $*" >>"$NODE_LOG"
exit "${FAKE_NODE_EXIT:-0}"
EOF
# wget falso: sai com FAKE_WGET_EXIT (0 = 2xx)
cat >"$WORK/bin/wget" <<'EOF'
#!/bin/sh
exit "${FAKE_WGET_EXIT:-0}"
EOF
chmod +x "$WORK/bin/node" "$WORK/bin/wget"

# processo principal 4242, iniciado no tick 777 (campo 22 do stat)
echo '4242 ' >"$WORK/proc/1/task/1/children"
echo '4242 (node) S 1 4242 4242 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 11 0 777 0 0' >"$WORK/proc/4242/stat"

export PATH="$WORK/bin:$PATH" HEALTH_STATE_DIR="$WORK/state" SELFHEAL_PROC_DIR="$WORK/proc" NODE_LOG="$WORK/node.log"
STATE="$WORK/state/selfheal.json"
BEAT="$WORK/beat"

fails=0
check() { # nome, código esperado, chamou o node? (sim|não), comando...
  local name=$1 want_code=$2 want_node=$3
  shift 3
  : >"$NODE_LOG"
  local code=0
  sh "$SCRIPT" "$@" || code=$?
  local called=não
  [ -s "$NODE_LOG" ] && called=sim
  if [ "$code" = "$want_code" ] && [ "$called" = "$want_node" ]; then
    echo "ok   $name"
  else
    echo "FALHA $name: código $code (esperado $want_code), node: $called (esperado $want_node)"
    fails=$((fails + 1))
  fi
}

clean_state() { echo '{"proc":"4242@777","seenOk":true,"fails":0,"restarts":[],"term":null}' >"$STATE"; }

touch "$BEAT"

rm -f "$STATE"
check 'heartbeat em dia, sem estado ainda: o Node registra o primeiro "saudável"' 0 sim heartbeat "$BEAT" 120000

clean_state
check 'heartbeat em dia e estado limpo deste processo: sai 0 sem subir o Node' 0 não heartbeat "$BEAT" 120000

touch -d '-10 minutes' "$BEAT"
export FAKE_NODE_EXIT=1
check 'heartbeat velho: quem decide é o Node (conta a falha)' 1 sim heartbeat "$BEAT" 120000
unset FAKE_NODE_EXIT
touch "$BEAT"

echo '{"proc":"4242@777","seenOk":true,"fails":2,"restarts":[],"term":null}' >"$STATE"
check 'saudável depois de falhas: o Node zera a contagem' 0 sim heartbeat "$BEAT" 120000

echo '{"proc":"4242@555","seenOk":true,"fails":0,"restarts":[],"term":null}' >"$STATE"
check 'processo novo (reinício do contêiner): o Node registra o "saudável" dele' 0 sim heartbeat "$BEAT" 120000

echo '{"proc":"4242@777","seenOk":false,"fails":0,"restarts":[],"term":null}' >"$STATE"
check 'ainda não visto saudável: passa pelo Node' 0 sim heartbeat "$BEAT" 120000

echo '{"proc":"4242@777","seenOk":true,"fails":0,"restarts":[1],"term":1700000000}' >"$STATE"
check 'encerramento em andamento (term): passa pelo Node' 0 sim heartbeat "$BEAT" 120000

clean_state
check 'http 2xx e estado limpo: sai 0 sem subir o Node' 0 não http http://127.0.0.1:8080/health
export FAKE_WGET_EXIT=8 FAKE_NODE_EXIT=1
check 'http com erro: quem decide é o Node' 1 sim http http://127.0.0.1:8080/health
if grep -q '^probe=fail ' "$NODE_LOG"; then
  echo 'ok   http com erro: o Node recebe o veredito (SELFHEAL_PROBE=fail) e não testa de novo'
else
  echo "FALHA http com erro: o Node não recebeu SELFHEAL_PROBE=fail ($(cat "$NODE_LOG"))"
  fails=$((fails + 1))
fi
export FAKE_WGET_EXIT=127
check 'sem wget (127): o Node testa sozinho' 1 sim http http://127.0.0.1:8080/health
if grep -q '^probe= ' "$NODE_LOG"; then
  echo 'ok   sem wget: o Node não recebe veredito'
else
  echo "FALHA sem wget: veredito inesperado ($(cat "$NODE_LOG"))"
  fails=$((fails + 1))
fi
unset FAKE_WGET_EXIT FAKE_NODE_EXIT

clean_state
mv "$WORK/proc/1/task/1/children" "$WORK/children.bak"
check 'sem /proc/1/task/1/children: passa pelo Node' 0 sim heartbeat "$BEAT" 120000
mv "$WORK/children.bak" "$WORK/proc/1/task/1/children"

check 'modo desconhecido: passa pelo Node' 0 sim outro x

# o formato que o selfheal.mjs grava depois de um "saudável" é o que o shell procura
REAL_STATE=$(mktemp -d)
HEALTH_STATE_DIR="$REAL_STATE" "$REAL_NODE" "$HERE/selfheal.mjs" heartbeat "$BEAT" 120000
if grep -Eq '^\{"proc":"[0-9]+@[0-9]+","seenOk":true,"fails":0,.*"term":null' "$REAL_STATE/selfheal.json"; then
  echo 'ok   o estado do selfheal.mjs saudável tem o formato que o selfheal.sh procura'
else
  echo "FALHA formato do estado do selfheal.mjs: $(cat "$REAL_STATE/selfheal.json")"
  fails=$((fails + 1))
fi
rm -rf "$REAL_STATE"

if [ "$fails" -gt 0 ]; then
  echo "$fails teste(s) falharam"
  exit 1
fi
echo 'todos os testes passaram'
