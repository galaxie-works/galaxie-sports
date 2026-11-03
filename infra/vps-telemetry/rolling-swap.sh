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
#   2. espera o novo ficar healthy (o Traefik só balanceia contêiner healthy; teto SWAP_HEALTH_TIMEOUT, padrão 180 s). Sem
#      healthcheck (a configuração de um SHA antigo, na volta de versão): basta estar rodando depois de SWAP_SETTLE_S
#   3. SWAP_SETTLE_S (padrão 3 s) para o Traefik pôr o novo no balanceamento, e docker stop no antigo: ele para de
#      aceitar conexão no SIGTERM, e o gsports-retry do Traefik manda a requisição recusada para o novo
#   4. remove o antigo; o serviço fica com um contêiner só, na configuração nova (o `up -d` seguinte não o recria)
# Novo sem ficar healthy: sai o novo, o antigo segue no ar e o script sai com 1 (o deploy volta para a versão anterior).
# Serviço sem contêiner no ar: só sobe. Sem COMPOSE_FILE, usa o compose.yml do diretório.
#
# Serviço com cópias e líder (o `live`, #537: `deploy.replicas` no compose, líder e reserva pela trava `live:leader`):
# troca UMA cópia por vez e mantém o número de cópias. Para cada cópia antiga, a líder primeiro: sobe uma nova (N+1),
# espera ela ficar healthy, para a antiga (o `stop_grace_period` dela: a líder fecha o tick e solta a trava) e espera
# outra cópia pegar a liderança (teto SWAP_LEADER_TIMEOUT, padrão 60 s) antes de removê-la; depois a próxima. Nunca fica
# com menos de N healthy. No fim, o número de cópias vira o do compose (`deploy.replicas`; a primeira troca de 1 para 2
# sobe a segunda aqui). Quem é a líder sai do `/metrics` de uma cópia (`live_leader{instance}`, o hostname do
# contêiner) ou de SWAP_LEADER_CMD, um comando rodado com `docker exec` numa cópia que imprime o hostname da líder.
# Liderança que não volta no teto: FAIL (o deploy volta o grupo para a configuração anterior).
set -euo pipefail
export PULL_POLICY="${PULL_POLICY:-missing}"

TIMEOUT="${SWAP_HEALTH_TIMEOUT:-180}"
SETTLE="${SWAP_SETTLE_S:-3}"
STOP_GRACE="${SWAP_STOP_GRACE_S:-30}"
LEADER_TIMEOUT="${SWAP_LEADER_TIMEOUT:-60}"

health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null ||
    echo ausente
}

# espera o contêiner ficar healthy (ou rodando, sem healthcheck); falhou, remove o novo e sai com 1
wait_healthy() {
  local svc="$1" id="$2" st deadline=$((SECONDS + TIMEOUT))
  while :; do
    st="$(health "$id")"
    case "$st" in
      healthy) return 0 ;;
      running)
        # só o contêiner sem healthcheck chega aqui: sobreviveu à espera, conta como no ar
        sleep "$SETTLE"
        [ "$(health "$id")" != running ] || return 0
        ;;
      starting) ;;
      *)
        echo "FAIL  $svc: contêiner novo está $st"
        docker logs --tail 30 "$id" 2>&1 | sed 's/^/      /' || true
        docker rm -f "$id" >/dev/null
        exit 1
        ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL  $svc: contêiner novo não ficou healthy em $TIMEOUT s; o antigo segue no ar"
      docker rm -f "$id" >/dev/null
      exit 1
    fi
    sleep 2
  done
}

# sobe uma cópia a mais com a configuração nova e devolve o ID dela
scale_up_one() {
  local svc="$1" before after id
  before="$(docker compose ps -q "$svc" </dev/null)"
  # a saída do compose vai para o stderr: o stdout é o ID da cópia nova
  docker compose up -d --no-deps --no-recreate --quiet-pull --scale "$svc=$(($(grep -c . <<< "$before") + 1))" "$svc" </dev/null >&2
  after="$(docker compose ps -q "$svc" </dev/null)"
  for id in $after; do
    grep -qx "$id" <<< "$before" || {
      echo "$id"
      return 0
    }
  done
}

# o stop_grace_period do contêiner (StopTimeout), ou SWAP_STOP_GRACE_S
grace_of() {
  local t
  t="$(docker inspect -f '{{if .Config.StopTimeout}}{{.Config.StopTimeout}}{{end}}' "$1" 2>/dev/null || true)"
  echo "${t:-$STOP_GRACE}"
}

# hostname da líder, lido numa cópia em execução (vazio se ninguém lidera ou não deu para ler)
leader_host() {
  local svc="$1" id
  for id in $(docker compose ps -q --status running "$svc" </dev/null); do
    if [ -n "${SWAP_LEADER_CMD:-}" ]; then
      docker exec "$id" sh -c "$SWAP_LEADER_CMD" </dev/null 2>/dev/null | tr -d '\r' | head -n 1 && return 0
    else
      # a série vem do Postgres (pg_stat_activity), igual em qualquer cópia; o token é o do próprio contêiner
      docker exec "$id" node -e "fetch('http://127.0.0.1:9464/metrics',{headers:{authorization:'Bearer '+(process.env.METRICS_TOKEN||'')},signal:AbortSignal.timeout(5000)}).then(r=>r.text()).then(t=>{const m=t.match(/^live_leader\{instance=\"([^\"]+)\"\} 1\$/m);console.log(m?m[1]:'')})" </dev/null 2>/dev/null && return 0
    fi
  done
  return 0
}

hostname_of() { docker inspect -f '{{.Config.Hostname}}' "$1" 2>/dev/null || true; }

# troca as cópias de um serviço com líder, uma por vez, a líder primeiro
swap_replicas() {
  local svc="$1" leader host id new t0 now took old_host
  local -a old=() ordered=()
  mapfile -t old < <(docker compose ps -q "$svc" </dev/null)
  leader="$(leader_host "$svc")"
  for id in "${old[@]}"; do
    if [ -n "$leader" ] && [ "$(hostname_of "$id")" = "$leader" ]; then ordered=("$id" "${ordered[@]}"); else ordered+=("$id"); fi
  done
  if [ -n "$leader" ]; then
    echo "$svc: ${#old[@]} cópia(s); líder $leader (troca primeiro)"
  else
    echo "WARN  $svc: não deu para ler a líder; troca na ordem dos contêineres"
  fi
  for id in "${ordered[@]}"; do
    new="$(scale_up_one "$svc")"
    if [ -z "$new" ]; then
      echo "FAIL  $svc: o contêiner novo não apareceu"
      exit 1
    fi
    wait_healthy "$svc" "$new"
    old_host="$(hostname_of "$id")"
    leader="$(leader_host "$svc")"
    t0=$SECONDS
    docker stop -t "$(grace_of "$id")" "$id" >/dev/null
    # o teto da passagem conta depois que a antiga saiu: o fim do tick dela (até o stop_grace_period) não entra
    stopped=$SECONDS
    if [ -n "$leader" ] && [ "$leader" = "$old_host" ]; then
      # a líder saiu: outra cópia (a reserva ou a nova) assume na tentativa seguinte (LIVE_LEADER_RETRY_MS)
      while :; do
        host="$(leader_host "$svc")"
        [ -z "$host" ] || [ "$host" = "$old_host" ] || break
        if [ $((SECONDS - stopped)) -ge "$LEADER_TIMEOUT" ]; then
          echo "FAIL  $svc: nenhuma cópia assumiu a liderança em $LEADER_TIMEOUT s depois de a líder ${id:0:12} sair"
          exit 1
        fi
        sleep 1
      done
      echo "ok  $svc: liderança passou de $old_host para $host em $((SECONDS - t0)) s (a antiga levou $((stopped - t0)) s para fechar o tick e sair)"
    fi
    docker rm "$id" >/dev/null
    echo "ok  $svc: cópia ${id:0:12} trocada por ${new:0:12}"
  done
  # o número de cópias do compose (deploy.replicas): a primeira troca para duas cópias sobe a segunda aqui, e a volta
  # para um compose de uma cópia tira a sobra; quem já está na configuração nova não é recriado
  local -a before=() after=()
  mapfile -t before < <(docker compose ps -q "$svc" </dev/null)
  docker compose up -d --no-deps --no-recreate --quiet-pull "$svc" </dev/null >&2
  mapfile -t after < <(docker compose ps -q "$svc" </dev/null)
  for id in "${after[@]}"; do
    printf '%s\n' "${before[@]}" | grep -qx "$id" || wait_healthy "$svc" "$id"
  done
  [ "${#after[@]}" = "${#before[@]}" ] || echo "ok  $svc: ${#before[@]} → ${#after[@]} cópia(s), como no compose"
  echo "ok  $svc trocado cópia a cópia (${#after[@]} no ar)"
}

for svc in "$@"; do
  mapfile -t old < <(docker compose ps -q "$svc" </dev/null)
  if [ "${#old[@]}" -eq 0 ]; then
    echo "$svc: nada no ar; subindo"
    docker compose up -d --no-deps --quiet-pull "$svc" </dev/null
    continue
  fi
  if [ "$svc" = live ] || [ -n "${SWAP_REPLICAS:-}" ]; then
    swap_replicas "$svc"
    continue
  fi
  new="$(scale_up_one "$svc")"
  if [ -z "$new" ]; then
    echo "FAIL  $svc: o contêiner novo não apareceu"
    exit 1
  fi
  wait_healthy "$svc" "$new"
  sleep "$SETTLE"
  docker stop -t "$STOP_GRACE" "${old[@]}" >/dev/null
  docker rm "${old[@]}" >/dev/null
  echo "ok  $svc trocado sem manutenção (${new:0:12} no ar)"
done
