#!/usr/bin/env bash
# Plano da troca: compara, serviço a serviço, o que está no ar com o que o SHA pede, e diz quem troca. Roda NA VPS, em
# /docker/galaxie-sports, com o compose novo (PLAN_FILE) e o .env.next que o deploy-gh.sh deixou lá e as imagens já baixadas:
#
#   ssh <vps> 'cd /docker/galaxie-sports && PLAN_FILE=compose.yml.new bash -s -- <escala do ingestor> api=<ref> demo=<ref> ...' < deploy-plan.sh
#
# Cada serviço=referência é um serviço com imagem nossa. Um serviço troca quando:
#   - a imagem nova tem outro digest (docker image inspect) que a do contêiner no ar (docker inspect): tag diferente com
#     o mesmo digest não troca (a imagem reaproveitada entre commits é a mesma)
#   - a configuração dele mudou (compose ou .env): o hash do compose (config --hash) comparado com o rótulo do contêiner.
#     A referência da imagem entra nesse hash, então ele é calculado com a tag que o contêiner já usa
#   - não existe, está parado (quem tem restart) ou terminou com erro (quem roda uma vez, como o migrate)
# A escala 0 do ingestor é escolha de quem opera: fica como está.
# Imprime uma linha por serviço e, por último, TROCA=<os que trocam>. Só leitura. Saída ≠ 0 = não deu para decidir.
# O script chega pelo stdin (bash -s): todo comando lê de /dev/null.
set -euo pipefail
shopt -s inherit_errexit # falha do docker dentro de $(...) para o plano, em vez de virar "nada muda"
export PULL_POLICY=missing

scale="${1:?informe a escala do ingestor}"
shift
C=(docker compose -f "${PLAN_FILE:-compose.yml.new}" --env-file .env.next)
TAG_VARS=(TAG_API TAG_DEMO TAG_INGESTOR TAG_BACKUP TAG_PROMETHEUS TAG_GRAFANA IMAGE_TAG)
declare -A REFS=()
for arg in "$@"; do REFS["${arg%%=*}"]="${arg#*=}"; done

short() {
  case "$1" in
    in-*) echo "${1:0:10}" ;;
    *) echo "${1:0:7}" ;;
  esac
}

# hash do serviço no compose novo, com a tag que o contêiner usa no lugar da nova
config_hash() {
  local svc="$1" tag="$2" v
  local -a envs=()
  if [ -n "$tag" ]; then
    for v in "${TAG_VARS[@]}"; do envs+=("$v=$tag"); done
  fi
  env "${envs[@]}" "${C[@]}" config --hash "$svc" </dev/null | awk '{ print $2 }'
}

# o motivo da troca, ou vazio se o serviço fica
why_swap() {
  local svc="$1" ref="${REFS[$1]:-}" ids id want="" have image tag state hash label
  ids="$("${C[@]}" ps -aq "$svc" </dev/null)"
  if [ -z "$ids" ]; then
    echo novo
    return
  fi
  [ -z "$ref" ] || want="$(docker image inspect -f '{{.Id}}' "$ref")"
  for id in $ids; do
    state="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{.HostConfig.RestartPolicy.Name}}' "$id")"
    case "$state" in
      running\ *) ;;
      exited\ 0\ no) ;;
      *\ no)
        echo "não terminou bem: $state"
        return
        ;;
      *)
        echo "parado (${state%% *})"
        return
        ;;
    esac
    image="$(docker inspect -f '{{.Config.Image}}' "$id")"
    if [ -n "$ref" ]; then
      have="$(docker inspect -f '{{.Image}}' "$id")"
      if [ "$have" != "$want" ]; then
        echo "$(short "${image##*:}") → $(short "${ref##*:}")"
        return
      fi
    fi
    # mesma imagem: a tag no ar entra no hash (mesmo repositório; outro repositório é mudança de configuração)
    tag=""
    [ -z "$ref" ] || [ "${image%:*}" != "${ref%:*}" ] || tag="${image##*:}"
    hash="$(config_hash "$svc" "$tag")"
    label="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$id")"
    if [ "$hash" != "$label" ]; then
      echo "config mudou"
      return
    fi
  done
}

services="$("${C[@]}" config --services </dev/null)"
troca=()
for svc in $(printf '%s\n' "$services" | sort); do
  if [ "$svc" = ingestor ] && [ "$scale" = 0 ]; then
    echo "$svc: escala 0, fica"
    continue
  fi
  why="$(why_swap "$svc")"
  if [ -n "$why" ]; then
    echo "$svc: troca ($why)"
    troca+=("$svc")
  else
    echo "$svc: igual, fica"
  fi
done

echo "TROCA=${troca[*]:-}"
