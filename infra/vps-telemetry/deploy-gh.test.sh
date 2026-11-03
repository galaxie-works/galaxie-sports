#!/usr/bin/env bash
# Teste do deploy só do que mudou e da transição para três projetos (deploy-gh.sh, deploy-plan.sh, deploy-verify.sh,
# rolling-swap.sh, candidate.sh, maintenance.sh, migrar-para-tres-projetos.sh) contra o Docker de verdade, no CI (docker.yml ›
# valida stack). Os roteiros rodam inteiros, sem tirar nada: o ssh é falso (roda o comando aqui), o GHCR é um registry local
# e o repositório é um git de brinquedo com o layout do de verdade, o mesmo image-inputs.mjs e imagens mínimas, em que a
# entrada de cada imagem muda como na vida real. O que ele prova, com docker inspect .Created:
#
#   - a VPS num projeto só recusa o deploy; a transição mantém volumes, rede e os contêineres de apps; falha nela desfaz;
#     ela é idempotente e tem reverso
#   - merge só na demo troca só a demo; merge que só muda o compose de um serviço troca só ele
#   - falha num serviço volta só ele e fica registrada; o deploy seguinte tenta de novo
#   - serviço de uma execução só que termina com erro reprova o deploy
#   - falha em mais de um volta o projeto inteiro
#   - serviço que expõe outra versão termina vermelho, com o nome dele, e volta só ele
#   - webhooks trocam lado a lado, e a manutenção forçada fica de fora do deploy
#   - --project obs troca só o que é dele, e o deploy de apps não toca em obs nem em dados
#   - um SHA anterior aos três projetos continua publicável, sem subir um segundo Postgres no mesmo volume
#
#   bash infra/vps-telemetry/deploy-gh.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
REPO_T="$WORK/repo"
PROJECT_T=galaxie-deploy-test
VPS_D="$WORK/$PROJECT_T"
BUILD="$WORK/build"
BIN="$WORK/bin"
PORT="${TEST_REGISTRY_PORT:-15055}"
REGISTRY_CT="$PROJECT_T-registry"
P="localhost:$PORT/$PROJECT_T/gs"
NAMES=(api demo ingestor backup prometheus grafana)
APPS=(agents api demo ingestor maintenance migrate tarefa webhooks)
DADOS=(backup postgres s3 s3-init valkey)
OBS=(grafana node-exporter prometheus)
ZERO=0000000000000000000000000000000000000000
fail=0

export SWAP_SETTLE_S=1 SWAP_STOP_GRACE_S=2 SWAP_HEALTH_TIMEOUT=25 CANDIDATE_TIMEOUT=25 DEPLOY_KEEP_IMAGES=3
export OLD_PROJECT="$PROJECT_T" NETWORK_SUBNET="" MOVE_TIMEOUT=25

cleanup() {
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_T" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_T-dados" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_T-obs" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker rm -f "$REGISTRY_CT" >/dev/null 2>&1 || true
  docker network ls -q --filter "name=$PROJECT_T" | xargs -r docker network rm >/dev/null 2>&1 || true
  docker volume ls -q --filter "name=$PROJECT_T" | xargs -r docker volume rm >/dev/null 2>&1 || true
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^($P-|$PROJECT_T)" | xargs -r docker rmi -f >/dev/null 2>&1 || true
  git -C "$REPO_T" worktree prune >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$BIN" "$BUILD" "$VPS_D" "$REPO_T"
git -C "$REPO_T" init -q

# ssh falso: engole as opções e o host e roda o comando aqui, com a mesma entrada
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do
  case "$1" in
    -o) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
shift
exec bash -c "$*"
SH
chmod +x "$BIN/ssh"

# ── o repositório de brinquedo ───────────────────────────────────────────────────────────────────────────────
pkg() {
  mkdir -p "$REPO_T/$1"
  printf '{"name":"%s","version":"0.0.0"}\n' "$2" > "$REPO_T/$1/package.json"
}
pkg apps/api @galaxie/api
# o que diz ao deploy que os processos deste SHA expõem a versão
echo 'ENV GALAXIE_IMAGE_HASH=x' > "$REPO_T/apps/api/Dockerfile"
pkg apps/demo @galaxie/demo
pkg services/ingestor @galaxie/ingestor
pkg services/ai-agents @galaxie/ai-agents
printf "packages:\n  - 'apps/*'\n  - 'services/*'\n" > "$REPO_T/pnpm-workspace.yaml"
for f in .dockerignore .nvmrc package.json pnpm-lock.yaml tsconfig.base.json turbo.json; do echo x > "$REPO_T/$f"; done
mkdir -p "$REPO_T/config/broadcasters" "$REPO_T/config/broadcast-rights" "$REPO_T/data/knowledge" "$REPO_T/infra/healthcheck" \
  "$REPO_T/infra/backup" "$REPO_T/infra/observability/prometheus" "$REPO_T/infra/observability/grafana" \
  "$REPO_T/infra/ops" "$REPO_T/infra/vps-telemetry" "$REPO_T/packages/db/drizzle/meta"
echo x | tee "$REPO_T/config/broadcasters/a" "$REPO_T/config/broadcast-rights/a" "$REPO_T/data/knowledge/a" \
  "$REPO_T/infra/healthcheck/selfheal.mjs" "$REPO_T/infra/backup/a" "$REPO_T/infra/observability/prometheus/a" \
  "$REPO_T/infra/observability/grafana/a" >/dev/null
printf '{"entries":[{"idx":0}]}\n' | sed 's/{"idx"/\n{"idx"/' > "$REPO_T/packages/db/drizzle/meta/_journal.json"
cp "$REPO/infra/ops/image-inputs.mjs" "$REPO/infra/ops/image-hash.sh" "$REPO_T/infra/ops/"
for f in deploy-gh.sh deploy-plan.sh deploy-verify.sh maintenance.sh migrar-para-tres-projetos.sh rolling-swap.sh candidate.sh \
  pre-migrate-dump.sh prune-images.sh; do
  cp "$HERE/$f" "$REPO_T/infra/vps-telemetry/"
done
# pós-deploy e smoke de faz de conta. O node do contêiner é um sh: o smoke.mjs daqui é shell.
cat > "$REPO_T/infra/vps-telemetry/post-deploy.sh" <<'SH'
#!/usr/bin/env bash
echo "${1:-} ${GIT_SHA:-}" >> post-deploy.log
case "${1:-}" in all | sem-cache) ;; esac
SH
cat > "$REPO_T/infra/vps-telemetry/smoke.mjs" <<'SH'
if [ -f /smoke-falha ] && [ -z "$CANDIDATO" ]; then echo "FAIL  smoke"; exit 1; fi
echo "1 ok · 0 aviso(s) · 0 falha(s)"
SH
cat > "$REPO_T/infra/vps-telemetry/env.example" <<ENV
IMAGE_PREFIX=$P
TAG_API=$ZERO
TAG_DEMO=$ZERO
TAG_INGESTOR=$ZERO
TAG_BACKUP=$ZERO
TAG_PROMETHEUS=$ZERO
TAG_GRAFANA=$ZERO
DEPLOY_SHA=$ZERO
ENV

# os serviços de cada projeto, em pedaços: o compose de um projeto só (como antes) é a soma dos três
tools_service() { # nome volume-opcional
  printf '  %s:\n    image: %s-tools:1\n    pull_policy: never\n    restart: unless-stopped\n    stop_grace_period: 1s\n' "$1" "$PROJECT_T"
  [ -z "${2:-}" ] || printf '    volumes:\n      - %s:/data\n' "$2"
}
own_service() { # nome imagem TAG volume-opcional
  # shellcheck disable=SC2016 # a interpolação é do compose
  printf '  %s:\n    <<: *app\n    image: ${IMAGE_PREFIX:?}-%s:${%s:?}\n' "$1" "$2" "$3"
  [ -z "${4:-}" ] || printf '    volumes:\n      - %s:/data\n' "$4"
}
APP_ANCHOR='x-app: &app
  pull_policy: ${PULL_POLICY:-always}
  restart: unless-stopped
  stop_grace_period: 2s
'
services_dados() {
  tools_service postgres pgdata
  tools_service valkey valkeydata
  tools_service s3 s3data
  printf "  s3-init:\n    image: %s-tools:1\n    pull_policy: never\n    command: ['true']\n    restart: 'no'\n" "$PROJECT_T"
  own_service backup backup TAG_BACKUP backups
}
services_obs() {
  own_service prometheus prometheus TAG_PROMETHEUS promdata
  own_service grafana grafana TAG_GRAFANA grafanadata
  tools_service node-exporter promdata
}
services_apps() {
  cat <<YML
  maintenance:
    image: $PROJECT_T-tools:1
    pull_policy: missing
    restart: unless-stopped
    stop_grace_period: 1s
    labels:
      - traefik.prioridade=\${MAINTENANCE_PRIORITY:-1}
  tarefa:
    image: $PROJECT_T-tools:1
    pull_policy: never
    command: ['sh', '-c', 'exit 0']
    restart: 'no'
  migrate:
    <<: *app
    image: \${IMAGE_PREFIX:?}-api:\${TAG_API:?}
    command: ['true']
    restart: 'no'
  api: &api
    <<: *app
    image: \${IMAGE_PREFIX:?}-api:\${TAG_API:?}
  webhooks:
    <<: *app
    image: \${IMAGE_PREFIX:?}-api:\${TAG_API:?}
  demo: &demo
    <<: *app
    image: \${IMAGE_PREFIX:?}-demo:\${TAG_DEMO:?}
  ingestor:
    <<: *app
    image: \${IMAGE_PREFIX:?}-ingestor:\${TAG_INGESTOR:?}
  agents:
    <<: *app
    image: \${IMAGE_PREFIX:?}-ingestor:\${TAG_INGESTOR:?}
    environment:
      AGENTE: um
  api-candidate:
    <<: *api
    profiles: [candidate]
    restart: 'no'
    environment:
      CANDIDATO: '1'
  demo-candidate:
    <<: *demo
    profiles: [candidate]
    restart: 'no'
    environment:
      CANDIDATO: '1'
YML
}
external_net() { printf 'networks:\n  default:\n    name: %s_default\n    external: true\n' "$PROJECT_T"; }
external_vol() {
  printf 'volumes:\n'
  for v in "$@"; do printf '  %s:\n    name: %s_%s\n    external: true\n' "$v" "$PROJECT_T" "$v"; done
}
write_split_composes() {
  {
    printf 'name: %s\n%sservices:\n' "$PROJECT_T" "$APP_ANCHOR"
    services_apps
    external_net
  } > "$1/compose.yml"
  {
    printf 'name: %s-dados\n%sservices:\n' "$PROJECT_T" "$APP_ANCHOR"
    services_dados
    external_net
    external_vol pgdata valkeydata s3data backups
  } > "$1/compose.dados.yml"
  {
    printf 'name: %s-obs\n%sservices:\n' "$PROJECT_T" "$APP_ANCHOR"
    services_obs
    external_net
    external_vol promdata grafanadata
  } > "$1/compose.obs.yml"
}

# ferramentas de faz de conta: psql responde a contagem de migrations; valkey-cli e o node do smoke são de mentira
mkdir -p "$BUILD/rootfs"
printf '#!/bin/sh\necho 1\n' > "$BUILD/rootfs/psql"
printf '#!/bin/sh\nexit 0\n' > "$BUILD/rootfs/valkey-cli"
# o node de mentira: com -e (a conferência da versão) responde o que a imagem expõe; com - (o smoke) é um sh
printf '#!/bin/sh\n[ "$1" = -e ] && exec cat /exposto\nexec sh -s\n' > "$BUILD/rootfs/node"
chmod +x "$BUILD/rootfs/"*

# Dockerfile das imagens: conteúdo = o hash da entrada, para digest mudar só quando a entrada muda. Marcadores na raiz
# do repositório (fora da entrada; o commit muda também a pasta do app) fazem a versão ruim: QUEBRA_<imagem> nunca fica
# healthy fora do candidato, SMOKE_FALHA_<imagem> reprova o smoke fora do candidato, MENTE_<imagem> expõe outra versão.
image_dockerfile() {
  cat <<DOCKER
FROM busybox:1.37
COPY rootfs/ /usr/local/bin/
LABEL works.galaxie.context-tree=$1
RUN echo "$1" > /version && echo "in-$1" > /exposto
$2
HEALTHCHECK --interval=1s --timeout=2s --retries=2 --start-period=0s CMD test ! -f /quebrada -o -n "\$CANDIDATO"
CMD ["sh", "-c", "trap 'exit 0' TERM; while :; do sleep 1 & wait \$!; done"]
DOCKER
}
printf 'FROM busybox:1.37\nCOPY rootfs/ /usr/local/bin/\nCMD ["sh", "-c", "trap '"'"'exit 0'"'"' TERM; while :; do sleep 1 & wait $!; done"]\n' > "$BUILD/Dockerfile.tools"
docker build -q -f "$BUILD/Dockerfile.tools" -t "$PROJECT_T-tools:1" "$BUILD" >/dev/null

docker run -d --name "$REGISTRY_CT" -p "127.0.0.1:$PORT:5000" registry:2 >/dev/null
for _ in $(seq 30); do
  curl -fsS -m 2 "http://127.0.0.1:$PORT/v2/" >/dev/null 2>&1 && break
  sleep 1
done

# ── publica o HEAD do repositório de brinquedo, como o docker.yml: entrada igual só ganha a tag do SHA ───────────────
commit() {
  git -C "$REPO_T" add -A
  git -C "$REPO_T" -c user.name=t -c user.email=t@t.invalid commit -q --allow-empty -m "$1"
  git -C "$REPO_T" rev-parse HEAD
}
hash_of() { bash "$REPO_T/infra/ops/image-hash.sh" "$1" 2>/dev/null; }
publish() {
  local sha name h extra
  sha="$(git -C "$REPO_T" rev-parse HEAD)"
  for name in "${NAMES[@]}"; do
    h="$(hash_of "$name")"
    if ! docker image inspect "$P-$name:in-$h" >/dev/null 2>&1; then
      extra=""
      [ ! -f "$REPO_T/QUEBRA_$name" ] || extra+=$'RUN touch /quebrada\n'
      [ ! -f "$REPO_T/SMOKE_FALHA_$name" ] || extra+=$'RUN touch /smoke-falha\n'
      [ ! -f "$REPO_T/MENTE_$name" ] || extra+=$'RUN echo in-velho > /exposto\n'
      image_dockerfile "$h" "$extra" | docker build -q -f - -t "$P-$name:in-$h" "$BUILD" >/dev/null
      docker push -q "$P-$name:in-$h" >/dev/null
    fi
    docker tag "$P-$name:in-$h" "$P-$name:$sha"
    docker push -q "$P-$name:$sha" >/dev/null
  done
}

LAST_OUT="$WORK/last.out"
LAST_RC=0
deploy() { # deploy <sha> [VAR=valor...]: o roteiro de verdade, do checkout atual do repositório de brinquedo
  local sha="$1"
  shift
  LAST_RC=0
  : > "$WORK/github_output"
  (cd "$REPO_T" && env PATH="$BIN:$PATH" SHA="$sha" VPS=vps-falsa VPS_DIR="$VPS_D" IMAGE_PREFIX="$P" \
    GITHUB_OUTPUT="$WORK/github_output" "$@" bash infra/vps-telemetry/deploy-gh.sh) > "$LAST_OUT" 2>&1 || LAST_RC=$?
  sed 's/^/      /' "$LAST_OUT"
}
migrar() { # migrar <passo>
  LAST_RC=0
  (cd "$VPS_D" && bash -s -- "$1" < "$REPO_T/infra/vps-telemetry/migrar-para-tres-projetos.sh") > "$LAST_OUT" 2>&1 || LAST_RC=$?
  sed 's/^/      /' "$LAST_OUT"
}
install_composes() {
  cp "$REPO_T/infra/vps-telemetry/compose.dados.yml" "$REPO_T/infra/vps-telemetry/compose.obs.yml" "$VPS_D/"
  cp "$REPO_T/infra/vps-telemetry/compose.yml" "$VPS_D/compose.yml.new"
}

project_of() { # o projeto de um serviço, depois da transição
  case " ${DADOS[*]} " in *" $1 "*)
    echo "$PROJECT_T-dados"
    return
    ;;
  esac
  case " ${OBS[*]} " in *" $1 "*)
    echo "$PROJECT_T-obs"
    return
    ;;
  esac
  echo "$PROJECT_T"
}
id_of() { docker ps -aq --filter "label=com.docker.compose.project=$(project_of "$1")" --filter "label=com.docker.compose.service=$1" | head -n 1; }
created() { # o .Created de cada serviço
  local svc
  for svc in "${APPS[@]}" "${DADOS[@]}" "${OBS[@]}"; do
    printf '%s %s\n' "$svc" "$(docker inspect -f '{{.Created}}' "$(id_of "$svc")")"
  done
}
env_of() { sed -n "s/^$1=//p" "$VPS_D/.env" | tail -n 1; }
image_of() { docker exec "$(id_of "$1")" cat /version; } # o conteúdo de /version do contêiner no ar

ok() { echo "ok    $1"; }
bad() {
  echo "FAIL  $1"
  fail=1
}
expect_rc() { if [ "$LAST_RC" = "$1" ]; then ok "saída $1"; else bad "saída $LAST_RC, esperada $1"; fi; }
expect_log() { if grep -qE -- "$1" "$LAST_OUT"; then ok "log: $1"; else bad "faltou no log: $1"; fi; }
expect_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1: '$2' ≠ '$3'"; fi; }
# compara o .Created de antes com o de agora: só os serviços dados podem ter mudado
expect_recreated() {
  local before="$1" after svc was now
  shift
  after="$(created)"
  for svc in "${APPS[@]}" "${DADOS[@]}" "${OBS[@]}"; do
    was="$(sed -n "s/^$svc //p" <<< "$before")"
    now="$(sed -n "s/^$svc //p" <<< "$after")"
    case " $* " in
      *" $svc "*) if [ "$was" != "$now" ]; then ok "$svc recriado"; else bad "$svc deveria ter sido recriado"; fi ;;
      *) if [ "$was" = "$now" ]; then ok "$svc intacto"; else bad "$svc foi recriado sem precisar ($was → $now)"; fi ;;
    esac
  done
}

# ── C0: a stack no ar num projeto só, como antes da transição ────────────────────────────────────────────────────────
echo "── C0: um projeto só"
{
  printf '%s' "$APP_ANCHOR"
  printf 'services:\n'
  services_dados
  services_obs
  services_apps
  printf 'volumes:\n  pgdata:\n  valkeydata:\n  s3data:\n  backups:\n  promdata:\n  grafanadata:\n'
} > "$REPO_T/infra/vps-telemetry/compose.yml"
C0="$(commit "c0")"
publish
cp "$REPO_T/infra/vps-telemetry/compose.yml" "$VPS_D/compose.yml"
{
  printf 'IMAGE_PREFIX=%s\nPULL_POLICY=missing\nOUTRA=mantida\nDEPLOY_SHA=%s\n' "$P" "$C0"
  for name in "${NAMES[@]}"; do printf 'TAG_%s=in-%s\n' "${name^^}" "$(hash_of "$name")"; done
} > "$VPS_D/.env"
(cd "$VPS_D" && docker compose up -d --quiet-pull </dev/null) >/dev/null 2>&1
for _ in $(seq 20); do
  [ -z "$(docker ps --filter "label=com.docker.compose.project=$PROJECT_T" --filter health=starting -q)" ] && break
  sleep 1
done
docker exec "$PROJECT_T-postgres-1" sh -c 'echo marca-do-banco > /data/marca'
docker exec "$PROJECT_T-prometheus-1" sh -c 'echo marca-do-prom > /data/marca'
net_id="$(docker network inspect -f '{{.Id}}' "${PROJECT_T}_default")"
apps_before=""
for svc in api demo webhooks ingestor agents maintenance; do apps_before+="$svc $(docker inspect -f '{{.Created}}' "$PROJECT_T-$svc-1")"$'\n'; done

echo "── C1: os três arquivos na main; a VPS num projeto só recusa o deploy, sem tocar em nada"
write_split_composes "$REPO_T/infra/vps-telemetry"
C1="$(commit "c1")"
publish
deploy "$C1"
expect_rc 1
expect_log '^FAIL  a VPS ainda está num projeto só'
expect_eq "DEPLOY_SHA não mudou" "$(env_of DEPLOY_SHA)" "$C0"
if grep -q postgres "$VPS_D/compose.yml"; then ok "compose.yml intacto"; else bad "compose.yml trocado"; fi

echo "── transição: falha num serviço desfaz só ele"
install_composes
good_dados="$(cat "$VPS_D/compose.dados.yml")"
sed -i "/^  postgres:/,/^  valkey:/ s|image: .*|image: $PROJECT_T-nao-existe:1|" "$VPS_D/compose.dados.yml"
migrar aplicar
expect_rc 1
expect_log '^FAIL  postgres não subiu'
expect_eq "Postgres antigo de volta" "$(docker inspect -f '{{.State.Running}}' "$PROJECT_T-postgres-1")" true
printf '%s\n' "$good_dados" > "$VPS_D/compose.dados.yml"

echo "── transição: aplica e confere"
migrar preparar
expect_rc 0
migrar aplicar
expect_rc 0
expect_log '^PASS  três projetos'
expect_log '^ok  postgres agora em'
expect_eq "marca do banco no volume de sempre" "$(docker exec "$(id_of postgres)" cat /data/marca)" marca-do-banco
expect_eq "marca do Prometheus no volume de sempre" "$(docker exec "$(id_of prometheus)" cat /data/marca)" marca-do-prom
expect_eq "a mesma rede" "$(docker network inspect -f '{{.Id}}' "${PROJECT_T}_default")" "$net_id"
if docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "${PROJECT_T}_default" | grep -q "$PROJECT_T-dados-postgres-1"; then ok "Postgres novo na rede"; else bad "Postgres novo fora da rede"; fi
apps_after=""
for svc in api demo webhooks ingestor agents maintenance; do apps_after+="$svc $(docker inspect -f '{{.Created}}' "$PROJECT_T-$svc-1")"$'\n'; done
expect_eq "apps não foram recriados" "$apps_after" "$apps_before"
expect_eq "Postgres antigo parado" "$(docker inspect -f '{{.State.Running}}' "$PROJECT_T-postgres-1")" false
expect_eq "um Postgres rodando" "$(docker ps -q --filter "volume=${PROJECT_T}_pgdata" | grep -c .)" 1

echo "── transição: repetir não faz nada"
before="$(created)"
migrar aplicar
expect_rc 0
expect_log '^postgres: já em'
expect_recreated "$before"

echo "── transição: reverso, e de novo para a frente"
migrar reverter
expect_rc 0
expect_eq "Postgres antigo de volta" "$(docker inspect -f '{{.State.Running}}' "$PROJECT_T-postgres-1")" true
expect_eq "um Postgres rodando" "$(docker ps -q --filter "volume=${PROJECT_T}_pgdata" | grep -c .)" 1
expect_eq "marca no antigo" "$(docker exec "$PROJECT_T-postgres-1" cat /data/marca)" marca-do-banco
if grep -q postgres "$VPS_D/compose.yml"; then ok "compose.yml antigo de volta"; else bad "compose.yml não voltou"; fi
deploy "$C1"
expect_rc 1
expect_log '^FAIL  a VPS ainda está num projeto só'
install_composes
migrar aplicar
expect_rc 0

echo "── o primeiro deploy depois da transição não recria nada"
before="$(created)"
deploy "$C1"
expect_rc 0
expect_log '^plano:.*demo: igual, fica'
expect_log '^SKIP  nada a publicar'
expect_recreated "$before"
expect_eq "DEPLOY_SHA gravado" "$(env_of DEPLOY_SHA)" "$C1"
expect_eq "o resto do .env ficou" "$(env_of OUTRA)" "mantida"
expect_eq "backup do .env" "$(sed -n 's/^DEPLOY_SHA=//p' "$VPS_D/.env.bak-${C0:0:7}")" "$C0"
expect_eq "resultado skip" "$(grep '^result=' "$WORK/github_output")" "result=skip"
migrar limpar
expect_rc 0
expect_eq "contêineres antigos saíram" "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_T" --filter label=com.docker.compose.service=postgres | grep -c . || true)" 0

echo "── mesmo SHA sem force: pula; com ON_SKIP=fail, vermelho"
deploy "$C1"
expect_rc 0
expect_log '^SKIP  .* já está no ar'
deploy "$C1" ON_SKIP=fail
expect_rc 1

echo "── C2: merge só na demo troca só a demo"
echo y >> "$REPO_T/apps/demo/x"
C2="$(commit "c2")"
publish
before="$(created)"
api_tag="$(env_of TAG_API)"
: > "$VPS_D/post-deploy.log"
deploy "$C2"
expect_rc 0
expect_log '^plano:.*demo: troca \(in-[0-9a-f]+ → in-[0-9a-f]+\)'
expect_log '^plano:.*ingestor: igual, fica'
expect_log '^plano:.*api: igual, fica'
expect_log '^plano:.*migrate: igual, fica'
expect_log '^candidato aprovado'
expect_log '^PASS  '
expect_recreated "$before" demo
expect_eq "TAG_DEMO nova" "$(env_of TAG_DEMO)" "in-$(hash_of demo)"
expect_eq "TAG_API igual" "$(env_of TAG_API)" "$api_tag"
expect_eq "um contêiner da demo" "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT_T" --filter label=com.docker.compose.service=demo | grep -c .)" 1
expect_eq "demo nova no ar" "$(image_of demo)" "$(hash_of demo)"
expect_eq "pós-deploy sem limpar o cache" "$(cat "$VPS_D/post-deploy.log")" "sem-cache $C2"
expect_eq "resultado deployed" "$(grep '^result=' "$WORK/github_output")" "result=deployed"
expect_log '^ok  demo na versão in-'
expect_eq "só a demo na lista das notas" "$(grep '^swapped=' "$WORK/github_output")" "swapped=demo"
if grep -q "^versions=.*demo=in-$(hash_of demo)" "$WORK/github_output"; then ok "hash nas notas"; else bad "hash fora das notas"; fi
expect_eq "sem candidato no ar" "$(cd "$VPS_D" && docker compose --profile candidate ps -aq api-candidate demo-candidate </dev/null | grep -c . || true)" 0

echo "── C3: só o compose do agents muda: troca só ele (configuração, mesma imagem)"
sed -i 's/AGENTE: um/AGENTE: dois/' "$REPO_T/infra/vps-telemetry/compose.yml"
C3="$(commit "c3")"
publish
before="$(created)"
: > "$VPS_D/post-deploy.log"
deploy "$C3"
expect_rc 0
expect_log '^plano:.*agents: troca \(config mudou\)'
expect_recreated "$before" agents
expect_eq "agents com a configuração nova" "$(docker exec "$(id_of agents)" printenv AGENTE)" dois
expect_eq "agents mexe no cache" "$(cat "$VPS_D/post-deploy.log")" "all $C3"

echo "── serviço de uma execução muda e termina com erro: o deploy reprova; volta a configuração anterior"
sed -i "s/'exit 0'/'exit 3'/" "$REPO_T/infra/vps-telemetry/compose.yml"
C3B="$(commit "c3b")"
publish
before="$(created)"
deploy "$C3B"
expect_rc 1
expect_log '^plano:.*tarefa: troca \(config mudou\)'
expect_log '^FAIL  tarefa terminou com código 3'
expect_log '^FAIL  deploy parcial .*tarefa na versão anterior'
expect_eq "DEPLOY_SHA é o anterior" "$(env_of DEPLOY_SHA)" "$C3"
expect_recreated "$before" tarefa
sed -i "s/'exit 3'/'exit 0'/" "$REPO_T/infra/vps-telemetry/compose.yml"
C3="$(commit "c3c")"
publish
deploy "$C3"
expect_rc 0

echo "── C4: API boa e demo que passa no candidato e não sobe: a API fica nova, a demo volta"
echo y >> "$REPO_T/apps/api/x"
echo y >> "$REPO_T/apps/demo/x"
touch "$REPO_T/QUEBRA_demo"
C4="$(commit "c4")"
publish
before="$(created)"
demo_old="$(env_of TAG_DEMO)"
demo_old_ver="$(image_of demo)"
deploy "$C4"
expect_rc 1
expect_log '^FAIL  demo: a troca falhou'
expect_log '^FAIL  demo: de volta na versão anterior'
expect_log '^FAIL  deploy parcial .*demo na versão anterior'
expect_recreated "$before" api webhooks migrate
expect_log 'ok  webhooks trocado sem manutenção'
expect_eq "API nova no ar" "$(image_of api)" "$(hash_of api)"
expect_eq "demo anterior no ar" "$(image_of demo)" "$demo_old_ver"
expect_eq "TAG_DEMO voltou" "$(env_of TAG_DEMO)" "$demo_old"
expect_eq "TAG_API nova" "$(env_of TAG_API)" "in-$(hash_of api)"
expect_eq "DEPLOY_SHA não é o da falha" "$(env_of DEPLOY_SHA)" "$C3"
expect_eq "sem resultado (nada de notas de versão)" "$(cat "$WORK/github_output")" ""

echo "── C5: a correção: o deploy seguinte troca só a demo"
rm "$REPO_T/QUEBRA_demo"
echo z >> "$REPO_T/apps/demo/x"
C5="$(commit "c5")"
publish
before="$(created)"
deploy "$C5"
expect_rc 0
expect_recreated "$before" demo
expect_eq "DEPLOY_SHA gravado" "$(env_of DEPLOY_SHA)" "$C5"

echo "── C6: ingestor que não sobe: volta só ingestor e agents"
echo y >> "$REPO_T/services/ingestor/x"
touch "$REPO_T/QUEBRA_ingestor"
C6="$(commit "c6")"
publish
before="$(created)"
ing_old="$(env_of TAG_INGESTOR)"
ing_old_ver="$(image_of ingestor)"
deploy "$C6"
expect_rc 1
expect_log '^FAIL  ingestor agents: a troca falhou'
expect_eq "TAG_INGESTOR voltou" "$(env_of TAG_INGESTOR)" "$ing_old"
expect_eq "ingestor anterior no ar" "$(image_of ingestor)" "$ing_old_ver"
expect_eq "agents anterior no ar" "$(image_of agents)" "$ing_old_ver"
after="$(created)"
for svc in api webhooks demo; do
  expect_eq "$svc intacto" "$(sed -n "s/^$svc //p" <<< "$after")" "$(sed -n "s/^$svc //p" <<< "$before")"
done

echo "── C7: ingestor e demo quebrados: mais de um falhou, volta o projeto inteiro"
rm "$REPO_T/QUEBRA_ingestor"
echo z >> "$REPO_T/services/ingestor/x"
C7_BASE="$(commit "c7-base")"
publish
deploy "$C7_BASE"
expect_rc 0
env_before="$(cat "$VPS_D/.env")"
echo w >> "$REPO_T/services/ingestor/x"
echo w >> "$REPO_T/apps/demo/x"
touch "$REPO_T/QUEBRA_ingestor" "$REPO_T/QUEBRA_demo"
C7="$(commit "c7")"
publish
deploy "$C7"
expect_rc 1
expect_log 'a troca falhou em mais de um serviço'
expect_log '^FAIL  deploy desfeito'
expect_eq ".env de antes" "$(cat "$VPS_D/.env")" "$env_before"
expect_eq "um Postgres rodando" "$(docker ps -q --filter "volume=${PROJECT_T}_pgdata" | grep -c .)" 1
rm "$REPO_T/QUEBRA_ingestor" "$REPO_T/QUEBRA_demo"
echo v >> "$REPO_T/services/ingestor/x"
echo v >> "$REPO_T/apps/demo/x"
C8="$(commit "c8")"
publish
deploy "$C8"
expect_rc 0

echo "── smoke vermelho com um grupo trocado: volta só ele"
echo u >> "$REPO_T/apps/demo/x"
touch "$REPO_T/SMOKE_FALHA_demo"
C9="$(commit "c9")"
publish
demo_old="$(env_of TAG_DEMO)"
deploy "$C9"
expect_rc 1
expect_log '^FAIL  deploy da .*: smoke test com falha'
expect_eq "TAG_DEMO voltou" "$(env_of TAG_DEMO)" "$demo_old"
expect_eq "DEPLOY_SHA é o anterior" "$(env_of DEPLOY_SHA)" "$C8"
rm "$REPO_T/SMOKE_FALHA_demo"
echo t >> "$REPO_T/apps/demo/x"
C10="$(commit "c10")"
publish
deploy "$C10"
expect_rc 0

echo "── demo no ar expondo outra versão: vermelho, com o nome dela, e volta só ela"
echo s >> "$REPO_T/apps/demo/x"
touch "$REPO_T/MENTE_demo"
C_M="$(commit "mente")"
publish
demo_old="$(env_of TAG_DEMO)"
before="$(created)"
deploy "$C_M"
expect_rc 1
expect_log '^FAIL  demo: expõe in-velho em /api/version'
expect_log '^FAIL  deploy parcial .*demo na versão anterior'
expect_eq "TAG_DEMO voltou" "$(env_of TAG_DEMO)" "$demo_old"
expect_eq "DEPLOY_SHA é o anterior" "$(env_of DEPLOY_SHA)" "$C10"
after="$(created)"
for svc in api webhooks ingestor agents; do
  expect_eq "$svc intacto" "$(sed -n "s/^$svc //p" <<< "$after")" "$(sed -n "s/^$svc //p" <<< "$before")"
done
rm "$REPO_T/MENTE_demo"
echo r >> "$REPO_T/apps/demo/x"
C_OK="$(commit "conserta")"
publish
deploy "$C_OK"
expect_rc 0

echo "── manutenção forçada: só ela muda, um deploy no meio a mantém, e o down volta"
before="$(created)"
(cd "$VPS_D" && bash -s -- up < "$REPO_T/infra/vps-telemetry/maintenance.sh") >/dev/null 2>&1
expect_recreated "$before" maintenance
expect_eq "prioridade no .env" "$(env_of MAINTENANCE_PRIORITY)" 10000
maint_label() { docker inspect -f '{{index .Config.Labels "traefik.prioridade"}}' "$(id_of maintenance)"; }
expect_eq "prioridade no contêiner" "$(maint_label)" 10000
echo q >> "$REPO_T/apps/demo/x"
C_MA="$(commit "durante a manutenção")"
publish
deploy "$C_MA"
expect_rc 0
expect_log '^plano:.*maintenance: igual, fica'
expect_eq "segue forçada" "$(maint_label)" 10000
(cd "$VPS_D" && bash -s -- down < "$REPO_T/infra/vps-telemetry/maintenance.sh") >/dev/null 2>&1
expect_eq "de volta" "$(maint_label)" 1

echo "── obs: mudança no Prometheus não entra no deploy de apps; --project obs troca só ele"
echo y >> "$REPO_T/infra/observability/prometheus/a"
C_O="$(commit "obs")"
publish
before="$(created)"
prom_old="$(env_of TAG_PROMETHEUS)"
deploy "$C_O"
expect_rc 0
expect_log '^SKIP  nada a publicar'
expect_recreated "$before"
expect_eq "TAG_PROMETHEUS igual" "$(env_of TAG_PROMETHEUS)" "$prom_old"
deploy "$C_O" PROJECT=obs
expect_rc 0
expect_log '^plano:.*prometheus: troca'
expect_log '^plano:.*grafana: igual, fica'
expect_recreated "$before" prometheus
expect_eq "TAG_PROMETHEUS nova" "$(env_of TAG_PROMETHEUS)" "in-$(hash_of prometheus)"
expect_eq "DEPLOY_SHA_OBS gravado" "$(env_of DEPLOY_SHA_OBS)" "$C_O"
expect_eq "DEPLOY_SHA de apps igual" "$(env_of DEPLOY_SHA)" "$C_O"
expect_eq "sem notas de versão" "$(grep '^result=' "$WORK/github_output")" "result=obs"
expect_eq "as tags de apps ficaram" "$(env_of TAG_DEMO)" "in-$(hash_of demo)"
expect_eq "marca do Prometheus no volume" "$(docker exec "$(id_of prometheus)" cat /data/marca)" marca-do-prom

echo "── dados só por runbook: o roteiro recusa"
deploy "$C_O" PROJECT=dados
expect_rc 1
expect_log "^FAIL  projeto 'dados' não se publica por aqui"

echo "── volta para um SHA anterior aos três projetos (force), sem subir outro Postgres, e de lá para a frente"
git -C "$REPO_T" worktree add -q --detach "$WORK/alvo" "$C0"
deploy "$C0" FORCE=1 TARGET_DIR="$WORK/alvo"
expect_rc 0
expect_log '^PASS  '
expect_eq "TAG_DEMO é o SHA" "$(env_of TAG_DEMO)" "$C0"
expect_eq "TAG_PROMETHEUS não é deste projeto" "$(env_of TAG_PROMETHEUS)" "in-$(hash_of prometheus)"
if grep -q postgres "$VPS_D/compose.yml"; then bad "o compose com dados voltou para a VPS"; else ok "compose de apps segue na VPS"; fi
expect_eq "um Postgres rodando" "$(docker ps -q --filter "volume=${PROJECT_T}_pgdata" | grep -c .)" 1
expect_eq "demo da C0 no ar" "$(image_of demo)" "$(bash "$WORK/alvo/infra/ops/image-hash.sh" demo 2>/dev/null)"
C11="$(commit "c11")"
publish
deploy "$C11"
expect_rc 0
expect_eq "TAG_DEMO de novo" "$(env_of TAG_DEMO)" "in-$(hash_of demo)"
expect_eq "demo da frente no ar" "$(image_of demo)" "$(hash_of demo)"

[ "$fail" = 0 ] && echo "PASS  deploy só do que mudou e transição para três projetos"
exit "$fail"
