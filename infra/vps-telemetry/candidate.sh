#!/usr/bin/env bash
# Candidato do deploy: a API e o app web (site e console; num SHA de antes da divisão, a demo) da versão nova ao lado dos
# que estão no ar, sem tráfego de fora, para o smoke rodar ANTES da troca. Roda NA VPS, em /docker/galaxie-sports, com o
# compose.yml.new e o .env.next que o deploy-gh.sh deixou lá (a versão no ar segue com o compose.yml e o .env de sempre):
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- up'            < candidate.sh   # sobe e espera healthy
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- smoke <arquivo> [VAR=valor...]' < candidate.sh  # smoke.mjs nos candidatos
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- down'          < candidate.sh   # tira todos e as chaves
#
# Os candidatos são os serviços api-candidate, site-candidate, console-candidate e demo-candidate que o compose do SHA
# tem (perfil `candidate`): mesmo env e limites dos originais, sem router no Traefik, a API com o prefixo gs-candidate:
# no Valkey. CANDIDATE_TIMEOUT (padrão 180 s) é o teto para todos ficarem healthy. O smoke roda em cada candidato web
# (site, console ou demo), e cada um confere o que o papel dele atende (APP_ROLE do contêiner, smoke.mjs). Saída ≠ 0 =
# candidato não subiu ou smoke com FAIL; a versão no ar não foi tocada.
# O script chega pelo stdin (bash -s): todo comando lê de /dev/null.
set -euo pipefail
export PULL_POLICY=missing # as imagens já foram baixadas pelo deploy

# Postgres, Valkey e backup estão no projeto `dados` (docs/runbooks/stack-em-tres-projetos.md); antes da transição, neste
dados() {
  if [ -f compose.dados.yml ]; then docker compose -f compose.dados.yml "$@"; else docker compose "$@"; fi
}

C=(docker compose -f compose.yml.new --env-file .env.next --profile candidate)
KNOWN=(api-candidate site-candidate console-candidate demo-candidate)

# os candidatos que o compose do SHA tem, na ordem acima; WEB = os do app web, onde o smoke roda
SERVICES=()
WEB=()
services="$("${C[@]}" config --services </dev/null)"
for s in "${KNOWN[@]}"; do
  if printf '%s\n' "$services" | grep -qx -- "$s"; then
    SERVICES+=("$s")
    [ "$s" = api-candidate ] || WEB+=("$s")
  fi
done

up() {
  if [ "${#SERVICES[@]}" -eq 0 ]; then
    echo "FAIL  candidato: o compose.yml.new não tem nenhum dos candidatos (${KNOWN[*]})"
    return 1
  fi
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
  local file="${1:?arquivo do smoke}" v s rc=0
  shift
  local -a extra=()
  for v in "$@"; do extra+=(-e "$v"); done
  if [ "${#WEB[@]}" -eq 0 ]; then
    echo "FAIL  candidato: nenhum candidato web (site, console ou demo) para o smoke"
    return 1
  fi
  # SMOKE_PHASE=candidate: o smoke sabe que roda antes do pós-deploy (seed semântico, nomes, importância e cache
  # ainda da versão anterior). Um reprovado não pula os outros: o log mostra o resultado de todos
  for s in "${WEB[@]}"; do
    echo "smoke no $s"
    "${C[@]}" exec -T -e SMOKE_PHASE=candidate "${extra[@]}" "$s" node - < "$file" || rc=1
  done
  return "$rc"
}

# nome do projeto de apps (o `name:` do compose)
project() { "${C[@]}" config </dev/null 2>/dev/null | sed -n 's/^name: //p'; }

down() {
  local s ids p
  [ "${#SERVICES[@]}" -eq 0 ] || "${C[@]}" rm -sf "${SERVICES[@]}" </dev/null >/dev/null 2>&1 || true
  # os conhecidos que o compose novo não tem (um demo-candidate de antes da divisão esquecido no ar) também saem
  p="$(project)"
  if [ -n "$p" ]; then
    for s in "${KNOWN[@]}"; do
      ids="$(docker ps -aq --filter "label=com.docker.compose.project=$p" --filter "label=com.docker.compose.service=$s" </dev/null)"
      [ -z "$ids" ] || printf '%s\n' "$ids" | xargs docker rm -f >/dev/null 2>&1 || true
    done
  fi
  # chaves do candidato no Valkey (cache, rate limit, uso, relay): as de cache expiram sozinhas, o resto não
  dados exec -T valkey sh -ec '
    keys=$(valkey-cli --scan --pattern "gs-candidate:*")
    [ -z "$keys" ] || printf "%s\n" "$keys" | xargs -n 200 valkey-cli del >/dev/null' </dev/null ||
    echo "WARN  candidato: chaves gs-candidate:* não foram apagadas do Valkey"
}

case "${1:-}" in
  up) up ;;
  smoke)
    shift
    smoke "$@"
    ;;
  down) down ;;
  *)
    echo "uso: candidate.sh up|smoke <arquivo>|down" >&2
    exit 2
    ;;
esac
