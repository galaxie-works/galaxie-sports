#!/usr/bin/env bash
# Alerta do Grafana vira issue: abre uma issue com o rótulo `alerta` quando o alerta dispara e a fecha quando resolve.
# Roda no workflow .github/workflows/alerta-grafana.yml, que o contato issue-github do Grafana dispara a cada alerta
# (infra/observability/grafana/alerting/github.yml). Runbook: docs/runbooks/alertas-e-monitoramento.md.
#
#   ALERTA_PAYLOAD='{"status":"firing","fingerprint":"…",…}' infra/ops/alerta-issue.sh   # gh autenticado; GH_REPO
#
# O payload (template galaxie.github.payload) traz um alerta só: status (firing|resolved), fingerprint, name, detail,
# severity, summary, startsAt, endsAt, url e labels. A fingerprint (a mesma para os mesmos rótulos) vai num marcador
# escondido no corpo da issue e é a chave da deduplicação:
#   - firing sem issue aberta: abre "Alerta: <detail>" com o rótulo `alerta` (e `critico` se severity=critical);
#   - firing com issue aberta: nada (o Grafana repete a cada 12 h; a issue já está lá);
#   - resolved com issue aberta: comenta a hora e fecha como concluída;
#   - resolved sem issue aberta: nada (alguém fechou à mão, ou o alerta disparou antes do canal existir).
set -euo pipefail

REPO="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
P="${ALERTA_PAYLOAD:?defina ALERTA_PAYLOAD com o JSON do alerta}"

field() { jq -r --arg k "$1" '.[$k] // "" | tostring' <<<"$P"; }
status="$(field status)"
fp="$(field fingerprint)"
case "$fp" in '' | *[!0-9a-f]*)
  echo "::error::fingerprint inválida no payload: '$fp'"
  exit 1
  ;;
esac
case "$status" in firing | resolved) ;; *)
  echo "::error::status inesperado no payload: '$status'"
  exit 1
  ;;
esac

name="$(field name)"
detail="$(field detail)"
severity="$(field severity)"
summary="$(field summary)"
url="$(field url)"
marker="<!-- alerta-grafana fingerprint=$fp -->"

# hora de Brasília para quem lê; "0001-01-01…" (sem fim) vira vazio
when() {
  case "$1" in '' | 0001-*) return ;; esac
  TZ=America/Sao_Paulo date -d "$1" '+%d/%m/%Y %H:%M (Brasília)'
}
since="$(when "$(field startsAt)")"
until_="$(when "$(field endsAt)")"

# só issues abertas do rótulo; o corpo é lido aqui (a busca do GitHub demora a indexar a issue recém-aberta)
open_issue="$(gh issue list -R "$REPO" --label alerta --state open --limit 200 --json number,body |
  jq -r --arg m "$marker" '[.[] | select(.body | contains($m))][0].number // empty')"

if [ "$status" = resolved ]; then
  if [ -z "$open_issue" ]; then
    echo "::notice::$name resolveu sem issue aberta (fingerprint $fp): nada a fazer"
    exit 0
  fi
  gh issue comment "$open_issue" -R "$REPO" --body "Resolvido no Grafana${until_:+ em $until_}. Fechando."
  gh issue close "$open_issue" -R "$REPO" --reason completed
  echo "::notice::$name resolveu: issue #$open_issue fechada"
  exit 0
fi

if [ -n "$open_issue" ]; then
  echo "::notice::$name segue disparando: issue #$open_issue já aberta"
  exit 0
fi

ensure_label() {
  gh label create "$1" -R "$REPO" --color "$2" --description "$3" >/dev/null 2>&1 || true
}
ensure_label alerta B60205 'Alerta do Grafana (aberta e fechada pelo alerta-grafana.yml)'
labels=alerta
if [ "$severity" = critical ]; then
  ensure_label critico D93F0B 'Alerta crítico: um dos 5 sinais graves'
  labels=alerta,critico
fi

labels_md="$(jq -r '.labels // {} | to_entries | map("| `\(.key)` | `\(.value | gsub("[|`]"; " "))` |") | .[]' <<<"$P")"
title="Alerta: ${detail:-${name:-sem nome}}"
body="$(
  cat <<EOF
$marker
**${summary:-$name}** disparou no Grafana${since:+ em $since}.

- Gravidade: \`${severity:-sem rótulo}\`
- Regra no Grafana: ${url:-(sem link)} (túnel SSH, ver o runbook)
- Runbook: [docs/runbooks/alertas-e-monitoramento.md](https://github.com/$REPO/blob/main/docs/runbooks/alertas-e-monitoramento.md)

| Rótulo | Valor |
|---|---|
$labels_md

Esta issue fecha sozinha quando o alerta resolver no Grafana. Fechar à mão antes disso é seguro: se o alerta ainda
estiver disparando, uma issue nova abre em até 12 h.
EOF
)"
new="$(gh issue create -R "$REPO" --title "${title:0:240}" --label "$labels" --body "$body")"
echo "::notice::$name disparou: $new"
