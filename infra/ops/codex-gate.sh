#!/usr/bin/env bash
# Portão do review do Codex: falha se o PR tem thread do bot do Codex com o selo P1 ("P1 Badge") ainda sem resolver.
# Mesma regra do codex_p1() do merge-train.sh, agora como check obrigatório (.github/workflows/codex-gate.yml).
#
#   infra/ops/codex-gate.sh <pr>        # gh autenticado; GH_REPO=dono/repo (padrão: o do checkout)
#
# Espera o review do commit atual. O Codex reage com 👀 enquanto revisa e mantém um comentário-resumo com o estado
# em JSON (codex-review-state:v1: status e o commit revisado). Vale como pronto só o review terminado do commit atual
# do PR (head). Review de um commit anterior, ou só o 👍 (que não diz o commit), não basta enquanto durar a espera:
#   - CODEX_WAIT_MIN (padrão 10) depois de o PR abrir: o review de abertura costuma chegar em poucos minutos;
#   - CODEX_PUSH_WAIT_MIN (padrão 3) depois do commit atual: se o Codex estiver revisando pushes, o 👀 aparece aí, e
#     o portão espera o review terminar.
# Fim da espera sem review do commit atual: o Codex só revisa ao abrir o PR, ao sair de rascunho ou com
# "@codex review", então nenhum review vai chegar. O portão confere as threads que existem e avisa que o commit atual
# não foi revisado. CODEX_REQUIRE_CURRENT=1 faz isso falhar (aí é preciso pedir "@codex review" no PR). PR sem nada do
# Codex (Dependabot, PR anterior à integração) passa com aviso: o portão barra P1 aberto, não a falta de review.
# Review rodando no fim da espera: espera mais CODEX_WAIT_MIN. Se não terminar (Codex travado ou sem cota), ou se o
# review em andamento é de um commit anterior ao atual (o resumo diz o commit), é como o review que falhou: avisa e
# confere as threads. P1 aberto barra sempre; o review que terminar depois dispara o check de novo (pull_request_review).
# Saída: 0 = sem P1 aberto; 1 = P1 aberto, review atual exigido e ausente, ou o GitHub não respondeu.
set -euo pipefail

PR="${1:?uso: codex-gate.sh <número do PR>}"
REPO="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
WAIT_MIN="${CODEX_WAIT_MIN:-10}"
PUSH_WAIT_MIN="${CODEX_PUSH_WAIT_MIN:-3}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

read -r created head < <(gh api "repos/$REPO/pulls/$PR" --jq '"\(.created_at) \(.head.sha)"')
pushed="$(gh api "repos/$REPO/commits/$head" --jq .commit.committer.date)"

# "<estado> <commit do último review>": running | current (terminado no commit atual) | stale (terminado num commit
# anterior, ou só o 👍) | old (rodando, mas num commit anterior) | failed (o Codex não terminou: sem cota ou erro
# dele; o 👀 pode ficar) | none
review_state() {
  local reactions status sha state
  # 👀 = review rodando; 👍 = terminou sem achado
  reactions="$(gh api "repos/$REPO/issues/$PR/reactions" --paginate \
    --jq '.[] | select(.user.login | test("codex")) | .content' | sort -u | tr '\n' ' ')"
  # estado e commit do último review no comentário-resumo do bot
  read -r status sha < <(gh api "repos/$REPO/issues/$PR/comments" --paginate \
    --jq '.[] | select(.user.login | test("codex")) | .body
      | capture("codex-review-state:v1 (?<j>[{].*?[}]) -->").j | fromjson
      | "\(.code_review.status // "-") \(.code_review.commit_sha // "-")"' | tail -n 1) || true
  case " $reactions ${status:--}" in
    *" failed") state=failed ;;
    *" eyes "*) state=running ;;
    *" completed") if [ "${sha:--}" = "$head" ]; then state=current; else state=stale; fi ;;
    *" -") case " $reactions" in *" +1 "*) state=stale ;; *) state=none ;; esac ;;
    *) state=running ;;
  esac
  # o resumo diz que o review em andamento é de um commit anterior: o do commit atual não começou
  if [ "$state" = running ] && [ "${status:--}" = running ] && [ "${sha:--}" != - ] && [ "$sha" != "$head" ]; then
    state=old
  fi
  echo "$state ${sha:--}"
}

deadline=$(($(date -d "$created" +%s) + WAIT_MIN * 60))
push_deadline=$(($(date -d "$pushed" +%s) + PUSH_WAIT_MIN * 60))
[ "$push_deadline" -le "$deadline" ] || deadline=$push_deadline
while :; do
  read -r state reviewed < <(review_state)
  now=$(date +%s)
  [ "$state" = current ] && break
  # review que falhou não vai terminar: decide já, como no fim da espera
  [ "$state" = failed ] && deadline=$now
  if [ "$now" -ge "$deadline" ]; then
    if [ "$state" = running ] && [ "$now" -lt $((deadline + WAIT_MIN * 60)) ]; then
      echo "review do Codex rodando; esperando terminar"
      sleep 30
      continue
    fi
    if [ "$state" = running ]; then
      msg="o review do Codex continua rodando depois de $WAIT_MIN min a mais de espera (travado ou sem cota; peça \"@codex review\" se ele não voltar)"
    elif [ "$state" = old ]; then
      msg="o review do Codex em andamento é do commit ${reviewed:0:7}, não do atual ${head:0:7} (peça \"@codex review\" para revisar o atual)"
    elif [ "$state" = failed ]; then
      msg="o review do Codex do commit ${reviewed:0:7} falhou (sem cota ou erro do Codex; peça \"@codex review\" quando ele voltar)"
    elif [ "$state" = stale ]; then
      msg="o último review do Codex é do commit ${reviewed:0:7}, não do atual ${head:0:7} (o Codex revisa ao abrir o PR, ao sair de rascunho ou com \"@codex review\")"
    else
      msg="nenhum review do Codex no PR"
    fi
    if [ -n "${CODEX_REQUIRE_CURRENT:-}" ]; then
      echo "::error::PR #$PR: $msg; peça \"@codex review\" e rode o check de novo"
      echo "❌ PR #$PR: $msg." >> "$SUMMARY"
      exit 1
    fi
    echo "::warning::PR #$PR: $msg; conferindo as threads que existem"
    echo "⚠️ PR #$PR: $msg." >> "$SUMMARY"
    break
  fi
  echo "review do Codex: $state; esperando o do commit ${head:0:7} (até $(date -u -d "@$deadline" +%H:%MZ))"
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
