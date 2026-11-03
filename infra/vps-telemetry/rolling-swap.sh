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
#   3b. serviço que drena (SWAP_DRAIN_SERVICES, padrão `worker`: o worker da fila de tarefas): o docker stop do antigo
#      tem o prazo da drenagem (SWAP_DRAIN_TIMEOUT, padrão 75 s, o stop_grace_period dele). No SIGTERM ele para de
#      tomar tarefas, o lote em andamento fecha e a tarefa volta à fila com o checkpoint; o novo, já no ar, a retoma.
#      Enquanto isso, o /health do antigo (porta SWAP_DRAIN_PORT, padrão 8080) é acompanhado até dizer `idle` ou o
#      contêiner sair; passado o prazo, o docker stop manda SIGKILL (a tarefa volta pela concessão vencida, em 90 s)
#   4. remove o antigo; o serviço fica com um contêiner só, na configuração nova (o `up -d` seguinte não o recria)
# Novo sem ficar healthy: sai o novo, o antigo segue no ar e o script sai com 1 (o deploy volta para a versão anterior).
# Serviço sem contêiner no ar: só sobe. Sem COMPOSE_FILE, usa o compose.yml do diretório.
set -euo pipefail
export PULL_POLICY="${PULL_POLICY:-missing}"

TIMEOUT="${SWAP_HEALTH_TIMEOUT:-180}"
SETTLE="${SWAP_SETTLE_S:-3}"
STOP_GRACE="${SWAP_STOP_GRACE_S:-30}"
DRAIN_SERVICES="${SWAP_DRAIN_SERVICES-worker}"
DRAIN_TIMEOUT="${SWAP_DRAIN_TIMEOUT:-75}"
DRAIN_PORT="${SWAP_DRAIN_PORT:-8080}"

health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null ||
    echo ausente
}

# o /health do contêiner diz idle? `sim`, `nao` ou vazio (não respondeu)
idle_of() {
  docker exec "$1" node -e "fetch('http://127.0.0.1:$DRAIN_PORT/health',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(j=>console.log(j.idle===true?'sim':'nao'))" </dev/null 2>/dev/null || true
}

drains() { case " $DRAIN_SERVICES " in *" $1 "*) return 0 ;; esac; return 1; }

# drena e para os contêineres antigos de um serviço: docker stop com o prazo da drenagem, acompanhando o /health
drain_stop() {
  local svc="$1" id started idle_seen="" code pids=()
  shift
  started=$SECONDS
  echo "$svc: drenando ${#@} contêiner(es) antigo(s): SIGTERM, o lote em andamento fecha e a tarefa volta à fila (até $DRAIN_TIMEOUT s)"
  for id in "$@"; do
    docker stop -t "$DRAIN_TIMEOUT" "$id" >/dev/null 2>&1 &
    pids+=("$!")
  done
  for id in "$@"; do
    while [ "$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null || echo false)" = true ]; do
      if [ -z "$idle_seen" ] && [ "$(idle_of "$id")" = sim ]; then
        idle_seen=1
        echo "$svc: ${id:0:12} sem tarefa (/health idle) depois de $((SECONDS - started)) s"
      fi
      [ "$((SECONDS - started))" -le "$((DRAIN_TIMEOUT + 10))" ] || break
      sleep 1
    done
  done
  for pid in "${pids[@]}"; do wait "$pid" || true; done
  for id in "$@"; do
    code="$(docker inspect -f '{{.State.ExitCode}}' "$id" 2>/dev/null || echo '?')"
    if [ "$code" = 137 ]; then
      echo "WARN  $svc: ${id:0:12} não drenou em $DRAIN_TIMEOUT s (SIGKILL); a tarefa dele volta à fila quando a concessão vencer"
    else
      echo "ok  $svc: ${id:0:12} drenado em $((SECONDS - started)) s (saída $code)"
    fi
  done
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
      running)
        # só o contêiner sem healthcheck chega aqui: sobreviveu à espera, conta como no ar
        sleep "$SETTLE"
        [ "$(health "$new")" != running ] || break
        ;;
      starting) ;;
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
  if drains "$svc"; then
    drain_stop "$svc" "${old[@]}"
  else
    docker stop -t "$STOP_GRACE" "${old[@]}" >/dev/null
  fi
  docker rm "${old[@]}" >/dev/null
  echo "ok  $svc trocado sem manutenção (${new:0:12} no ar)"
done
