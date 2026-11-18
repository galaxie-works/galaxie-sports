#!/usr/bin/env bash
# Candidato do deploy: a API e o app web (site e console; num SHA de antes da divisão, a demo) da versão nova ao lado dos
# que estão no ar, sem tráfego de fora, para o smoke rodar ANTES da troca. Roda NA VPS, em /docker/galaxie-sports, com o
# compose.yml.new e o .env.next que o deploy-gh.sh deixou lá (a versão no ar segue com o compose.yml e o .env de sempre):
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- up [nome...]'   < candidate.sh  # sobe e espera healthy
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- smoke <arquivo> [nome...] [VAR=valor...]' < candidate.sh  # smoke nos web
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- down [nome...]' < candidate.sh  # tira todos e as chaves
#
# Os candidatos são os serviços api-candidate, site-candidate, console-candidate e demo-candidate que o compose do SHA
# tem (perfil `candidate`): mesmo env e limites dos originais, sem router no Traefik, a API com o prefixo gs-candidate:
# no Valkey. CANDIDATE_TIMEOUT (padrão 180 s) é o teto para todos ficarem healthy. O smoke roda em cada candidato web
# (site, console ou demo), e cada um confere o que o papel dele atende (APP_ROLE do contêiner, smoke.mjs). Saída ≠ 0 =
# candidato não subiu ou smoke com FAIL; a versão no ar não foi tocada.
#
# A lista: o deploy-gh.sh passa a que espera (`api site console`, com ou sem o sufixo -candidate) e o `up` a confere
# contra o `config --services` do compose.yml.new; faltou um = FAIL antes de subir qualquer coisa. Sem lista, o `up`
# descobre pela listagem. Nos dois casos a listagem só vale estável: até CANDIDATE_CONFIG_TRIES leituras (padrão 3), duas
# seguidas iguais. Em 18/11/2026 uma leitura veio sem o console-candidate e sem erro: o `up` subiu dois e o `smoke`, que
# listava de novo, procurou o terceiro. Por isso o `up` grava a lista efetiva em .candidates (um por linha) e o `smoke` e
# o `down` usam esse arquivo (sem ele, a lista dos argumentos ou a descoberta); o `down` o apaga no fim.
# O script chega pelo stdin (bash -s): todo comando lê de /dev/null.
set -euo pipefail
export PULL_POLICY=missing # as imagens já foram baixadas pelo deploy

# Postgres, Valkey e backup estão no projeto `dados` (docs/runbooks/stack-em-tres-projetos.md); antes da transição, neste
dados() {
  if [ -f compose.dados.yml ]; then docker compose -f compose.dados.yml "$@"; else docker compose "$@"; fi
}

C=(docker compose -f compose.yml.new --env-file .env.next --profile candidate)
KNOWN=(api-candidate site-candidate console-candidate demo-candidate)
STATE=.candidates

# SERVICES = os candidatos, na ordem de KNOWN; WEB = os do app web, onde o smoke roda
SERVICES=()
WEB=()
LISTED=""

# SERVICES/WEB a partir de nomes (api, site, console-candidate...); nome fora de KNOWN = FAIL
set_list() {
  local n s want=""
  for n in "$@"; do
    n="${n%-candidate}-candidate"
    if ! grep -qx -- "$n" < <(printf '%s\n' "${KNOWN[@]}"); then
      echo "FAIL  candidato: $n não é um candidato conhecido (${KNOWN[*]})"
      return 1
    fi
    want+="$n"$'\n'
  done
  SERVICES=()
  WEB=()
  for s in "${KNOWN[@]}"; do
    if grep -qx -- "$s" <<<"$want"; then
      SERVICES+=("$s")
      [ "$s" = api-candidate ] || WEB+=("$s")
    fi
  done
}

# uma linha só, para as mensagens
oneline() { printf '%s' "$1" | tr '\n' ' ' | sed 's/ $//'; }

# config --services estável em LISTED: até CANDIDATE_CONFIG_TRIES leituras, vale a primeira igual à anterior. Leitura que
# falha ou que muda não conta (a de 18/11 veio incompleta, com saída 0 e stderr vazio). A ordem dos nomes muda a cada
# chamada (o compose itera um mapa), por isso a comparação é do conjunto ordenado, não do texto como veio
listed() {
  local i out prev="" have="" tries="${CANDIDATE_CONFIG_TRIES:-3}"
  for ((i = 1; i <= tries; i++)); do
    if out="$("${C[@]}" config --services </dev/null | LC_ALL=C sort)"; then
      if [ -n "$have" ] && [ "$out" = "$prev" ]; then
        LISTED="$out"
        return 0
      fi
      [ -z "$have" ] ||
        echo "WARN  candidato: config --services mudou da leitura $((i - 1)) para a $i ($(oneline "$prev") → $(oneline "$out"))"
      prev="$out"
      have=1
    else
      echo "WARN  candidato: config --services falhou na leitura $i"
      have=""
    fi
    [ "$i" -ge "$tries" ] || sleep "${CANDIDATE_CONFIG_PAUSE:-2}"
  done
  LISTED="$prev"
  return 1
}

# para o log do Actions: o que a listagem devolveu e os erros do config (-q só valida: o config inteiro imprimiria os
# segredos do .env.next num log público)
diag() {
  echo "      config --services devolveu: $(oneline "$LISTED")"
  echo "      config -q (até 20 linhas):"
  { "${C[@]}" config -q </dev/null 2>&1 | head -n 20 | sed 's/^/        /'; } || true
}

# sem lista: os de KNOWN que a listagem estável tem
discover() {
  local s
  if ! listed; then
    echo "FAIL  candidato: config --services do compose.yml.new não estabilizou em ${CANDIDATE_CONFIG_TRIES:-3} leituras"
    diag
    return 1
  fi
  SERVICES=()
  WEB=()
  for s in "${KNOWN[@]}"; do
    if grep -qx -- "$s" <<<"$LISTED"; then
      SERVICES+=("$s")
      [ "$s" = api-candidate ] || WEB+=("$s")
    fi
  done
}

# com lista: cada um tem de estar na listagem estável
confirm() {
  local s missing=()
  if ! listed; then
    echo "FAIL  candidato: config --services do compose.yml.new não estabilizou em ${CANDIDATE_CONFIG_TRIES:-3} leituras (esperados: ${SERVICES[*]})"
    diag
    return 1
  fi
  for s in "${SERVICES[@]}"; do
    grep -qx -- "$s" <<<"$LISTED" || missing+=("$s")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "FAIL  candidato: o compose.yml.new não lista ${missing[*]} (config --services devolveu: $(oneline "$LISTED"))"
    diag
    return 1
  fi
}

# smoke e down: a lista que o up gravou; sem o arquivo, a dos argumentos; sem argumentos, a descoberta
load() {
  local -a saved=()
  if [ -s "$STATE" ]; then
    mapfile -t saved <"$STATE"
    set_list "${saved[@]}"
  elif [ "$#" -gt 0 ]; then
    set_list "$@"
  else
    discover
  fi
}

up() {
  rm -f "$STATE"
  if [ "$#" -gt 0 ]; then
    set_list "$@" || return 1
    confirm || return 1
  else
    discover || return 1
  fi
  if [ "${#SERVICES[@]}" -eq 0 ]; then
    echo "FAIL  candidato: o compose.yml.new não tem nenhum dos candidatos (${KNOWN[*]})"
    return 1
  fi
  printf '%s\n' "${SERVICES[@]}" >"$STATE"
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
  local -a extra=() names=()
  for v in "$@"; do
    case "$v" in
      *=*) extra+=(-e "$v") ;;
      *) names+=("$v") ;;
    esac
  done
  load "${names[@]}" || return 1
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
  # sem lista confiável, os conhecidos saem pelo rótulo logo abaixo
  load "$@" || echo "WARN  candidato: sem a lista dos candidatos; tirando pelo rótulo do projeto"
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
  rm -f "$STATE"
}

cmd="${1:-}"
[ "$#" -eq 0 ] || shift
case "$cmd" in
  up) up "$@" ;;
  smoke) smoke "$@" ;;
  down) down "$@" ;;
  *)
    echo "uso: candidate.sh up [nome...] | smoke <arquivo> [nome...] [VAR=valor...] | down [nome...]" >&2
    exit 2
    ;;
esac
