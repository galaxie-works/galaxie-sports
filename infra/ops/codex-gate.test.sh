#!/usr/bin/env bash
# Teste do codex-gate.sh com gh e sleep falsos: cada caso é o estado do PR (abertura, reações e comentário-resumo do
# Codex, threads) e o resultado esperado (saída do portão e um trecho do que ele escreve). Precisa do jq.
#
#   bash infra/ops/codex-gate.test.sh
set -u
cd "$(dirname "$0")" || exit 1
bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT

# gh falso: responde às chamadas do portão com o JSON do caso (variáveis FAKE_*) e aplica o --jq dele
cat > "$bin/gh" <<'GH'
#!/usr/bin/env bash
q="." ep=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) q="$2"; shift 2 ;;
    -F | -f) shift 2 ;;
    api | --paginate) shift ;;
    *) ep="$1"; shift ;;
  esac
done
case "$ep" in
  repos/*/pulls/*) j="{\"created_at\":\"$FAKE_CREATED\",\"head\":{\"sha\":\"$FAKE_HEAD\"}}" ;;
  repos/*/commits/*) j="{\"commit\":{\"committer\":{\"date\":\"$FAKE_CREATED\"}}}" ;;
  repos/*/reactions) j="$FAKE_REACTIONS" ;;
  repos/*/comments) j="$FAKE_COMMENTS" ;;
  graphql) j="$FAKE_THREADS" ;;
  *) echo "gh falso: chamada inesperada $ep" >&2; exit 1 ;;
esac
printf '%s' "$j" | jq -r "$q" | tr -d '\015'  # o jq do Windows escreve CRLF
GH
printf '#!/bin/sh\nexit 0\n' > "$bin/sleep"
chmod +x "$bin/gh" "$bin/sleep"

head=06064b953a0000000000000000000000000000aa
old=e487142f3a663aa9cf6734ec2b2a88ca9f16c495
bot=chatgpt-codex-connector login="chatgpt-codex-connector[bot]"
reacao() { [ -z "$1" ] && echo '[]' || echo "[{\"user\":{\"login\":\"$login\"},\"content\":\"$1\"}]"; }
resumo() {  # resumo <status> <commit>
  echo "[{\"user\":{\"login\":\"$login\"},\"body\":\"<!-- codex-review-state:v1 {\\\"code_review\\\":{\\\"commit_sha\\\":\\\"$2\\\",\\\"status\\\":\\\"$1\\\"}} -->\"}]"
}
sem_p1='{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}'
com_p1='{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[{"isResolved":false,"comments":{"nodes":[{"author":{"login":"'$bot'"},"body":"![P1 Badge] quebra","path":"a.sh","url":"https://x/1"}]}}]}}}}}'
ha() { date -u -d "-$1 minutes" +%Y-%m-%dT%H:%M:%SZ; }

fails=0
caso() {  # caso <nome> <saída esperada> <trecho esperado> <aberto há (min)> <reação> <status> <commit> <threads> [VAR=valor...]
  local nome=$1 want=$2 trecho=$3 out got
  out=$(env PATH="$bin:$PATH" GH_REPO=galaxie-works/galaxie-sports CODEX_WAIT_MIN=10 CODEX_REQUIRE_CURRENT= \
    FAKE_CREATED="$(ha "$4")" FAKE_HEAD=$head FAKE_REACTIONS="$(reacao "$5")" FAKE_COMMENTS="$(resumo "$6" "$7")" \
    FAKE_THREADS="$8" "${@:9}" timeout 20 bash ./codex-gate.sh 427 2>&1)
  got=$?
  if [ "$got" = "$want" ] && printf '%s' "$out" | grep -qF -- "$trecho"; then
    echo "ok   $nome"
  else
    echo "FALHA $nome: saída $got (esperada $want), sem \"$trecho\":"
    printf '%s\n' "$out" | tail -n 5 | sed 's/^/     /'
    fails=$((fails + 1))
  fi
}

caso "#427: review rodando no commit anterior, sem P1, passa com aviso" 0 "em andamento é do commit e487142" \
  120 eyes running $old "$sem_p1"
caso "review rodando no commit anterior com P1 aberto barra" 1 "1 thread(s) P1" \
  120 eyes running $old "$com_p1"
caso "review rodando no anterior não espera a folga" 0 "::warning::" \
  15 eyes running $old "$sem_p1"
caso "review do atual rodando além da folga passa com aviso" 0 "continua rodando" \
  120 eyes running $head "$sem_p1"
caso "review do atual rodando além da folga com P1 barra" 1 "1 thread(s) P1" \
  120 eyes running $head "$com_p1"
caso "review do atual rodando dentro da folga espera" 124 "esperando terminar" \
  15 eyes running $head "$sem_p1"
caso "rodando além da folga com CODEX_REQUIRE_CURRENT falha" 1 "::error::" \
  120 eyes running $head "$sem_p1" CODEX_REQUIRE_CURRENT=1
caso "review do atual terminado, sem P1" 0 "nenhuma thread P1" \
  120 +1 completed $head "$sem_p1"
caso "review que falhou passa com aviso" 0 "falhou" \
  120 eyes failed $old "$sem_p1"

[ "$fails" -eq 0 ] || { echo "$fails caso(s) falharam"; exit 1; }
echo "todos os casos passaram"
