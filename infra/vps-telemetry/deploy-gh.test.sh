#!/usr/bin/env bash
# Teste do deploy só do que mudou (deploy-gh.sh + deploy-plan.sh + rolling-swap.sh + candidate.sh) contra o Docker de
# verdade, no CI (docker.yml › valida stack). O roteiro roda inteiro, sem tirar nada: o ssh é falso (roda o comando aqui),
# o GHCR é um registry local e o repositório é um git de brinquedo com o layout do de verdade, o mesmo image-inputs.mjs
# e imagens mínimas, em que a entrada de cada imagem muda como na vida real. O que ele prova, com docker inspect .Created:
#
#   - transição de IMAGE_TAG para as tags por serviço sem recriar nada
#   - merge só na demo troca só a demo; merge que só muda o compose de um serviço troca só ele
#   - falha num serviço volta só ele e fica registrada; o deploy seguinte tenta de novo
#   - serviço de uma execução só que termina com erro reprova o deploy
#   - falha em mais de um volta a stack inteira
#   - um SHA anterior às tags por serviço continua publicável, e dele se volta para a frente
#
#   bash infra/vps-telemetry/deploy-gh.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
REPO_T="$WORK/repo"
VPS_D="$WORK/galaxie-deploy-test"
BUILD="$WORK/build"
BIN="$WORK/bin"
PORT="${TEST_REGISTRY_PORT:-15055}"
REGISTRY_CT="galaxie-deploy-test-registry"
P="localhost:$PORT/galaxie-deploy-test/gs"
NAMES=(api demo ingestor backup prometheus grafana)
SERVICES=(agents api backup demo grafana ingestor maintenance migrate postgres prometheus s3-init valkey webhooks)
ZERO=0000000000000000000000000000000000000000
fail=0

export COMPOSE_PROJECT_NAME=galaxie-deploy-test
export SWAP_SETTLE_S=1 SWAP_STOP_GRACE_S=2 SWAP_HEALTH_TIMEOUT=25 CANDIDATE_TIMEOUT=25 DEPLOY_KEEP_IMAGES=3

cleanup() {
  (cd "$VPS_D" 2>/dev/null && docker compose --profile candidate down -v --remove-orphans >/dev/null 2>&1) || true
  docker rm -f "$REGISTRY_CT" >/dev/null 2>&1 || true
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^($P-|galaxie-deploy-test)" | xargs -r docker rmi -f >/dev/null 2>&1 || true
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
for f in deploy-gh.sh deploy-plan.sh rolling-swap.sh candidate.sh pre-migrate-dump.sh prune-images.sh; do
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
cat > "$REPO_T/infra/vps-telemetry/compose.yml" <<'YML'
x-app: &app
  pull_policy: ${PULL_POLICY:-always}
  restart: unless-stopped
  stop_grace_period: 2s
services:
  postgres:
    image: galaxie-deploy-test-tools:1
    pull_policy: never
    restart: unless-stopped
    stop_grace_period: 1s
  valkey:
    image: galaxie-deploy-test-tools:1
    pull_policy: never
    restart: unless-stopped
    stop_grace_period: 1s
  maintenance:
    image: galaxie-deploy-test-tools:1
    pull_policy: missing
    restart: unless-stopped
    stop_grace_period: 1s
  s3-init:
    image: galaxie-deploy-test-tools:1
    pull_policy: never
    command: ['sh', '-c', 'exit 0']
    restart: 'no'
  migrate:
    <<: *app
    image: ${IMAGE_PREFIX:?}-api:${TAG_API:?}
    command: ['true']
    restart: 'no'
  api: &api
    <<: *app
    image: ${IMAGE_PREFIX:?}-api:${TAG_API:?}
  webhooks:
    <<: *app
    image: ${IMAGE_PREFIX:?}-api:${TAG_API:?}
  demo: &demo
    <<: *app
    image: ${IMAGE_PREFIX:?}-demo:${TAG_DEMO:?}
  ingestor:
    <<: *app
    image: ${IMAGE_PREFIX:?}-ingestor:${TAG_INGESTOR:?}
  agents:
    <<: *app
    image: ${IMAGE_PREFIX:?}-ingestor:${TAG_INGESTOR:?}
    environment:
      AGENTE: um
  backup:
    <<: *app
    image: ${IMAGE_PREFIX:?}-backup:${TAG_BACKUP:?}
  prometheus:
    <<: *app
    image: ${IMAGE_PREFIX:?}-prometheus:${TAG_PROMETHEUS:?}
  grafana:
    <<: *app
    image: ${IMAGE_PREFIX:?}-grafana:${TAG_GRAFANA:?}
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

# ferramentas de faz de conta: psql responde a contagem de migrations; valkey-cli e o node do smoke são de mentira
mkdir -p "$BUILD/rootfs"
printf '#!/bin/sh\necho 1\n' > "$BUILD/rootfs/psql"
printf '#!/bin/sh\nexit 0\n' > "$BUILD/rootfs/valkey-cli"
printf '#!/bin/sh\nexec sh -s\n' > "$BUILD/rootfs/node"
chmod +x "$BUILD/rootfs/"*

# Dockerfile das imagens: conteúdo = o hash da entrada, para digest mudar só quando a entrada muda. Marcadores na raiz
# do repositório (fora da entrada; o commit muda também a pasta do app) fazem a versão ruim: QUEBRA_<imagem> nunca fica
# healthy fora do candidato, SMOKE_FALHA_<imagem> reprova o smoke fora do candidato.
image_dockerfile() {
  cat <<DOCKER
FROM busybox:1.37
COPY rootfs/ /usr/local/bin/
RUN echo "$1" > /version
$2
HEALTHCHECK --interval=1s --timeout=2s --retries=2 --start-period=0s CMD test ! -f /quebrada -o -n "\$CANDIDATO"
CMD ["sh", "-c", "trap 'exit 0' TERM; while :; do sleep 1 & wait \$!; done"]
DOCKER
}
printf 'FROM busybox:1.37\nCOPY rootfs/ /usr/local/bin/\nCMD ["sh", "-c", "trap '"'"'exit 0'"'"' TERM; while :; do sleep 1 & wait $!; done"]\n' > "$BUILD/Dockerfile.tools"
docker build -q -f "$BUILD/Dockerfile.tools" -t galaxie-deploy-test-tools:1 "$BUILD" >/dev/null

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

created() { # o .Created de cada serviço
  local svc id
  for svc in "${SERVICES[@]}"; do
    id="$(cd "$VPS_D" && docker compose ps -aq "$svc" </dev/null | head -n 1)"
    printf '%s %s\n' "$svc" "$(docker inspect -f '{{.Created}}' "$id")"
  done
}
env_of() { sed -n "s/^$1=//p" "$VPS_D/.env" | tail -n 1; }
image_of() { # o conteúdo de /version do contêiner no ar
  (cd "$VPS_D" && docker compose exec -T "$1" cat /version </dev/null)
}

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
  for svc in "${SERVICES[@]}"; do
    was="$(sed -n "s/^$svc //p" <<< "$before")"
    now="$(sed -n "s/^$svc //p" <<< "$after")"
    case " $* " in
      *" $svc "*) if [ "$was" != "$now" ]; then ok "$svc recriado"; else bad "$svc deveria ter sido recriado"; fi ;;
      *) if [ "$was" = "$now" ]; then ok "$svc intacto"; else bad "$svc foi recriado sem precisar ($was → $now)"; fi ;;
    esac
  done
}

# ── C0: a stack no ar como hoje, com IMAGE_TAG ───────────────────────────────────────────────────────────────────
echo "── C0: compose antigo, IMAGE_TAG único"
NEW_COMPOSE="$(cat "$REPO_T/infra/vps-telemetry/compose.yml")"
NEW_ENV_EXAMPLE="$(cat "$REPO_T/infra/vps-telemetry/env.example")"
sed -i -E 's/\$\{TAG_[A-Z]+:\?\}/${IMAGE_TAG:?}/' "$REPO_T/infra/vps-telemetry/compose.yml"
printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$P" "$ZERO" > "$REPO_T/infra/vps-telemetry/env.example"
C0="$(commit "c0")"
publish
cp "$REPO_T/infra/vps-telemetry/compose.yml" "$VPS_D/compose.yml"
printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\nPULL_POLICY=missing\nOUTRA=mantida\n' "$P" "$C0" > "$VPS_D/.env"
(cd "$VPS_D" && docker compose up -d --quiet-pull --wait </dev/null) >/dev/null 2>&1 ||
  (cd "$VPS_D" && docker compose up -d --quiet-pull </dev/null)

echo "── C1: chega o compose com as tags por serviço; imagens iguais não recriam nada"
printf '%s\n' "$NEW_COMPOSE" > "$REPO_T/infra/vps-telemetry/compose.yml"
printf '%s\n' "$NEW_ENV_EXAMPLE" > "$REPO_T/infra/vps-telemetry/env.example"
C1="$(commit "c1")"
publish
before="$(created)"
deploy "$C1" DEPLOY_CANDIDATE=on
expect_rc 0
expect_log '^plano:.*demo: igual, fica'
expect_log '^SKIP  nada a publicar'
expect_recreated "$before"
expect_eq "TAG_DEMO gravada" "$(env_of TAG_DEMO)" "in-$(hash_of demo)"
expect_eq "DEPLOY_SHA gravado" "$(env_of DEPLOY_SHA)" "$C1"
expect_eq "IMAGE_TAG saiu do .env" "$(env_of IMAGE_TAG)" ""
expect_eq "o resto do .env ficou" "$(env_of OUTRA)" "mantida"
expect_eq "backup do .env" "$(sed -n 's/^IMAGE_TAG=//p' "$VPS_D/.env.bak-${C0:0:7}")" "$C0"
expect_eq "resultado skip" "$(cat "$WORK/github_output")" "result=skip"

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
deploy "$C2" DEPLOY_CANDIDATE=on
expect_rc 0
expect_log '^plano:.*demo: troca \([^ ]+ → in-[0-9a-f]+\)'
expect_log '^plano:.*ingestor: igual, fica'
expect_log '^plano:.*api: igual, fica'
expect_log '^plano:.*migrate: igual, fica'
expect_log '^candidato aprovado'
expect_log '^PASS  '
expect_recreated "$before" demo
expect_eq "TAG_DEMO nova" "$(env_of TAG_DEMO)" "in-$(hash_of demo)"
expect_eq "TAG_API igual" "$(env_of TAG_API)" "$api_tag"
expect_eq "um contêiner da demo" "$(cd "$VPS_D" && docker compose ps -q demo </dev/null | grep -c .)" 1
expect_eq "demo nova no ar" "$(image_of demo)" "$(hash_of demo)"
expect_eq "pós-deploy sem limpar o cache" "$(cat "$VPS_D/post-deploy.log")" "sem-cache $C2"
expect_eq "resultado deployed" "$(cat "$WORK/github_output")" "result=deployed"
expect_eq "sem candidato no ar" "$(cd "$VPS_D" && docker compose --profile candidate ps -aq api-candidate demo-candidate </dev/null | grep -c . || true)" 0

echo "── C3: só o compose do agents muda: troca só ele (configuração, mesma imagem)"
sed -i 's/AGENTE: um/AGENTE: dois/' "$REPO_T/infra/vps-telemetry/compose.yml"
C3="$(commit "c3")"
publish
before="$(created)"
: > "$VPS_D/post-deploy.log"
deploy "$C3" DEPLOY_CANDIDATE=on
expect_rc 0
expect_log '^plano:.*agents: troca \(config mudou\)'
expect_recreated "$before" agents
expect_eq "agents com a configuração nova" "$(cd "$VPS_D" && docker compose exec -T agents printenv AGENTE </dev/null)" dois
expect_eq "agents mexe no cache" "$(cat "$VPS_D/post-deploy.log")" "all $C3"

echo "── s3-init muda e termina com erro: o deploy reprova; volta a configuração anterior"
sed -i "s/'exit 0'/'exit 3'/" "$REPO_T/infra/vps-telemetry/compose.yml"
C3B="$(commit "c3b")"
publish
before="$(created)"
deploy "$C3B" DEPLOY_CANDIDATE=on
expect_rc 1
expect_log '^plano:.*s3-init: troca \(config mudou\)'
expect_log '^FAIL  s3-init terminou com código 3'
expect_log '^FAIL  deploy parcial .*s3-init na versão anterior'
expect_eq "DEPLOY_SHA é o anterior" "$(env_of DEPLOY_SHA)" "$C3"
expect_recreated "$before" s3-init
sed -i "s/'exit 3'/'exit 0'/" "$REPO_T/infra/vps-telemetry/compose.yml"
C3="$(commit "c3c")"
publish
deploy "$C3" DEPLOY_CANDIDATE=on
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
deploy "$C4" DEPLOY_CANDIDATE=on
expect_rc 1
expect_log '^FAIL  demo: a troca falhou'
expect_log '^FAIL  demo: de volta na versão anterior'
expect_log '^FAIL  deploy parcial .*demo na versão anterior'
expect_recreated "$before" api webhooks migrate
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
deploy "$C5" DEPLOY_CANDIDATE=on
expect_rc 0
expect_recreated "$before" demo
expect_eq "DEPLOY_SHA gravado" "$(env_of DEPLOY_SHA)" "$C5"

echo "── C6: ingestor que não sobe, sem candidato no caminho: volta só ingestor e agents"
echo y >> "$REPO_T/services/ingestor/x"
touch "$REPO_T/QUEBRA_ingestor"
C6="$(commit "c6")"
publish
before="$(created)"
ing_old="$(env_of TAG_INGESTOR)"
ing_old_ver="$(image_of ingestor)"
deploy "$C6" DEPLOY_CANDIDATE=on
expect_rc 1
expect_log '^FAIL  ingestor agents: a troca falhou'
expect_eq "TAG_INGESTOR voltou" "$(env_of TAG_INGESTOR)" "$ing_old"
expect_eq "ingestor anterior no ar" "$(image_of ingestor)" "$ing_old_ver"
expect_eq "agents anterior no ar" "$(image_of agents)" "$ing_old_ver"
after="$(created)"
for svc in api webhooks demo; do
  expect_eq "$svc intacto" "$(sed -n "s/^$svc //p" <<< "$after")" "$(sed -n "s/^$svc //p" <<< "$before")"
done

echo "── C7: ingestor e demo quebrados: mais de um falhou, volta a stack inteira"
rm "$REPO_T/QUEBRA_ingestor"
echo z >> "$REPO_T/services/ingestor/x"
C5_FIX="$(commit "c7-base")"
publish
deploy "$C5_FIX" DEPLOY_CANDIDATE=on
expect_rc 0
env_before="$(cat "$VPS_D/.env")"
echo w >> "$REPO_T/services/ingestor/x"
echo w >> "$REPO_T/apps/demo/x"
touch "$REPO_T/QUEBRA_ingestor" "$REPO_T/QUEBRA_demo"
C7="$(commit "c7")"
publish
deploy "$C7" DEPLOY_CANDIDATE=on
expect_rc 1
expect_log 'a troca falhou em mais de um serviço'
expect_log '^FAIL  deploy desfeito'
expect_eq ".env de antes" "$(cat "$VPS_D/.env")" "$env_before"
rm "$REPO_T/QUEBRA_ingestor" "$REPO_T/QUEBRA_demo"
echo v >> "$REPO_T/services/ingestor/x"
echo v >> "$REPO_T/apps/demo/x"
C8="$(commit "c8")"
publish
deploy "$C8" DEPLOY_CANDIDATE=on
expect_rc 0

echo "── smoke vermelho com um grupo trocado: volta só ele"
echo u >> "$REPO_T/apps/demo/x"
touch "$REPO_T/SMOKE_FALHA_demo"
C9="$(commit "c9")"
publish
demo_old="$(env_of TAG_DEMO)"
before="$(created)"
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

echo "── volta para o SHA anterior às tags por serviço (force), e de lá para a frente"
git -C "$REPO_T" worktree add -q --detach "$WORK/alvo" "$C0"
deploy "$C0" FORCE=1 TARGET_DIR="$WORK/alvo"
expect_rc 0
expect_log '^PASS  '
expect_eq "IMAGE_TAG de volta" "$(env_of IMAGE_TAG)" "$C0"
expect_eq "TAG_API saiu" "$(env_of TAG_API)" ""
if grep -q 'IMAGE_TAG' "$VPS_D/compose.yml"; then ok "compose antigo"; else bad "compose não voltou"; fi
expect_eq "demo da C0 no ar" "$(image_of demo)" "$(bash "$WORK/alvo/infra/ops/image-hash.sh" demo 2>/dev/null)"
C11="$(commit "c11")"
publish
deploy "$C11"
expect_rc 0
expect_eq "TAG_DEMO de novo" "$(env_of TAG_DEMO)" "in-$(hash_of demo)"
expect_eq "demo da frente no ar" "$(image_of demo)" "$(hash_of demo)"
expect_eq "IMAGE_TAG saiu de novo" "$(env_of IMAGE_TAG)" ""

[ "$fail" = 0 ] && echo "PASS  deploy só do que mudou"
exit "$fail"
