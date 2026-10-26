#!/usr/bin/env bash
# Portão do review do Codex: falha se o PR tem thread do bot do Codex com o selo P1 ("P1 Badge") ainda sem resolver.
# Mesma regra do codex_p1() do merge-train.sh, agora como check obrigatório (.github/workflows/codex-gate.yml).
#
#   infra/ops/codex-gate.sh <pr>        # gh autenticado; GH_REPO=dono/repo (padrão: o do checkout)
#
# Espera o review terminar: o Codex reage com 👀 enquanto revisa e mantém um comentário-resumo com o estado em JSON
# (codex-review-state:v1). Com o review em andamento, ou nada dele num PR aberto há menos de CODEX_WAIT_MIN minutos
# (padrão 10; o review costuma chegar uns minutos depois de abrir), espera até lá. PR mais velho que isso e sem nada
# do Codex (Dependabot, PR anterior à integração) passa com aviso: o portão barra P1 aberto, não a falta de review.
# Saída: 0 = sem P1 aberto; 1 = P1 aberto, review ainda rodando no fim da espera, ou o GitHub não respondeu.
set -euo pipefail

PR="${1:?uso: codex-gate.sh <número do PR>}"
REPO="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
WAIT_MIN="${CODEX_WAIT_MIN:-10}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# estado do review: running | done | none
review_state() {
  local reactions status
  # 👀 = review rodando; 👍 = terminou sem achado
  reactions="$(gh api "repos/$REPO/issues/$PR/reactions" --paginate \
    --jq '.[] | select(.user.login | test("codex")) | .content' | sort -u | tr '\n' ' ')"
  # estado do último review no comentário-resumo do bot
  status="$(gh api "repos/$REPO/issues/$PR/comments" --paginate \
    --jq '.[] | select(.user.login | test("codex")) | .body
      | capture("codex-review-state:v1 (?<j>[{].*?[}]) -->").j | fromjson | .code_review.status // ""' | tail -n 1)"
  case " $reactions" in *" eyes "*)
    echo running
    return
    ;;
  esac
  case "$status" in
    completed) echo done ;;
    '') case " $reactions" in *" +1 "*) echo done ;; *) echo none ;; esac ;;
    *) echo running ;;
  esac
}

created="$(gh api "repos/$REPO/pulls/$PR" --jq .created_at)"
deadline=$(($(date -d "$created" +%s) + WAIT_MIN * 60))
while :; do
  state="$(review_state)"
  now=$(date +%s)
  [ "$state" = done ] && break
  if [ "$now" -ge "$deadline" ]; then
    if [ "$state" = running ]; then
      echo "::error::Codex ainda revisando o PR #$PR depois de $WAIT_MIN min de PR aberto; rode o check de novo quando ele terminar"
      echo "Codex ainda revisando o PR #$PR: rode de novo quando terminar." >> "$SUMMARY"
      exit 1
    fi
    echo "::warning::Nenhum review do Codex no PR #$PR; sem P1 para conferir além das threads que já existem"
    break
  fi
  echo "review do Codex: $state; esperando (até $(date -u -d "@$deadline" +%H:%MZ))"
  sleep 30
done

# threads sem resolver cuja 1ª mensagem é do Codex com o selo P1 (o bot comenta inline com "P1 Badge")
open="$(gh api graphql -F owner="$OWNER" -F repo="$NAME" -F n="$PR" -f query='
  query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){
    reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login} body path url}}}}}}}' \
  --jq "[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | .comments.nodes[0]
    | select((.author.login|test(\"codex\")) and (.body|test(\"P1 Badge\")))] | map(\"\(.path) \(.url)\") | .[]")"

if [ -z "$open" ]; then
  echo "PR #$PR: nenhuma thread P1 do Codex sem resolver"
  echo "✅ PR #$PR: nenhuma thread P1 do Codex sem resolver." >> "$SUMMARY"
  exit 0
fi
n="$(printf '%s\n' "$open" | grep -c .)"
echo "::error::PR #$PR tem $n thread(s) P1 do Codex sem resolver"
printf '%s\n' "$open"
{
  echo "❌ PR #$PR: $n thread(s) P1 do Codex sem resolver. Corrija ou responda e resolva a thread; depois rode o check de novo."
  echo
  printf -- '- %s\n' "$open"
} >> "$SUMMARY"
exit 1
