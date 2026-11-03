#!/usr/bin/env bash
# Confere, no fim do deploy, que cada serviço trocado está mesmo na versão pedida. Nasceu de 30/10 a 02/11/2026, quando
# deploys verdes não publicaram nada e ninguém conferia. Roda NA VPS, em /docker/galaxie-sports:
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- <serviço>=<ref>=<tag>=<porta> ...' < deploy-verify.sh
#
# Para cada contêiner do serviço:
#   - a imagem é a da referência (digest);
#   - com tag in-<hash>: o rótulo works.galaxie.context-tree da imagem é esse hash;
#   - com porta: o que o processo expõe (GET /version; na demo, /api/version) é essa tag.
# Tag vazia (SHA anterior às tags por serviço) ou porta vazia (SHA anterior ao /version) pulam a conferência respectiva.
# Imprime ok ou FAIL por serviço e, por último, DIVERGENTE=<os que falharam>. Saída 1 = algum divergiu.
# O script chega pelo stdin (bash -s): todo comando lê de /dev/null.
set -euo pipefail
shopt -s inherit_errexit

TREE_LABEL="works.galaxie.context-tree"
TRIES="${VERIFY_TRIES:-5}"

# o image_hash que o processo do contêiner expõe, vazio se não responder
exposed() {
  docker exec "$1" node -e "fetch('http://127.0.0.1:$2$3',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(j=>console.log(j.image_hash))" </dev/null 2>/dev/null || true
}

check() {
  local svc="$1" ref="$2" tag="$3" port="$4" ids id want have label path got i
  ids="$(docker compose ps -q "$svc" </dev/null)"
  if [ -z "$ids" ]; then
    echo "contêiner fora do ar"
    return
  fi
  want="$(docker image inspect -f '{{.Id}}' "$ref")"
  path=/version
  [ "$svc" != demo ] || path=/api/version
  for id in $ids; do
    have="$(docker inspect -f '{{.Image}}' "$id")"
    if [ "$have" != "$want" ]; then
      echo "o contêiner roda $(docker inspect -f '{{.Config.Image}}' "$id"), não $ref"
      return
    fi
    if [[ "$tag" == in-* ]]; then
      label="$(docker image inspect -f "{{index .Config.Labels \"$TREE_LABEL\"}}" "$have")"
      if [ "in-$label" != "$tag" ]; then
        echo "o rótulo da imagem é ${label:-vazio}, não ${tag#in-}"
        return
      fi
    fi
    [ -n "$port" ] || continue
    got=""
    for ((i = 0; i < TRIES; i++)); do
      got="$(exposed "$id" "$port" "$path")"
      [ -z "$got" ] || break
      sleep 2
    done
    if [ "$got" != "$tag" ]; then
      echo "expõe ${got:-nada} em $path, não $tag"
      return
    fi
  done
}

divergent=()
for arg in "$@"; do
  IFS='=' read -r svc ref tag port <<< "$arg"
  why="$(check "$svc" "$ref" "$tag" "$port")"
  if [ -n "$why" ]; then
    echo "FAIL  $svc: $why"
    divergent+=("$svc")
  else
    echo "ok  $svc na versão ${tag:0:10}"
  fi
done

echo "DIVERGENTE=${divergent[*]:-}"
[ "${#divergent[@]}" -eq 0 ]
