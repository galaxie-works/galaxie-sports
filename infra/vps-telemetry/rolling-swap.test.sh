#!/usr/bin/env bash
# Teste da troca sem página de manutenção (rolling-swap.sh) contra o Traefik de verdade, no CI (docker.yml › valida
# stack): uma stack descartável com o Traefik da VPS (mesma versão) e um app com healthcheck e o gsports-retry, como a
# API e a demo. Enquanto a troca roda, um laço pede a rota pelo Traefik a cada 50 ms; qualquer resposta que não seja
# 200 falha o teste. Depois, uma versão que nunca fica healthy: a troca tem de falhar e a versão anterior seguir no ar.
# Depois, um worker sem HTTP (como a configuração antiga dos webhooks): com e sem healthcheck, troca com um contêiner só.
# Por último, um serviço com duas cópias e líder (como o `live`, #537): a líder é quem segura um flock num volume
# comum; a troca é cópia a cópia, a líder primeiro, sem ficar com menos de uma cópia healthy (nem sem líder por mais que
# a passagem), e termina com as duas cópias na versão nova. Uma versão que nunca fica healthy deixa as duas antigas. E a
# primeira troca para duas cópias (o live estava com uma): troca a que existe e sobe a segunda.
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
  # duas cópias; a líder é quem pega o flock e grava o hostname (o do contêiner, como o live_leader{instance})
  live:
    image: busybox:1.37
    command:
      - sh
      - -c
      - "trap 'exit 0' TERM; flock /shared/lock sh -c 'hostname > /shared/leader; exec sleep 2147483647' & while :; do sleep 1 & wait $$!; done"
    environment:
      APP_VERSION: ${APP_VERSION}
    volumes: [shared:/shared]
    stop_grace_period: 5s
    healthcheck:
      test: ['CMD-SHELL', '${APP_HEALTHY:-true}']
      interval: 2s
      timeout: 2s
      retries: 2
      start_period: 1s
      start_interval: 1s
    deploy:
      replicas: ${LIVE_REPLICAS:-2}
volumes:
  shared:
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
# só o app e o Traefik: worker e live sobem nas seções deles
APP_VERSION=1 docker compose up -d --quiet-pull traefik app
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
# a saída inteira antes do grep: o grep -q fecharia o pipe e cortaria o compose no meio de uma recriação
up_out="$(APP_VERSION=2 docker compose up -d --quiet-pull traefik app 2>&1)"
grep -q 'Recreate' <<< "$up_out" && {
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

echo "── live com duas cópias e líder: troca cópia a cópia, a líder primeiro, sem ficar sem cópia healthy"
copies() { docker ps -q --filter label=com.docker.compose.project=rolling-swap-test --filter label=com.docker.compose.service=live "$@"; }
leader() { docker exec "$(copies --filter status=running | head -n 1)" cat /shared/leader 2>/dev/null || true; }
APP_VERSION=1 docker compose up -d --quiet-pull live
for _ in $(seq 60); do
  [ "$(copies --filter health=healthy | grep -c .)" = 2 ] && [ -n "$(leader)" ] && break
  sleep 1
done
[ "$(copies --filter health=healthy | grep -c .)" = 2 ] || {
  echo "FAIL  as duas cópias v1 não ficaram healthy"
  exit 1
}
old_leader="$(leader)"
old_leader_id=""
for id in $(copies); do [ "$(docker inspect -f '{{.Config.Hostname}}' "$id")" = "$old_leader" ] && old_leader_id="$id"; done
: > healthy.txt
(while :; do
  echo "$(copies --filter health=healthy | grep -c .) $(leader)" >> healthy.txt
  sleep 0.2
done) &
LOOP=$!
APP_VERSION=2 SWAP_LEADER_CMD='cat /shared/leader' SWAP_LEADER_TIMEOUT=20 bash "$HERE/rolling-swap.sh" live | tee swap.txt
kill "$LOOP"
LOOP=""
min=$(awk '{print $1}' healthy.txt | sort -n | head -n 1)
echo "amostras: $(grep -c . healthy.txt) · mínimo de cópias healthy durante a troca: $min"
[ "$min" -ge 1 ] || {
  echo "FAIL  a troca ficou com $min cópia(s) healthy"
  exit 1
}
first="$(sed -n 's/^ok  live: cópia \([0-9a-f]*\) trocada.*/\1/p' swap.txt | head -n 1)"
[ -n "$old_leader_id" ] && [ "${old_leader_id:0:12}" = "$first" ] || {
  echo "FAIL  a primeira cópia trocada ($first) não foi a líder (${old_leader_id:0:12}, $old_leader)"
  exit 1
}
grep -q "^ok  live: liderança passou de $old_leader para " swap.txt || {
  echo "FAIL  a troca não esperou a liderança passar"
  exit 1
}
n=$(copies | grep -c .)
[ "$n" = 2 ] || {
  echo "FAIL  $n cópias depois da troca (esperado 2)"
  exit 1
}
for id in $(copies); do
  got=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" | sed -n 's/^APP_VERSION=//p')
  [ "$got" = 2 ] || {
    echo "FAIL  cópia ${id:0:12} na versão '$got', não 2"
    exit 1
  }
done
new_leader="$(leader)"
hosts=$(for id in $(copies); do docker inspect -f '{{.Config.Hostname}}' "$id"; done)
grep -qx "$new_leader" <<< "$hosts" || {
  echo "FAIL  a líder depois da troca ($new_leader) não é uma das cópias novas"
  exit 1
}
up_out="$(APP_VERSION=2 docker compose up -d --quiet-pull live 2>&1)"
grep -q 'Recreate' <<< "$up_out" && {
  echo "FAIL  o up -d seguinte recriou o live (a troca deixou uma configuração diferente)"
  exit 1
}
echo "ok  duas cópias trocadas uma a uma, a líder primeiro ($old_leader → $new_leader), mínimo de $min healthy"

echo "── live v3 nunca fica healthy: a troca falha e as duas v2 seguem, com líder"
if APP_VERSION=3 APP_HEALTHY=false SWAP_HEALTH_TIMEOUT=15 SWAP_LEADER_CMD='cat /shared/leader' bash "$HERE/rolling-swap.sh" live; then
  echo "FAIL  a troca para uma versão sem healthcheck verde passou"
  exit 1
fi
n=$(copies | grep -c .)
[ "$n" = 2 ] || {
  echo "FAIL  $n cópias depois da troca recusada (esperado 2)"
  exit 1
}
grep -qx "$(leader)" <<< "$(for id in $(copies); do docker inspect -f '{{.Config.Hostname}}' "$id"; done)" || {
  echo "FAIL  sem líder entre as cópias v2 depois da troca recusada"
  exit 1
}
echo "ok  troca do live recusada: a cópia nova saiu e as duas v2 seguiram, com líder"

echo "── live de uma cópia para duas (a primeira troca com duas cópias): troca a que existe e sobe a segunda"
APP_VERSION=2 LIVE_REPLICAS=1 docker compose up -d --quiet-pull live
for _ in $(seq 30); do
  [ "$(copies | grep -c .)" = 1 ] && [ "$(copies --filter health=healthy | grep -c .)" = 1 ] && break
  sleep 1
done
[ "$(copies | grep -c .)" = 1 ] || {
  echo "FAIL  o live não ficou com uma cópia ($(copies | grep -c .))"
  exit 1
}
APP_VERSION=4 LIVE_REPLICAS=2 SWAP_LEADER_CMD='cat /shared/leader' SWAP_LEADER_TIMEOUT=20 bash "$HERE/rolling-swap.sh" live | tee swap.txt
grep -q '^ok  live: 1 → 2 cópia(s), como no compose' swap.txt || {
  echo "FAIL  a troca não subiu a segunda cópia"
  exit 1
}
[ "$(copies --filter health=healthy | grep -c .)" = 2 ] || {
  echo "FAIL  $(copies --filter health=healthy | grep -c .) cópia(s) healthy depois da troca de 1 para 2"
  exit 1
}
for id in $(copies); do
  got=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" | sed -n 's/^APP_VERSION=//p')
  [ "$got" = 4 ] || {
    echo "FAIL  cópia ${id:0:12} na versão '$got', não 4"
    exit 1
  }
done
echo "ok  de uma cópia para duas: a que existia trocada, a segunda subiu na versão nova"
