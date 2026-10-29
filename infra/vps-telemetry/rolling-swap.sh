#!/usr/bin/env bash
# Troca sem página de manutenção: sobe o contêiner novo de cada serviço ao lado do que está no ar, espera o healthcheck
# dele e só então para o antigo. Roda NA VPS, em /docker/galaxie-sports, depois de o deploy-gh.sh pôr o compose.yml e
# o .env novos no lugar (e no CI, contra uma stack de teste com Traefik: docker.yml › troca sem manutenção):
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- api demo' < rolling-swap.sh
#
# Para cada serviço, na ordem dada:
#   1. docker compose up --no-deps --no-recreate --scale <serviço>=N+1: um contêiner a mais, com a configuração nova;
#      o antigo continua atendendo
#   2. espera o novo ficar healthy (o Traefik só balanceia contêiner healthy; teto SWAP_HEALTH_TIMEOUT, padrão 180 s)
#   3. SWAP_SETTLE_S (padrão 3 s) para o Traefik pôr o novo no balanceamento, e docker stop no antigo: ele para de
#      aceitar conexão no SIGTERM, e o gsports-retry do Traefik manda a requisição recusada para o novo
#   4. remove o antigo; o serviço fica com um contêiner só, na configuração nova (o `up -d` seguinte não o recria)
# Novo sem ficar healthy: sai o novo, o antigo segue no ar e o script sai com 1 (o deploy volta para a versão anterior).
# Serviço sem contêiner no ar: só sobe. Sem COMPOSE_FILE, usa o compose.yml do diretório.
set -euo pipefail
export PULL_POLICY="${PULL_POLICY:-missing}"

TIMEOUT="${SWAP_HEALTH_TIMEOUT:-180}"
SETTLE="${SWAP_SETTLE_S:-3}"
STOP_GRACE="${SWAP_STOP_GRACE_S:-30}"

health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null ||
    echo ausente
}

for svc in "$@"; do
  mapfile -t old < <(docker compose ps -q "$svc" </dev/null)
  if [ "${#old[@]}" -eq 0 ]; then
    echo "$svc: nada no ar; subindo"
    docker compose up -d --no-deps --quiet-pull "$svc" </dev/null
    continue
  fi
  docker compose up -d --no-deps --no-recreate --quiet-pull --scale "$svc=$((${#old[@]} + 1))" "$svc" </dev/null
  new=""
  for id in $(docker compose ps -q "$svc" </dev/null); do
    printf '%s\n' "${old[@]}" | grep -qx "$id" || new="$id"
  done
  if [ -z "$new" ]; then
    echo "FAIL  $svc: o contêiner novo não apareceu"
    exit 1
  fi
  deadline=$((SECONDS + TIMEOUT))
  while :; do
    st="$(health "$new")"
    case "$st" in
      healthy) break ;;
      starting | running) ;;
      *)
        echo "FAIL  $svc: contêiner novo está $st"
        docker logs --tail 30 "$new" 2>&1 | sed 's/^/      /' || true
        docker rm -f "$new" >/dev/null
        exit 1
        ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL  $svc: contêiner novo não ficou healthy em $TIMEOUT s; o antigo segue no ar"
      docker rm -f "$new" >/dev/null
      exit 1
    fi
    sleep 2
  done
  sleep "$SETTLE"
  docker stop -t "$STOP_GRACE" "${old[@]}" >/dev/null
  docker rm "${old[@]}" >/dev/null
  echo "ok  $svc trocado sem manutenção (${new:0:12} no ar)"
done
