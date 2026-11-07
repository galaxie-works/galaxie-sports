#!/usr/bin/env bash
# "Sugerir ou reportar algo" do app vira issue: o formulário do cabeçalho (apps/demo/src/lib/feedback/actions.ts)
# dispara o workflow .github/workflows/sugestao-issue.yml com o envio em JSON, e este script cria o rótulo do assunto
# (se ainda não existir) e abre a issue com esse rótulo. Mesmo caminho do alerta do Grafana (alerta-issue.sh).
#
#   SUGESTAO_PAYLOAD='{"v":1,"subject":"bug",…}' infra/ops/sugestao-issue.sh   # gh autenticado; GH_REPO
#
# O payload (FeedbackPayload em apps/demo/src/lib/feedback/github.ts) já chega mascarado: e-mail e tenant com metade
# escondida. Título: "<assunto>: <primeiros 50 caracteres da mensagem>". Corpo: a mensagem, a tabela com quem enviou
# (mascarado), a página, o idioma, a tela, o navegador e a versão, e as imagens anexadas (URLs do storage de assets).
# A mensagem é texto de quem usa o app: `@` vira `@` + espaço de largura zero, para não notificar ninguém.
set -euo pipefail

REPO="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
P="${SUGESTAO_PAYLOAD:?defina SUGESTAO_PAYLOAD com o JSON do envio}"

jq -e 'type == "object" and .v == 1' >/dev/null <<<"$P" || {
  echo "::error::payload inválido (esperado um objeto com v=1)"
  exit 1
}
field() { jq -r --arg k "$1" '.[$k] // "" | tostring' <<<"$P"; }

subject="$(field subject)"
# rótulo = assunto escolhido, em pt-BR (os mesmos textos de feedback.subjects no app); cor e descrição na criação
case "$subject" in
  bug) label='Reportar um problema' color='d73a4a' ;;
  feature) label='Sugerir um recurso' color='a2eeef' ;;
  content) label='Sugerir correção de um conteúdo' color='fbca04' ;;
  data) label='Pedir um dado ou cobertura' color='0e8a16' ;;
  question) label='Tirar uma dúvida' color='d876e3' ;;
  other) label='Outro assunto' color='c5def5' ;;
  *)
    echo "::error::assunto inesperado no payload: '$subject'"
    exit 1
    ;;
esac

message="$(field message)"
snippet="$(field snippet)"
if [ -z "${message//[[:space:]]/}" ]; then
  echo "::error::mensagem vazia no payload"
  exit 1
fi
# o app manda o trecho pronto; sem ele (envio à mão), corta aqui
[ -n "$snippet" ] || snippet="$(jq -rn --arg m "$message" '$m | gsub("\\s+"; " ") | ltrimstr(" ") | if length > 50 then .[0:50] + "…" else . end')"
title="$label: $snippet"

sent_at="$(field sent_at)"
when=""
[ -n "$sent_at" ] && when="$(TZ=America/Sao_Paulo date -d "$sent_at" '+%d/%m/%Y %H:%M (Brasília)' 2>/dev/null || echo "$sent_at")"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
jq -r --arg label "$label" --arg when "$when" '
  def nomention: gsub("@"; "@​");
  def cell: if . == null or . == "" then "—" else tostring | gsub("[\r\n]+"; " ") | gsub("\\|"; "\\|") | nomention end;
  def code: if . == null or . == "" then "—" else "`" + (tostring | gsub("`"; "'"'"'") | gsub("\\|"; "\\|")) + "`" end;
  def safeurl: test("^https?://[^\\s()<>\"]+$");
  "<!-- sugestao-app v=1 subject=\(.subject) -->",
  "## \($label)",
  "",
  (.message | nomention),
  "",
  "### Detalhes",
  "",
  "| | |",
  "|---|---|",
  "| Assunto | \($label) |",
  "| E-mail | \(.email | code) |",
  "| Tenant | \(.tenant | code) |",
  "| Papel | \(.role | cell) |",
  "| Página | \(.page | code) |",
  "| Idioma | \(.locale | cell) |",
  "| Tela | \(.viewport | cell) |",
  "| Navegador | \(.user_agent | cell) |",
  "| Versão | \(.version | code) |",
  "| Enviado em | \($when | cell) |",
  "",
  (if (.attachments // []) | length > 0 then
    "### Anexos",
    "",
    ((.attachments // [])[] | select(.url | safeurl) |
      (.name // "imagem" | tostring | gsub("[\\[\\]\r\n]"; "")) as $n |
      "![\($n)](\(.url))", "")
  else empty end),
  "_Aberta pelo formulário \"Sugerir ou reportar algo\" do app; e-mail e tenant parcialmente mascarados._"
' <<<"$P" >"$body"

# rótulo do assunto: cria só se faltar (não mexe na cor de um rótulo que alguém já ajustou)
label_uri="$(jq -rn --arg l "$label" '$l | @uri')"
if ! gh api "repos/$REPO/labels/$label_uri" --silent 2>/dev/null; then
  gh label create "$label" -R "$REPO" --color "$color" --description 'Enviado pelo app (Sugerir ou reportar algo)' ||
    gh api "repos/$REPO/labels/$label_uri" --silent # corrida com outro envio: basta existir
fi

url="$(gh issue create -R "$REPO" --title "$title" --body-file "$body" --label "$label")"
echo "::notice::issue aberta: $url"
