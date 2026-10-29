#!/usr/bin/env bash
# Segura o deploy enquanto houver jogo ao vivo de prioridade alta (decisão de 28/10/2026: o deploy recria o ingestor e
# corta o ao vivo). Roda no runner, no job de deploy (.github/workflows/deploy.yml), antes de tocar a VPS:
#
#   SHA=<sha> EVENT=workflow_run infra/vps-telemetry/live-hold.sh
#
# Jogo ao vivo de prioridade alta: core.event em starting, live ou break, com início nas últimas 6 h (um jogo que a
# fonte nunca encerrou não segura o deploy para sempre), numa competição com live_priority = high. A consulta é só de
# leitura (transação read-only no Postgres da VPS, pelo mesmo SSH do deploy).
#
#   - nenhum jogo: segue na hora;
#   - com jogo: espera, consultando a cada HOLD_POLL_S (padrão 120 s), e escreve no log e no resumo do Actions quais
#     jogos seguraram e por quanto tempo;
#   - teto HOLD_MAX_MIN (padrão 180 min): passado o teto, publica assim mesmo, com aviso;
#   - FORCE=1 (input force do disparo manual: hotfix): publica sem esperar, com aviso dos jogos no ar;
#   - automático (EVENT=workflow_run) e a main andou durante a espera: sai com result=superseded (o deploy do commit
#     novo, que já espera na fila, cobre este);
#   - consulta falhou (VPS ou banco fora): segue, com aviso. Segurar um deploy que pode ser a correção da queda é pior.
#
# Ambiente: SHA; EVENT; FORCE; VPS e VPS_DIR (como no deploy-gh.sh); GH_TOKEN e GH_REPO (para ver a ponta da main).
# Saída: 0 sempre que o deploy deve seguir ou ser pulado; result=go|superseded no GITHUB_OUTPUT.
set -euo pipefail

: "${SHA:?defina SHA}"
case "${FORCE:-}" in 1 | true | sim | yes) FORCE=1 ;; *) FORCE="" ;; esac
VPS="${VPS:-root@145.223.94.149}"
DIR="${VPS_DIR:-/docker/galaxie-sports}"
POLL="${HOLD_POLL_S:-120}"
MAX_MIN="${HOLD_MAX_MIN:-180}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

ssh() { command ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 "$@"; }

# uma linha por jogo: competição | início (UTC) | status | id
QUERY="set default_transaction_read_only = on;
select c.name, to_char(e.starts_at at time zone 'UTC', 'DD/MM HH24:MI'), e.status, e.id
from core.event e join core.competition c on c.id = e.competition_id
where c.live_priority = 'high' and e.status in ('starting', 'live', 'break')
  and e.starts_at > now() - interval '6 hours'
order by e.starts_at, c.name;"

live_games() {
  printf '%s\n' "$QUERY" | ssh "$VPS" "cd $DIR && docker compose exec -T postgres sh -c 'psql -X -q -t -A -F \" | \" -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -f -'"
}

summary() { printf '%s\n' "$@" >> "$SUMMARY"; }

started=$SECONDS
deadline=$((SECONDS + MAX_MIN * 60))
last_list=""
last_log=-1
while :; do
  if ! games="$(live_games)"; then
    echo "::warning::não deu para consultar os jogos ao vivo na VPS; o deploy segue sem esperar"
    summary "**Espera por jogo ao vivo:** consulta falhou; o deploy seguiu."
    echo "result=go" >> "$OUT"
    exit 0
  fi
  games="$(printf '%s\n' "$games" | sed '/^$/d')"
  waited=$(((SECONDS - started) / 60))
  if [ -z "$games" ]; then
    if [ "$waited" -gt 0 ]; then
      echo "::notice::nenhum jogo ao vivo de prioridade alta depois de $waited min de espera; publicando ${SHA:0:7}"
      summary "**Espera por jogo ao vivo:** $waited min; liberado às $(date -u +%H:%M) UTC."
    else
      echo "nenhum jogo ao vivo de prioridade alta: segue"
    fi
    echo "result=go" >> "$OUT"
    exit 0
  fi
  n="$(printf '%s\n' "$games" | grep -c .)"
  if [ -n "$FORCE" ]; then
    echo "::warning::force=1: publicando ${SHA:0:7} com $n jogo(s) ao vivo de prioridade alta (o ao vivo é cortado durante a troca)"
    printf '%s\n' "$games" | sed 's/^/  ao vivo: /'
    summary "**Espera por jogo ao vivo:** pulada (force=1) com $n jogo(s) no ar:" '' '```' "$games" '```'
    echo "result=go" >> "$OUT"
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::warning::teto de $MAX_MIN min de espera atingido com $n jogo(s) ao vivo de prioridade alta; publicando ${SHA:0:7} assim mesmo"
    summary "**Espera por jogo ao vivo:** teto de $MAX_MIN min; publicado com $n jogo(s) no ar:" '' '```' "$games" '```'
    echo "result=go" >> "$OUT"
    exit 0
  fi
  # o motivo vai para o log quando a lista muda e a cada 15 min
  if [ "$games" != "$last_list" ] || [ $((waited - last_log)) -ge 15 ]; then
    echo "::notice::deploy de ${SHA:0:7} esperando: $n jogo(s) ao vivo de prioridade alta (há $waited min; teto $MAX_MIN min; force=1 no disparo manual publica já)"
    printf '%s\n' "$games" | sed 's/^/  ao vivo: /'
    [ "$games" = "$last_list" ] || summary "**Espera por jogo ao vivo** (desde $(date -u -d "@$(($(date +%s) - waited * 60))" +%H:%M) UTC):" '' '```' "$games" '```'
    last_list="$games"
    last_log=$waited
  fi
  # automático: commit mais novo na main durante a espera → o deploy dele (na fila) cobre este
  if [ "${EVENT:-}" = workflow_run ] && [ -n "${GH_TOKEN:-}" ] && [ -n "${GH_REPO:-}" ]; then
    head="$(gh api "repos/$GH_REPO/commits/main" --jq .sha 2>/dev/null)" || head=""
    if [ -n "$head" ] && [ "$head" != "$SHA" ]; then
      echo "::notice::a main já está em ${head:0:7}; o deploy dele cobre ${SHA:0:7} (e espera o mesmo jogo)"
      summary "**Espera por jogo ao vivo:** $waited min; substituído pelo deploy de ${head:0:7}."
      echo "result=superseded" >> "$OUT"
      exit 0
    fi
  fi
  sleep "$POLL"
done
