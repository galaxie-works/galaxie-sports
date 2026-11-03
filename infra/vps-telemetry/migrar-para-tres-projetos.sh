#!/usr/bin/env bash
# Transição da stack de um projeto só para três (apps, dados, obs), na mesma rede e com os mesmos volumes. Roda NA VPS, em
# /docker/galaxie-sports, com compose.yml.new (o de apps), compose.dados.yml e compose.obs.yml já lá. Passo a passo, janela
# e reverso: docs/runbooks/stack-em-tres-projetos.md.
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- preparar' < migrar-para-tres-projetos.sh  # só confere; não troca nada
#   ... aplicar    # obs, depois dados; serviço já no projeto novo é pulado (idempotente)
#   ... conferir   # três projetos, mesmos volumes e rede, apps intocados. Saída 1 = algo fora do lugar
#   ... reverter   # volta para o projeto só (enquanto os contêineres antigos existirem)
#   ... limpar     # apaga os contêineres antigos parados. Depois disso, sem reverter
#
# O que acontece com cada serviço de dados e de obs: o rótulo do projeto não muda em contêiner existente, então é outro
# contêiner, nos mesmos volumes. O antigo PARA ANTES de o novo subir (dois Postgres no mesmo volume corrompem o banco), e
# fica parado para o reverso. O nome do serviço continua resolvendo na rede. Cada serviço fica fora do ar enquanto troca:
# no Postgres, o tempo de parar e subir. Os contêineres de apps não são tocados: o projeto deles é o mesmo.
# Falhou um serviço: tira o novo, religa o antigo e sai com 1.
# Ambiente: OLD_PROJECT (padrão galaxie-sports; os novos são <OLD_PROJECT>-dados e -obs), NETWORK_SUBNET (padrão
# 172.30.50.0/24; vazio não confere), MOVE_TIMEOUT (padrão 180 s por serviço).
# O script chega pelo stdin (bash -s): todo comando lê de /dev/null.
set -euo pipefail
export PULL_POLICY=missing

P="${OLD_PROJECT:-galaxie-sports}"
SUBNET="${NETWORK_SUBNET-172.30.50.0/24}"
TIMEOUT="${MOVE_TIMEOUT:-180}"
NETWORK="${P}_default"
VOLUMES=(pgdata valkeydata s3data backups promdata grafanadata)
# ordem da troca: quem menos dói primeiro; o backup depois do Postgres
OBS=(node-exporter prometheus grafana)
DADOS=(valkey s3 s3-init postgres backup)
ONE_SHOT=" s3-init "
PRE=compose.yml.pre-tres-projetos
CREATED=.tres-projetos.apps-created

die() {
  echo "FAIL  $*"
  exit 1
}

file_of() { # o arquivo do compose de um serviço
  case " ${OBS[*]} " in
    *" $1 "*) echo compose.obs.yml ;;
    *) echo compose.dados.yml ;;
  esac
}
# os contêineres de um serviço num projeto, parados inclusive
ids_in() { docker ps -aq --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.service=$2" </dev/null; }
project_of() {
  case "$1" in
    compose.obs.yml) echo "$P-obs" ;;
    *) echo "$P-dados" ;;
  esac
}
apps_created() { # serviço e .Created dos contêineres de apps, para provar que a transição não os tocou
  local id
  for id in $(docker ps -q --filter "label=com.docker.compose.project=$P" </dev/null); do
    docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}} {{.Id}} {{.Created}}' "$id"
  done | grep -vE "^($(
    IFS='|'
    echo "${OBS[*]}|${DADOS[*]}"
  )) " | sort
}

preparar() {
  local f v
  [ -f .env ] || die "sem .env nesta pasta"
  for f in compose.dados.yml compose.obs.yml; do
    [ -f "$f" ] || die "falta o $f nesta pasta"
    docker compose -f "$f" config -q </dev/null || die "$f inválido com este .env"
  done
  if [ -f compose.yml.new ]; then
    docker compose -f compose.yml.new config -q </dev/null || die "compose.yml.new inválido com este .env"
  elif [ ! -f "$PRE" ]; then
    die "falta o compose.yml.new (o compose.yml de apps da main) nesta pasta"
  fi
  docker network inspect "$NETWORK" >/dev/null 2>&1 || die "rede $NETWORK não existe"
  if [ -n "$SUBNET" ]; then
    [ "$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' "$NETWORK")" = "$SUBNET" ] ||
      die "rede $NETWORK sem a sub-rede $SUBNET (o TRUST_PROXY depende dela)"
  fi
  for v in "${VOLUMES[@]}"; do
    docker volume inspect "${P}_$v" >/dev/null 2>&1 || die "volume ${P}_$v não existe"
  done
  echo "ok  arquivos, rede $NETWORK e os ${#VOLUMES[@]} volumes no lugar"
}

# Um serviço: já no projeto novo → pula. Senão, para o antigo e sobe o novo; não subiu, desfaz.
mover() {
  local svc="$1" file old new project rc
  file="$(file_of "$svc")"
  project="$(project_of "$file")"
  new="$(ids_in "$project" "$svc" | head -n 1)"
  old="$(ids_in "$P" "$svc")"
  if [ -n "$new" ] && { [ "$(docker inspect -f '{{.State.Running}}' "$new")" = true ] ||
    [ "$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$new")" = "exited 0" ]; }; then
    echo "$svc: já em $project"
    return 0
  fi
  [ -z "$old" ] || docker stop -t 60 $old >/dev/null
  rc=0
  case "$ONE_SHOT" in
    *" $svc "*)
      docker compose -f "$file" up -d --no-deps --quiet-pull "$svc" </dev/null || rc=$?
      if [ "$rc" = 0 ]; then
        rc="$(timeout "$TIMEOUT" docker wait "$(ids_in "$project" "$svc" | head -n 1)" </dev/null)" || rc=1
      fi
      ;;
    *) docker compose -f "$file" up -d --no-deps --wait --wait-timeout "$TIMEOUT" --quiet-pull "$svc" </dev/null || rc=$? ;;
  esac
  if [ "$rc" != 0 ]; then
    echo "FAIL  $svc não subiu em $project (código $rc): tirando o novo e religando o antigo"
    docker compose -f "$file" logs --tail 30 "$svc" </dev/null 2>&1 | sed 's/^/      /' || true
    docker compose -f "$file" rm -sf "$svc" </dev/null >/dev/null 2>&1 || true
    [ -z "$old" ] || docker start $old >/dev/null
    exit 1
  fi
  echo "ok  $svc agora em $project"
}

aplicar() {
  local svc
  preparar
  [ -f "$CREATED" ] || apps_created > "$CREATED"
  # o compose.yml de apps entra primeiro: daqui em diante, os serviços de dados e de obs não são mais deste projeto
  if [ -f compose.yml.new ]; then
    [ -f "$PRE" ] || cp compose.yml "$PRE"
    mv compose.yml.new compose.yml
  fi
  for svc in "${OBS[@]}" "${DADOS[@]}"; do mover "$svc"; done
  conferir
}

conferir() {
  local svc file project id v bad=0 running mount
  for svc in "${OBS[@]}" "${DADOS[@]}"; do
    file="$(file_of "$svc")"
    project="$(project_of "$file")"
    id="$(ids_in "$project" "$svc" | head -n 1)"
    if [ -z "$id" ]; then
      echo "FAIL  $svc não está em $project"
      bad=1
      continue
    fi
    running="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$id")"
    case "$ONE_SHOT:$running" in
      *" $svc "*:"exited 0") ;;
      *:"running "*) ;;
      *)
        echo "FAIL  $svc em $project está $running"
        bad=1
        ;;
    esac
    if ! docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$NETWORK" | grep -q "$(docker inspect -f '{{.Name}}' "$id" | tr -d /)" &&
      [ "${running%% *}" = running ]; then
      echo "FAIL  $svc fora da rede $NETWORK"
      bad=1
    fi
    if [ -n "$(ids_in "$P" "$svc" | xargs -r docker inspect -f '{{if .State.Running}}{{.Name}}{{end}}')" ]; then
      echo "FAIL  $svc tem contêiner antigo rodando em $P"
      bad=1
    fi
  done
  for v in "${VOLUMES[@]}"; do
    mount="$(docker ps -q --filter "volume=${P}_$v" --filter "label=com.docker.compose.project=$P-dados" </dev/null)$(docker ps -q --filter "volume=${P}_$v" --filter "label=com.docker.compose.project=$P-obs" </dev/null)"
    if [ -z "$mount" ]; then
      echo "FAIL  nenhum contêiner novo usa o volume ${P}_$v"
      bad=1
    fi
  done
  if [ -f "$CREATED" ] && [ "$(apps_created)" != "$(cat "$CREATED")" ]; then
    echo "WARN  contêineres de apps mudaram desde o começo da transição (deploy no meio?):"
    diff <(cat "$CREATED") <(apps_created) | sed 's/^/      /' || true
  fi
  docker compose ls --all --format table </dev/null | grep -E "NAME|^$P" || true
  [ "$bad" = 0 ] || die "transição incompleta (acima)"
  echo "PASS  três projetos, mesma rede, mesmos volumes"
}

reverter() {
  local i svc file old
  [ -f "$PRE" ] || die "sem $PRE: esta pasta não passou por 'aplicar', ou já foi revertida"
  # a ordem contrária; o antigo tem de existir (sem 'limpar')
  for svc in "${OBS[@]}" "${DADOS[@]}"; do
    [ -n "$(ids_in "$P" "$svc")" ] || die "o contêiner antigo de $svc não existe mais ('limpar' já rodou): reverter à mão, com o $PRE"
  done
  local all=("${OBS[@]}" "${DADOS[@]}")
  for ((i = ${#all[@]} - 1; i >= 0; i--)); do
    svc="${all[i]}"
    file="$(file_of "$svc")"
    docker compose -f "$file" rm -sf "$svc" </dev/null >/dev/null 2>&1 || true
    old="$(ids_in "$P" "$svc")"
    case "$ONE_SHOT" in
      *" $svc "*) echo "ok  $svc (roda uma vez): fica parado" ;;
      *)
        docker start $old >/dev/null
        echo "ok  $svc de volta em $P"
        ;;
    esac
  done
  cp "$PRE" compose.yml
  # sem o compose.dados.yml, o deploy novo recusa publicar até a transição ser refeita, em vez de achar que ela aconteceu
  mv compose.dados.yml compose.dados.yml.off
  mv compose.obs.yml compose.obs.yml.off
  rm -f "$PRE" "$CREATED"
  echo "PASS  de volta num projeto só; o deploy recusa publicar a stack em três enquanto ela estiver assim"
}

limpar() {
  local svc old
  conferir
  for svc in "${OBS[@]}" "${DADOS[@]}"; do
    old="$(ids_in "$P" "$svc")"
    [ -z "$old" ] || docker rm $old >/dev/null
  done
  rm -f "$CREATED"
  echo "ok  contêineres antigos removidos; $PRE fica como registro"
}

case "${1:-}" in
  preparar) preparar ;;
  aplicar) aplicar ;;
  conferir) conferir ;;
  reverter) reverter ;;
  limpar) limpar ;;
  *)
    echo "uso: migrar-para-tres-projetos.sh preparar|aplicar|conferir|reverter|limpar" >&2
    exit 2
    ;;
esac
