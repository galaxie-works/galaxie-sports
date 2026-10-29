#!/usr/bin/env bash
# Teste da troca sem página de manutenção (rolling-swap.sh) contra o Traefik de verdade, no CI (docker.yml › valida
# stack): uma stack descartável com o Traefik da VPS (mesma versão) e um app com healthcheck e o gsports-retry, como a
# API e a demo. Enquanto a troca roda, um laço pede a rota pelo Traefik a cada 50 ms; qualquer resposta que não seja
# 200 falha o teste. Depois, uma versão que nunca fica healthy: a troca tem de falhar e a versão anterior seguir no ar.
#
#   bash infra/vps-telemetry/rolling-swap.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
PORT="${TEST_PORT:-18081}"
export COMPOSE_PROJECT_NAME=rolling-swap-test
cd "$WORK"

cat > compose.yml <<'YML'
services:
  traefik:
    image: traefik:v3.7.16
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=rolling-swap-test_default
      - --entrypoints.websecure.address=:8081
    ports: ['${TEST_PORT}:8081']
    volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro']
  app:
    image: caddy:2.11.7-alpine
    command: ['caddy', 'respond', '--listen', ':80', '--body', 'v${APP_VERSION}']
    environment:
      APP_VERSION: ${APP_VERSION}
    healthcheck:
      test: ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:80/ && ${APP_HEALTHY:-true}']
      interval: 2s
      timeout: 2s
      retries: 2
      start_period: 1s
      start_interval: 1s
    labels:
      - traefik.enable=true
      - traefik.http.middlewares.gsports-retry.retry.attempts=2
      - traefik.http.middlewares.gsports-retry.retry.initialinterval=100ms
      - traefik.http.routers.app.rule=PathPrefix(`/`)
      - traefik.http.routers.app.entrypoints=websecure
      - traefik.http.routers.app.middlewares=gsports-retry
      - traefik.http.services.app.loadbalancer.server.port=80
YML

cleanup() {
  [ -z "${LOOP:-}" ] || kill "$LOOP" 2>/dev/null || true
  TEST_PORT=$PORT APP_VERSION=0 docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

export TEST_PORT=$PORT
get() { curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || echo 000; }
body() { curl -s -m 2 "http://127.0.0.1:$PORT/" || true; }
wait_body() {
  for _ in $(seq 60); do
    [ "$(body)" = "$1" ] && return 0
    sleep 1
  done
  echo "FAIL  a rota não respondeu '$1' em 60 s"
  docker compose ps -a
  docker compose logs --tail 20 traefik
  exit 1
}

echo "── v1 no ar"
APP_VERSION=1 docker compose up -d --quiet-pull
wait_body v1

echo "── troca para v2 com tráfego a cada 50 ms"
: > codes.txt
(while :; do
  get >> codes.txt
  echo >> codes.txt
  sleep 0.05
done) &
LOOP=$!
APP_VERSION=2 bash "$HERE/rolling-swap.sh" app
sleep 3
kill "$LOOP"
LOOP=""
total=$(grep -c . codes.txt)
bad=$(grep -vc '^200$' codes.txt || true)
echo "requisições durante a troca: $total · fora de 200: $bad"
[ "$total" -ge 20 ] || {
  echo "FAIL  laço de requisições curto demais ($total)"
  exit 1
}
[ "$bad" = 0 ] || {
  echo "FAIL  respostas fora de 200 durante a troca: $(grep -v '^200$' codes.txt | sort | uniq -c | tr '\n' ' ')"
  exit 1
}
[ "$(body)" = v2 ] || {
  echo "FAIL  depois da troca a rota responde '$(body)', não v2"
  exit 1
}
n=$(APP_VERSION=2 docker compose ps -q app | grep -c .)
[ "$n" = 1 ] || {
  echo "FAIL  $n contêineres do app depois da troca (esperado 1)"
  exit 1
}
APP_VERSION=2 docker compose up -d --quiet-pull 2>&1 | grep -q 'Recreate' && {
  echo "FAIL  o up -d seguinte recriou o app (a troca deixou uma configuração diferente)"
  exit 1
}
echo "ok  troca sem nenhuma resposta fora de 200, um contêiner só, e o up -d seguinte não recria"

echo "── v3 nunca fica healthy: a troca falha e a v2 segue"
if APP_VERSION=3 APP_HEALTHY=false SWAP_HEALTH_TIMEOUT=20 bash "$HERE/rolling-swap.sh" app; then
  echo "FAIL  a troca para uma versão sem healthcheck verde passou"
  exit 1
fi
[ "$(body)" = v2 ] || {
  echo "FAIL  depois da troca recusada a rota responde '$(body)', não v2"
  exit 1
}
n=$(APP_VERSION=2 docker compose ps -q app | grep -c .)
[ "$n" = 1 ] || {
  echo "FAIL  $n contêineres do app depois da troca recusada (esperado 1)"
  exit 1
}
echo "ok  troca recusada: o contêiner novo saiu e a v2 seguiu no ar"
