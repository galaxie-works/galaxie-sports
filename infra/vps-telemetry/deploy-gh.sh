#!/usr/bin/env bash
# Deploy da produção pelo GitHub Actions (.github/workflows/deploy.yml): as imagens do SHA já estão no GHCR (docker.yml)
# e a VPS só as baixa. Mesmo roteiro do deploy.sh (que segue como plano B, da máquina de dev), sem build e sem
# docker save | ssh. Roda no runner, a partir do checkout no SHA:
#
#   SHA=<sha> infra/vps-telemetry/deploy-gh.sh
#
# Ambiente: SHA (obrigatório); VPS (padrão root@145.223.94.149) e VPS_DIR; IMAGE_PREFIX (padrão
# ghcr.io/galaxie-works/galaxie-sports); GHCR_USER e GHCR_TOKEN (token que lê os pacotes; vazio = pacotes públicos);
# FORCE=1 publica de novo um SHA que já está no ar; ON_SKIP=fail faz o SHA já no ar sem FORCE sair com 1 em vez de 0
# (disparo manual: nunca verde sem publicar). A chave SSH e o known_hosts vêm do workflow.
#
# Passos:
#   1. as imagens do SHA existem no GHCR (antes de tocar a VPS)
#   2. trava na VPS ($DIR/.deploy.lock): a mesma do deploy.sh, então os dois nunca rodam juntos
#   3. SHA já no ar → sai sem fazer nada (o workflow pode disparar duas vezes para o mesmo commit)
#   4. login no GHCR num DOCKER_CONFIG temporário da VPS (o token chega pelo stdin, nunca na linha de comando, e o
#      arquivo sai no fim): a VPS não guarda credencial do GitHub
#   5. compose.yml do SHA e IMAGE_TAG no .env, validados; docker compose pull só dos serviços com imagem nossa (os de
#      terceiros, como o postgres, ficam na imagem que já está na VPS); com migration nova no journal do SHA, dump do
#      banco (pre-migrate-dump.sh; falhou = para sem trocar nada); backup dos dois arquivos e troca
#   6. docker compose up -d (escala atual do ingestor; PULL_POLICY=missing) e migrate com saída 0
#   7. pós-deploy (post-deploy.sh: seed semântico, nomes, importância, cache, conta da IA) e smoke test (smoke.mjs)
#   8. up, migrate, pós-deploy ou smoke com falha → volta para o SHA anterior quando é garantidamente o estado de antes
#      (nenhuma migration nova aplicada, backups e imagens antigas na VPS); senão imprime o rollback manual
#   9. lineup-render (perfil render): baixa a imagem da versão do Playwright quando a pasta mudou (nunca falha)
#  10. religa o espelho de assets (mirror-assets) se ele não estiver rodando
# As notas de versão são publicadas pelo workflow depois deste script, só com sucesso.
# Saída: 0 = publicado (ou já estava no ar); 1 = falhou (a mensagem diz se voltou para a versão anterior).
set -euo pipefail

: "${SHA:?defina SHA}"
case "${FORCE:-}" in 1 | true | sim | yes) FORCE=1 ;; *) FORCE="" ;; esac
VPS="${VPS:-root@145.223.94.149}"
DIR="${VPS_DIR:-/docker/galaxie-sports}"
REG="${IMAGE_PREFIX:-ghcr.io/galaxie-works/galaxie-sports}"
# Este script e os seus vêm do checkout atual (ROOT, a main); o que descreve a versão publicada (compose.yml,
# env.example, smoke.mjs) vem do checkout do SHA (TARGET_DIR; padrão: o mesmo). Assim, voltar para um SHA anterior a
# este roteiro também funciona. O post-deploy.sh vem do SHA quando ele já o tem.
ROOT="$(git rev-parse --show-toplevel)"
HERE="$ROOT/infra/vps-telemetry"
TARGET="${TARGET_DIR:-$ROOT}"
STACK="$TARGET/infra/vps-telemetry"
POST="$STACK/post-deploy.sh"
[ -f "$POST" ] || POST="$HERE/post-deploy.sh"
if [ "$(git -C "$TARGET" rev-parse HEAD)" != "$(git -C "$ROOT" rev-parse "$SHA^{commit}")" ]; then
  echo "FAIL  o checkout em $TARGET não está no SHA ${SHA:0:7}"
  exit 1
fi
LOCK="$DIR/.deploy.lock"
# a mesma idade do deploy.sh (teto padrão 80 min + 10): trava mais velha é de deploy morto
LOCK_STALE_MIN="${LOCK_STALE_MIN:-90}"
TREE_LABEL="works.galaxie.context-tree"
RUN_ID="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
CFG="$DIR/.ghcr-$RUN_ID" # DOCKER_CONFIG temporário na VPS
CD="cd $DIR && export PULL_POLICY=missing"
MIGRATIONS_SQL="cd $DIR && docker compose exec -T postgres sh -c 'psql -X -q -t -A -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"select count(*) from drizzle.__drizzle_migrations\"' </dev/null"

ssh() { command ssh -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 "$@"; }

echo "deploy ${SHA:0:7} (GitHub Actions)"

# ── serviços com imagem nossa ───────────────────────────────────────────────────────────────────────────────
# os que usam IMAGE_TAG no compose do SHA (no env.example a tag é só zeros); fora de perfil, como o lineup-render, não
ZERO="$(sed -n 's/^IMAGE_TAG=//p' "$STACK/env.example")"
config_json="$(docker compose -f "$STACK/compose.yml" --env-file "$STACK/env.example" config --format json)"
mapfile -t SERVICES < <(jq -r --arg z ":$ZERO" '.services | to_entries[] | select(.value.image | endswith($z)) | .key' <<< "$config_json" | sort)
mapfile -t NAMES < <(jq -r --arg z ":$ZERO" '.services[].image | select(endswith($z)) | rtrimstr($z) | sub(".*-"; "")' <<< "$config_json" | sort -u)
[ "${#SERVICES[@]}" -gt 0 ] || {
  echo "FAIL  nenhum serviço com IMAGE_TAG no compose.yml"
  exit 1
}
echo "serviços: ${SERVICES[*]} · imagens: ${NAMES[*]}"
# --services: só a lista acima (o CI confere que ela bate com as imagens que o docker.yml publica)
[ "${1:-}" != --services ] || exit 0

for name in "${NAMES[@]}"; do
  if ! docker buildx imagetools inspect "$REG-$name:$SHA" >/dev/null 2>&1; then
    echo "FAIL  $REG-$name:$SHA não está no GHCR (o workflow de imagens terminou com sucesso neste SHA?); nada foi tocado na VPS"
    exit 1
  fi
done
echo "imagens do SHA no GHCR: ok"

# ── saída: limpa a credencial, libera a trava e, se parou com a versão nova no ar, diz como voltar ───────────────
STAGE=start # start → up → finished; restored = já tratado
OLD=""
SCALE=""
MIG_BEFORE=""
MIG_AFTER=""
PRE_DUMP="" # dump de antes do migrate (só com migration nova)
LOCK_ID="gha-$RUN_ID-$(date +%s)"

rollback_help() {
  local o="${OLD:0:7}"
  if [[ "$MIG_BEFORE" =~ ^[0-9]+$ && "$MIG_AFTER" =~ ^[0-9]+$ && "$MIG_AFTER" = "$MIG_BEFORE" ]]; then
    echo "FAIL  voltar para ${o}: ssh $VPS '$CD && cp compose.yml.bak-$o compose.yml && cp .env.bak-$o .env && docker compose up -d --scale ingestor=${SCALE:-1}'"
    echo "FAIL  ou rode o workflow Deploy com sha=${OLD} (as imagens dele seguem no GHCR)"
  else
    if [[ "$MIG_BEFORE" =~ ^[0-9]+$ && "$MIG_AFTER" =~ ^[0-9]+$ ]]; then
      echo "FAIL  $((MIG_AFTER - MIG_BEFORE)) migration(s) nova(s) já aplicada(s): não volte só a imagem para ${o} (o código antigo pode quebrar com o schema novo)"
    else
      echo "FAIL  não deu para contar as migrations aplicadas (antes: '${MIG_BEFORE}', depois: '${MIG_AFTER}'): confira drizzle.__drizzle_migrations antes de voltar a imagem para ${o}"
    fi
    echo "FAIL  prefira corrigir para frente (deploy de um fix); voltar exige restaurar também o banco (infra/backup/restore.sh), perdendo o que foi gravado depois do dump"
    [ -z "$PRE_DUMP" ] || echo "FAIL  dump de antes do migrate: $PRE_DUMP"
  fi
  echo "FAIL  conferir: ssh $VPS 'cd $DIR && docker compose ps -a && docker compose logs --tail 50 migrate api'"
}

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$STAGE" = up ]; then
    echo "FAIL  deploy parou no meio (código $code): a ${SHA:0:7} está no ar, sem o resto do roteiro"
    rollback_help
  fi
  # credencial e trava: as duas saem mesmo com o job cancelado (o runner manda INT/TERM antes de matar)
  ssh -o ConnectTimeout=20 "$VPS" "rm -rf $CFG; if [ \"\$(cut -d' ' -f1 $LOCK/owner 2>/dev/null)\" = '$LOCK_ID' ]; then rm -rf $LOCK; fi" ||
    echo "WARN  limpeza na VPS não rodou; confira: ssh $VPS 'ls -d $CFG $LOCK'"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# ── trava na VPS (a mesma do deploy.sh) ─────────────────────────────────────────────────────────────────────
owner="$LOCK_ID ${SHA:0:7} $(date -u +%FT%TZ)"
lock="$(ssh "$VPS" "if mkdir $LOCK 2>/dev/null; then echo '$owner' > $LOCK/owner && echo ok; \
  elif [ -n \"\$(find $LOCK -maxdepth 0 -mmin +$LOCK_STALE_MIN 2>/dev/null)\" ]; then \
    old=\$(cat $LOCK/owner 2>/dev/null || echo '(sem dono)'); \
    rm -rf $LOCK && mkdir $LOCK && echo '$owner' > $LOCK/owner && echo \"tomada \$old\"; \
  else cat $LOCK/owner 2>/dev/null || echo '(sem dono)'; fi")"
case "$lock" in
  ok) ;;
  tomada*) echo "WARN  trava da VPS com mais de $LOCK_STALE_MIN min tomada (era: ${lock#tomada })" ;;
  *)
    echo "FAIL  outro deploy em andamento na VPS: ${lock:-(trava disputada agora)}"
    echo "FAIL  espere ele terminar e rode o workflow de novo. Se ele morreu: confira ssh $VPS 'cd $DIR && docker compose ps -a' e libere com ssh $VPS 'rm -rf $LOCK'"
    exit 1
    ;;
esac

OLD="$(ssh "$VPS" "grep -E '^IMAGE_TAG=' $DIR/.env | cut -d= -f2")"
if [ "$OLD" = "$SHA" ] && [ -z "$FORCE" ]; then
  if [ "${ON_SKIP:-pass}" = fail ]; then
    echo "FAIL  ${SHA:0:7} já está no ar e nada foi publicado; para publicar de novo, dispare com force=1"
    exit 1
  fi
  echo "SKIP  ${SHA:0:7} já está no ar; nada a fazer (FORCE=1 publica de novo)"
  echo "result=skip" >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi
echo "na VPS: ${OLD:0:7} → ${SHA:0:7}${FORCE:+ (force: publica de novo)}"

# ── credencial temporária do GHCR na VPS ────────────────────────────────────────────────────────────────────
if [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | ssh "$VPS" "umask 077 && mkdir -p $CFG && DOCKER_CONFIG=$CFG docker login ghcr.io -u '${GHCR_USER:-github-actions}' --password-stdin >/dev/null" ||
    {
      echo "FAIL  login no GHCR na VPS falhou; nada foi trocado"
      exit 1
    }
else
  ssh "$VPS" "umask 077 && mkdir -p $CFG"
fi
PULL="DOCKER_CONFIG=$CFG docker compose"

# ── compose.yml e .env novos, imagens novas ─────────────────────────────────────────────────────────────────
ssh "$VPS" "cat > $DIR/compose.yml.new" < "$STACK/compose.yml"
# escala atual do ingestor (0 enquanto a ingestão roda em outro ambiente); falha do ps não pode virar 0
SCALE="$(ssh "$VPS" "cd $DIR && ids=\$(docker compose ps -q ingestor) && { printf '%s\n' \"\$ids\" | grep -c . ; true; }")" ||
  SCALE=""
case "$SCALE" in
  '' | *[!0-9]*)
    echo "FAIL  não deu para ler a escala atual do ingestor (\"$SCALE\"); nada foi trocado na VPS"
    exit 1
    ;;
esac
if ! ssh "$VPS" "$CD && docker compose -f compose.yml.new pull --policy missing --quiet maintenance </dev/null"; then
  echo "FAIL  não deu para baixar a imagem da página de manutenção (Docker Hub fora?); nada foi trocado na VPS"
  exit 1
fi
echo "baixando as imagens (${SERVICES[*]})"
if ! ssh "$VPS" "$CD && (umask 077 && sed -e 's|^IMAGE_TAG=.*|IMAGE_TAG=$SHA|' -e 's|^IMAGE_PREFIX=.*|IMAGE_PREFIX=$REG|' .env > .env.check) \
  && docker compose -f compose.yml.new --env-file .env.check config -q \
  && $PULL -f compose.yml.new --env-file .env.check pull --quiet ${SERVICES[*]} </dev/null; ok=\$?; rm -f .env.check; exit \$ok"; then
  echo "FAIL  compose.yml/.env novos inválidos ou pull do GHCR falhou; nada foi trocado na VPS"
  exit 1
fi

# ── dump antes do migrate ───────────────────────────────────────────────────────────────────────────────────
# Migration nova não tem volta automática (restore_previous recusa): o dump é a volta. Só quando o journal do SHA tem
# mais migrations que o banco; sem espaço ou com o pg_dump falhando, para aqui, sem ter trocado nada.
journal="$(grep -c '"idx"' "$TARGET/packages/db/drizzle/meta/_journal.json")" || journal=""
if [ "${SKIP_PRE_MIGRATE_DUMP:-}" = 1 ]; then
  echo "WARN  SKIP_PRE_MIGRATE_DUMP=1: sem dump antes do migrate"
elif out="$(ssh "$VPS" "cd $DIR && bash -s -- '$journal' '${OLD:0:7}-${SHA:0:7}'" < "$HERE/pre-migrate-dump.sh")"; then
  printf '%s\n' "$out" | grep -v '^PRE_DUMP=' || true
  PRE_DUMP="$(sed -n 's/^PRE_DUMP=//p' <<< "$out")"
else
  printf '%s\n' "$out"
  echo "FAIL  dump antes do migrate não foi feito; nada foi trocado na VPS (SKIP_PRE_MIGRATE_DUMP=1 publica sem ele)"
  exit 1
fi

ssh "$VPS" "$CD && cp compose.yml compose.yml.bak-${OLD:0:7} && cp .env .env.bak-${OLD:0:7} \
  && mv compose.yml.new compose.yml && sed -i -e 's|^IMAGE_TAG=.*|IMAGE_TAG=$SHA|' -e 's|^IMAGE_PREFIX=.*|IMAGE_PREFIX=$REG|' .env"
MIG_BEFORE="$(ssh "$VPS" "$MIGRATIONS_SQL" 2>/dev/null)" || MIG_BEFORE=""

# Volta compose.yml e .env do deploy anterior e sobe de novo com as imagens antigas, que continuam na VPS. Só quando é
# garantidamente o estado de antes: nenhuma migration nova aplicada, SHA anterior diferente, backups no lugar e as
# imagens antigas presentes. Depois limpa o cache de novo (a versão nova pode ter gravado respostas). Nunca sai com 0.
restore_previous() {
  local o="${OLD:0:7}" why=""
  STAGE=restored
  echo "FAIL  deploy da ${SHA:0:7}: $1"
  MIG_AFTER="$(ssh "$VPS" "$MIGRATIONS_SQL" 2>/dev/null)" || MIG_AFTER=""
  if [ -z "$OLD" ] || [ "$OLD" = "$SHA" ]; then
    why="redeploy do mesmo SHA: não há versão anterior para onde voltar"
  elif ! [[ "$MIG_BEFORE" =~ ^[0-9]+$ && "$MIG_AFTER" =~ ^[0-9]+$ ]]; then
    why="não deu para contar as migrations aplicadas (antes: '${MIG_BEFORE}', depois: '${MIG_AFTER}')"
  elif [ "$MIG_AFTER" != "$MIG_BEFORE" ]; then
    why="$((MIG_AFTER - MIG_BEFORE)) migration(s) nova(s) aplicada(s): a ${o} pode não funcionar com o schema novo"
  elif ! ssh "$VPS" "$CD && test -f compose.yml.bak-$o && test -f .env.bak-$o \
    && prefix=\$(sed -n 's/^IMAGE_PREFIX=//p' .env.bak-$o) \
    && for s in ${NAMES[*]}; do docker image inspect \$prefix-\$s:$OLD >/dev/null || exit 1; done \
    && cp compose.yml.bak-$o compose.yml && cp .env.bak-$o .env \
    && docker compose up -d --scale ingestor=$SCALE --quiet-pull </dev/null"; then
    why="backup ou imagem antiga faltando, ou o up de volta na ${o} falhou"
  fi
  if [ -z "$why" ]; then
    # a base semântica volta para a da versão anterior (a imagem dela traz o data/knowledge dela)
    ssh "$VPS" "cd $DIR && GIT_SHA=$OLD bash -s -- seed" < "$HERE/post-deploy.sh" ||
      echo "WARN  seed semântico da ${o} não rodou depois de voltar"
    ssh "$VPS" "cd $DIR && bash -s -- cache" < "$HERE/post-deploy.sh" || echo "WARN  cache não foi limpo depois de voltar"
    echo "FAIL  deploy desfeito: compose.yml e .env de ${o} de volta e a stack subiu de novo nela; investigue antes de repetir"
    ssh "$VPS" "cd $DIR && docker compose ps -a --format '{{.Service}}: {{.Status}}'" || true
  else
    echo "FAIL  sem restauração automática ($why); a stack pode estar com contêineres das duas versões"
    rollback_help
  fi
  exit 1
}

STAGE=up
echo "subindo a stack"
if out="$(ssh "$VPS" "$CD && docker compose up -d --scale ingestor=$SCALE --quiet-pull </dev/null 2>&1")"; then
  :
else
  rc=$?
  printf '%s\n' "$out" | tail -n 20
  if [ "$rc" = 255 ]; then
    echo "FAIL  conexão com a VPS caiu durante o docker compose up; estado da stack desconhecido"
    exit 1
  fi
  restore_previous "docker compose up falhou"
fi
ssh "$VPS" "cd $DIR && docker compose logs migrate 2>&1 | tail -1"
if migrate="$(ssh "$VPS" "cd $DIR && docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' \$(docker compose ps -aq migrate)")"; then
  :
else
  rc=$?
  if [ "$rc" = 255 ]; then
    echo "FAIL  sem conexão com a VPS para conferir o migrate; a ${SHA:0:7} subiu, mas o deploy não foi conferido"
    exit 1
  fi
  migrate="contêiner não encontrado (código $rc)"
fi
[ "$migrate" = "exited 0" ] || restore_previous "migrate não terminou com sucesso ($migrate)"
MIG_AFTER="$(ssh "$VPS" "$MIGRATIONS_SQL" 2>/dev/null)" || MIG_AFTER=""

if ! ssh "$VPS" "cd $DIR && GIT_SHA=$SHA bash -s -- all" < "$POST"; then
  restore_previous "pós-deploy falhou (nomes, importância ou limpeza do cache)"
fi

echo "smoke test"
if ! ssh "$VPS" "cd $DIR && docker compose exec -T demo node -" < "$STACK/smoke.mjs"; then
  restore_previous "smoke test com falha"
fi
STAGE=finished

# ── lineup-render (perfil render, não sobe no deploy) ────────────────────────────────────────────────────────
# A tag é a versão do Playwright (a do compose.yml), não o SHA; o docker.yml a publica quando a pasta muda, com o hash
# da pasta no rótulo. Só baixa quando a VPS não tem essa versão da pasta. Nada aqui falha o deploy.
lr_pull() {
  local tree version image have
  tree="$(git -C "$ROOT" rev-parse -q --verify "$SHA:infra/lineup-render")" || return 0
  version="$(git -C "$ROOT" show "$SHA:infra/lineup-render/package.json" |
    sed -n 's/^ *"playwright": *"\([0-9][0-9.]*\)".*/\1/p')"
  [ -n "$version" ] || {
    echo "WARN  lineup-render: versão do playwright não encontrada; imagem não conferida"
    return 0
  }
  image="$REG-lineup-render:$version"
  [ -z "$(ssh "$VPS" "docker images -q --filter label=$TREE_LABEL=$tree $image")" ] || return 0
  echo "lineup-render: baixando $image (a VPS não tem esta versão da pasta)"
  if ! ssh "$VPS" "DOCKER_CONFIG=$CFG timeout 15m docker pull -q $image >/dev/null"; then
    echo "WARN  lineup-render: pull de $image falhou; o perfil render segue com a imagem que já estiver na VPS"
    return 0
  fi
  have="$(ssh "$VPS" "docker image inspect -f '{{index .Config.Labels \"$TREE_LABEL\"}}' $image" 2>/dev/null)" || have=""
  [ "$have" = "$tree" ] || echo "WARN  lineup-render: $image no GHCR é de outra versão da pasta (${have:-sem rótulo}); o docker.yml publica quando a pasta muda"
}
lr_pull

# ── espelho de assets ───────────────────────────────────────────────────────────────────────────────────────
# o up recria o ingestor e mata o mirror que rodava dentro dele; sem ingestor no ar (escala 0), não há o que religar
ssh "$VPS" "cd $DIR && if pgrep -f mirror-assets >/dev/null; then echo 'mirror: já rodando'; \
  elif [ -n \"\$(docker compose ps -q ingestor)\" ]; then \
    (setsid nohup docker compose exec -T ingestor node dist/cli/mirror-assets.js --concorrencia 4 </dev/null > /tmp/mirror.log 2>&1 &); echo 'mirror: religado'; \
  else echo 'mirror: ingestor fora do ar, nada a religar'; fi" || echo "WARN  mirror: não deu para religar"

echo "result=deployed" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "PASS  ${SHA:0:7} no ar"
