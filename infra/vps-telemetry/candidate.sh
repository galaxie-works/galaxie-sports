#!/usr/bin/env bash
# Candidato do deploy: a API e a demo da versão nova ao lado das que estão no ar, sem tráfego de fora, para o smoke
# rodar ANTES da troca. Roda NA VPS, em /docker/galaxie-sports, com o compose.yml.new e o .env.next que o
# deploy-gh.sh deixou lá (a versão no ar segue com o compose.yml e o .env de sempre):
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- up'            < candidate.sh   # sobe e espera healthy
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- smoke <arquivo>' < candidate.sh  # smoke.mjs no candidato
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- down'          < candidate.sh   # tira os dois e as chaves
#
# Serviços api-candidate e demo-candidate do compose.yml (perfil `candidate`): mesmo env e limites da api e da demo,
# sem router no Traefik, a API com o prefixo gs-candidate: no Valkey. CANDIDATE_TIMEOUT (padrão 180 s) é o teto para
# os dois ficarem healthy. Saída ≠ 0 = candidato não subiu ou smoke com FAIL; a versão no ar não foi tocada.
# O script chega pelo stdin (bash -s): todo comando lê de /dev/null.
set -euo pipefail
export PULL_POLICY=missing # as imagens já foram baixadas pelo deploy

C=(docker compose -f compose.yml.new --env-file .env.next --profile candidate)
SERVICES=(api-candidate demo-candidate)

up() {
  "${C[@]}" up -d --no-deps --force-recreate --quiet-pull "${SERVICES[@]}" </dev/null
  local deadline=$((SECONDS + ${CANDIDATE_TIMEOUT:-180})) s id st all
  while :; do
    all=healthy
    for s in "${SERVICES[@]}"; do
      id="$("${C[@]}" ps -aq "$s" </dev/null)"
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)" ||
        st="ausente"
      case "$st" in
        healthy) ;;
        starting | running) all=waiting ;;
        *)
          echo "FAIL  candidato: $s está $st"
          docker logs --tail 30 "$id" 2>&1 | sed 's/^/      /' || true
          return 1
          ;;
      esac
    done
    [ "$all" != healthy ] || break
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL  candidato: não ficou healthy em ${CANDIDATE_TIMEOUT:-180} s"
      "${C[@]}" ps -a "${SERVICES[@]}" </dev/null || true
      return 1
    fi
    sleep 3
  done
  echo "candidato healthy: ${SERVICES[*]}"
}

smoke() {
  local file="${1:?arquivo do smoke}"
  # SMOKE_PHASE=candidate: o smoke sabe que roda antes do pós-deploy (seed semântico, nomes, importância e cache
  # ainda da versão anterior)
  "${C[@]}" exec -T -e SMOKE_PHASE=candidate demo-candidate node - < "$file"
}

down() {
  "${C[@]}" rm -sf "${SERVICES[@]}" </dev/null >/dev/null 2>&1 || true
  # chaves do candidato no Valkey (cache, rate limit, uso, relay): as de cache expiram sozinhas, o resto não
  docker compose exec -T valkey sh -ec '
    keys=$(valkey-cli --scan --pattern "gs-candidate:*")
    [ -z "$keys" ] || printf "%s\n" "$keys" | xargs -n 200 valkey-cli del >/dev/null' </dev/null ||
    echo "WARN  candidato: chaves gs-candidate:* não foram apagadas do Valkey"
}

case "${1:-}" in
  up) up ;;
  smoke) smoke "${2:-}" ;;
  down) down ;;
  *)
    echo "uso: candidate.sh up|smoke <arquivo>|down" >&2
    exit 2
    ;;
esac
