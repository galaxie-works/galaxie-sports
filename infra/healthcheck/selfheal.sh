#!/bin/sh
# Caminho rápido do healthcheck (selfheal.mjs): confere a saúde em shell e só sobe o Node quando precisa.
#
#   sh selfheal.sh http <url>              # 2xx = saudável
#   sh selfheal.sh heartbeat <arquivo> <ms> # arquivo tocado há menos de <ms> = saudável
#
# Cada healthcheck em Node custa uma subida de processo (de 80 a 340 ms de CPU medidos na VPS), e são ~28 por minuto
# na stack. O estado do selfheal.mjs (HEALTH_STATE_DIR/selfheal.json) só muda quando algo muda: com o processo
# principal saudável e o estado já "visto saudável, zero falhas" para ESTE processo (pid@início), rodar o Node não
# mudaria nada, e o shell sai 0. Em qualquer outro caso (falha, falha anterior por zerar, processo novo depois de um
# reinício, estado ilegível) quem decide é o selfheal.mjs, com a contagem, a trava e o reinício de sempre.
set -u

DIR=$(dirname "$0")
STATE="${HEALTH_STATE_DIR:-/tmp}/selfheal.json"
# só nos testes (selfheal.test.sh): um /proc de faz de conta
PROC="${SELFHEAL_PROC_DIR:-/proc}"

healthy() {
  case "${1:-}" in
    http)
      # wget do busybox: sai diferente de 0 em erro de rede e em resposta 4xx/5xx; segue redirecionamento como o fetch
      wget -q -T 4 -O /dev/null "${2:-}" 2>/dev/null
      ;;
    heartbeat)
      mtime=$(stat -c %Y "${2:-}" 2>/dev/null) || return 1
      max_s=$(( ${3:-120000} / 1000 ))
      [ $(( $(date +%s) - mtime )) -lt "$max_s" ]
      ;;
    *)
      return 1
      ;;
  esac
}

# Processo principal: o filho do PID 1 (tini), o mesmo que o selfheal.mjs procura. Sem /proc/1/task/1/children (kernel
# sem CONFIG_PROC_CHILDREN), fica vazio e o Node decide.
main_proc() {
  pid=$(cut -d' ' -f1 "$PROC/1/task/1/children" 2>/dev/null) || return 1
  [ -n "$pid" ] || return 1
  # campo 22 do /proc/<pid>/stat: início do processo em ticks (o nome do processo "(node)" não tem espaço)
  ticks=$(cut -d' ' -f22 "$PROC/$pid/stat" 2>/dev/null) || return 1
  [ -n "$ticks" ] || return 1
  echo "$pid@$ticks"
}

if healthy "$@"; then
  proc=$(main_proc) || proc=''
  # o JSON que o selfheal.mjs grava depois de um healthcheck saudável: {"proc":"…","seenOk":true,"fails":0,…,"term":null}
  if [ -n "$proc" ] && grep -q "\"proc\":\"$proc\",\"seenOk\":true,\"fails\":0," "$STATE" 2>/dev/null &&
    grep -q '"term":null' "$STATE" 2>/dev/null; then
    exit 0
  fi
fi
exec node "$DIR/selfheal.mjs" "$@"
