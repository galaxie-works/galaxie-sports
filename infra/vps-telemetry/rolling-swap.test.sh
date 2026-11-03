#!/usr/bin/env bash
# Teste da troca sem página de manutenção (rolling-swap.sh) contra o Traefik de verdade, no CI (docker.yml › valida
# stack): uma stack descartável com o Traefik da VPS (mesma versão) e um app com healthcheck e o gsports-retry, como a
# API e a demo. Enquanto a troca roda, um laço pede a rota pelo Traefik a cada 50 ms; qualquer resposta que não seja
# 200 falha o teste. Depois, uma versão que nunca fica healthy: a troca tem de falhar e a versão anterior seguir no ar.
# Depois, um worker sem HTTP (como a configuração antiga dos webhooks): com e sem healthcheck, troca com um contêiner só.
# Por último, o site e o console no mesmo host (issue #546), com as prioridades e o PathRegexp do compose.yml: os prefixos
# do console vão para ele e o resto para o site; com o console fora, os prefixos dele caem na manutenção e o site segue;
# o --retire tira um serviço e a troca de um serviço sem contêiner no ar espera o healthy.
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
      - --accesslog=true
      - --accesslog.format=json
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
  worker:
    image: caddy:2.11.7-alpine
    command: ['sh', '-c', "trap 'exit 0' TERM; while :; do sleep 1 & wait $$!; done"]
    environment:
      APP_VERSION: ${APP_VERSION}
    healthcheck:
      disable: true
  # site e console como no compose.yml da VPS (prioridades 1000, 1500 e 2000, PathRegexp com o $ escapado), em outro host
  site: &web
    image: caddy:2.11.7-alpine
    command: ['caddy', 'respond', '--listen', ':80', '--body', 'site']
    healthcheck: &web-health
      test: ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:80/']
      interval: 2s
      timeout: 2s
      retries: 2
      start_period: 1s
      start_interval: 1s
    labels:
      - traefik.enable=true
      - traefik.http.routers.site.rule=Host(`web.test`)
      - traefik.http.routers.site.entrypoints=websecure
      - traefik.http.routers.site.priority=1000
      - traefik.http.routers.site.service=site
      - traefik.http.services.site.loadbalancer.server.port=80
      - traefik.http.routers.console-maintenance.rule=Host(`web.test`) && PathRegexp(`^/(ajustes|api/ajustes|api/cliente|cliente)(/|$$)`)
      - traefik.http.routers.console-maintenance.entrypoints=websecure
      - traefik.http.routers.console-maintenance.priority=1500
      - traefik.http.routers.console-maintenance.service=maintenance
  console:
    <<: *web
    command: ['caddy', 'respond', '--listen', ':80', '--body', 'console']
    labels:
      - traefik.enable=true
      - traefik.http.routers.console.rule=Host(`web.test`) && PathRegexp(`^/(ajustes|api/ajustes|api/cliente|cliente)(/|$$)`)
      - traefik.http.routers.console.entrypoints=websecure
      - traefik.http.routers.console.priority=2000
      - traefik.http.routers.console.service=console
      - traefik.http.services.console.loadbalancer.server.port=80
  maintenance:
    image: caddy:2.11.7-alpine
    command: ['caddy', 'respond', '--listen', ':80', '--status', '503', '--body', 'manutencao']
    healthcheck:
      disable: true
    labels:
      - traefik.enable=true
      - traefik.http.routers.maintenance-host.rule=Host(`maintenance.test`)
      - traefik.http.routers.maintenance-host.entrypoints=websecure
      - traefik.http.routers.maintenance-host.service=maintenance
      - traefik.http.services.maintenance.loadbalancer.server.port=80
YML

cleanup() {
  [ -z "${LOOP:-}" ] || kill "$LOOP" 2>/dev/null || true
  TEST_PORT=$PORT APP_VERSION=0 docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

export TEST_PORT=$PORT
# uma linha por requisição: o status (000 = sem resposta) e o código de saída do curl
get() {
  local code rc=0
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") || rc=$?
  echo "${code:-000} $rc"
}
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
  line=$(get)
  echo "$line" >> codes.txt
  sleep 0.05
done) &
LOOP=$!
APP_VERSION=2 bash "$HERE/rolling-swap.sh" app
sleep 3
kill "$LOOP"
LOOP=""
total=$(grep -cE '^[0-9]{3} ' codes.txt)
bad=$(grep -E '^[0-9]{3} ' codes.txt | grep -vc '^200 0$' || true)
echo "requisições durante a troca: $total · fora de 200: $bad"
[ "$total" -ge 20 ] || {
  echo "FAIL  laço de requisições curto demais ($total)"
  exit 1
}
[ "$bad" = 0 ] || {
  echo "FAIL  respostas fora de 200 durante a troca (status e código do curl): $(grep -E '^[0-9]{3} ' codes.txt | grep -v '^200 0$' | sort | uniq -c | tr '\n' ' ')"
  APP_VERSION=2 docker compose logs traefik 2>/dev/null | grep -v '"DownstreamStatus":200' | tail -n 20
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

echo "── worker sem healthcheck: troca e fica um contêiner só, com a versão nova"
APP_VERSION=2 docker compose up -d --quiet-pull worker
APP_VERSION=4 bash "$HERE/rolling-swap.sh" worker
n=$(APP_VERSION=4 docker compose ps -q worker | grep -c .)
[ "$n" = 1 ] || {
  echo "FAIL  $n contêineres do worker depois da troca (esperado 1)"
  exit 1
}
got=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(APP_VERSION=4 docker compose ps -q worker)" | sed -n 's/^APP_VERSION=//p')
[ "$got" = 4 ] || {
  echo "FAIL  o worker ficou na versão '$got', não 4"
  exit 1
}
echo "ok  worker sem healthcheck trocado"

echo "── site e console no mesmo host: prefixos do console nele, o resto no site; console fora não afeta o site"
web() { curl -s -m 2 -H 'Host: web.test' "http://127.0.0.1:$PORT$1" || true; }
web_status() { curl -s -m 2 -o /dev/null -w '%{http_code}' -H 'Host: web.test' "http://127.0.0.1:$PORT$1" || true; }
# espera cada caminho responder o corpo esperado (o Traefik leva um instante para ver contêiner novo, parado ou saudável)
expect_web() {
  local path want got=""
  for _ in $(seq 60); do
    got=""
    for pair in "$@"; do
      path="${pair%%=*}"
      want="${pair#*=}"
      got="$(web "$path")"
      [ "$got" = "$want" ] || break
    done
    [ "$got" = "$want" ] && return 0
    sleep 1
  done
  echo "FAIL  $path respondeu '$got', não '$want'"
  APP_VERSION=4 docker compose ps -a
  exit 1
}
APP_VERSION=4 docker compose up -d --quiet-pull site console maintenance
expect_web /=site /times/1=site /clientes=site /ajustes-antigos=site /login=site /api/auth/x=site \
  /cliente=console /cliente/builder/novo=console /ajustes=console /api/ajustes/operacao=console /api/cliente/x=console
echo "ok  console pelos prefixos dele (PathRegexp e prioridade), o resto no site"

APP_VERSION=4 docker compose stop console >/dev/null
expect_web /cliente/builder=manutencao /ajustes=manutencao /=site /times/1=site
[ "$(web_status /cliente)" = 503 ] || {
  echo "FAIL  /cliente com o console fora respondeu $(web_status /cliente), não 503"
  exit 1
}
echo "ok  console fora: os prefixos dele na manutenção (503), o site segue"

APP_VERSION=4 bash "$HERE/rolling-swap.sh" --retire console
n=$(APP_VERSION=4 docker compose ps -aq console | grep -c . || true)
[ "$n" = 0 ] || {
  echo "FAIL  --retire deixou $n contêiner(es) do console"
  exit 1
}
APP_VERSION=4 bash "$HERE/rolling-swap.sh" console
[ "$(docker inspect -f '{{.State.Health.Status}}' "$(APP_VERSION=4 docker compose ps -q console)")" = healthy ] || {
  echo "FAIL  a troca de um serviço sem contêiner no ar terminou antes do healthy"
  exit 1
}
expect_web /cliente=console /=site
echo "ok  --retire tira o serviço, e a troca de um serviço sem contêiner no ar sobe e espera o healthy"
