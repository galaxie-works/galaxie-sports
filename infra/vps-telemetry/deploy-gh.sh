#!/usr/bin/env bash
# Deploy da produção pelo GitHub Actions (.github/workflows/deploy.yml): as imagens do SHA já estão no GHCR (docker.yml)
# e a VPS só as baixa. Mesmo roteiro do deploy.sh (que segue como plano B, da máquina de dev), sem build e sem
# docker save | ssh. Roda no runner, a partir do checkout no SHA:
#
#   SHA=<sha> infra/vps-telemetry/deploy-gh.sh                  # apps (compose.yml), o deploy automático
#   SHA=<sha> infra/vps-telemetry/deploy-gh.sh --project obs    # observabilidade (compose.obs.yml), à mão
#
# A stack é três projetos na mesma rede (docs/runbooks/stack-em-tres-projetos.md). Dados (compose.dados.yml) não passam por
# aqui, só por runbook (docs/runbooks/stack-dados-e-observabilidade.md). VPS ainda num projeto só: recusa.
#
# Ambiente: SHA (obrigatório); VPS (padrão root@145.223.94.149) e VPS_DIR; IMAGE_PREFIX (padrão
# ghcr.io/galaxie-works/galaxie-sports); GHCR_USER e GHCR_TOKEN (token que lê os pacotes; vazio = pacotes públicos);
# FORCE=1 publica de novo um SHA que já está no ar; ON_SKIP=fail faz o SHA já no ar sem FORCE sair com 1 em vez de 0
# (disparo manual: nunca verde sem publicar). SWAP_HEALTH_TIMEOUT (padrão 180 s) é o teto para um serviço trocado ficar
# healthy. A chave SSH e o known_hosts vêm do workflow.
#
# Só troca o que mudou. Cada imagem tem a própria tag no .env da VPS (TAG_API, TAG_DEMO, TAG_INGESTOR, TAG_BACKUP,
# TAG_PROMETHEUS, TAG_GRAFANA), sempre o in-<hash> da entrada dela no SHA (infra/ops/image-hash.sh, a mesma fórmula do
# docker.yml). DEPLOY_SHA, no mesmo .env, só registra o SHA publicado: não vai para o env de nenhum serviço (env novo
# recriaria o contêiner). Um SHA anterior aos três projetos continua publicável, para voltar versão: o compose dele tem o
# Postgres e os outros dados, e subir isso daria dois Postgres no mesmo volume. Então publica as imagens dele (tag <sha>) com
# o compose.yml de apps deste checkout, e o smoke dele.
#
# Passos:
#   1. as imagens do SHA (tags <sha> e in-<hash>) existem no GHCR (antes de tocar a VPS)
#   2. trava na VPS ($DIR/.deploy.lock): a mesma do deploy.sh, então os dois nunca rodam juntos
#   3. SHA já no ar → sai sem fazer nada (o workflow pode disparar duas vezes para o mesmo commit)
#   4. login no GHCR num DOCKER_CONFIG temporário da VPS (o token chega pelo stdin, nunca na linha de comando, e o
#      arquivo sai no fim): a VPS não guarda credencial do GitHub
#   5. compose.yml do SHA e tags no .env, validados; docker compose pull só dos serviços com imagem nossa (os de
#      terceiros, como o postgres, ficam na imagem que já está na VPS)
#   6. plano (deploy-plan.sh): quem troca, por digest da imagem e por configuração; o log diz serviço a serviço
#   7. com migration nova no journal do SHA, dump do banco (pre-migrate-dump.sh; falhou = para sem trocar nada); migrate
#      com saída 0 antes de qualquer troca (a versão no ar segue, sobre o schema novo), só se a imagem ou a configuração
#      dele mudou, se há migration nova ou com FORCE
#   7b. com a api ou o app web (site e console; num SHA de antes da divisão, a demo) na lista: os candidatos sobem ao lado
#      dos que estão no ar, sem tráfego (candidate.sh), e o smoke roda em cada um web. Smoke com FAIL = para aqui, sem troca
#   8. backup do compose e do .env e troca dos dois. Lista vazia (sem FORCE): sem pós-deploy nem smoke, termina SKIP
#      nada a publicar. Senão, a troca, só da lista: ingestor/agents (recriação simples) → api, webhooks → site, console
#      (ou demo) (rolling-swap.sh, sem página de manutenção: o contêiner novo sobe ao lado do antigo, e o antigo só sai com
#      o novo healthy) → o resto. Sempre com --no-deps: quem não está na lista não é recriado. Serviço que saiu do compose
#      (SAI do plano: a demo, quando virou site e console) sai depois que os da mesma imagem trocaram (rolling-swap.sh
#      --retire); na volta do grupo, ele sobe de novo antes de os novos saírem
#   9. pós-deploy (post-deploy.sh: seed semântico, nomes, importância, cache, conta da IA; sem a limpeza do cache quando
#      API, webhooks, ingestor e agents ficaram), smoke test (smoke.mjs em cada contêiner web no ar, com a versão
#      esperada de API e demo) e conferência de cada serviço trocado (deploy-verify.sh: digest, rótulo da imagem e a
#      versão que o processo expõe)
#  10. falhou a troca de um serviço ou ele está na versão errada: volta só ele (e os da mesma tag), com a TAG_* e a
#      configuração de antes; os outros ficam, o deploy segue e termina vermelho, sem gravar o SHA (o deploy seguinte tenta de novo). Falhou
#      em mais de um, ou o pós-deploy ou o smoke com mais de um trocado: volta a stack inteira para o SHA anterior quando
#      é garantidamente o estado de antes (nenhuma migration nova aplicada, backups na VPS, imagens antigas na VPS ou
#      no GHCR); senão imprime o rollback manual
#  11. lineup-render (perfil render): baixa a imagem da versão do Playwright quando a pasta mudou (nunca falha)
#  12. religa o espelho de assets (mirror-assets) se ele não estiver rodando
#  13. guarda só os 10 backups mais novos do compose e do .env na VPS
#  14. poda as imagens de versões antigas (prune-images.sh: ficam a no ar e as DEPLOY_KEEP_IMAGES anteriores, padrão 3)
# As notas de versão são publicadas pelo workflow depois deste script, só com sucesso.
# Em obs, sem os passos do banco (7), do candidato (7b), do pós-deploy e do smoke (9) e os de apps (11 e 12), sem notas de
# versão, e com o SHA em DEPLOY_SHA_OBS.
# Saída: 0 = publicado, já estava no ar ou nada a publicar; 1 = falhou (a mensagem diz o que voltou e o que ficou).
set -euo pipefail

PROJECT="${PROJECT:-apps}"
ONLY_SERVICES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      PROJECT="${2:?--project apps|obs}"
      shift 2
      ;;
    --services)
      ONLY_SERVICES=1
      shift
      ;;
    *)
      echo "uso: deploy-gh.sh [--project apps|obs] [--services]" >&2
      exit 2
      ;;
  esac
done
case "$PROJECT:$ONLY_SERVICES" in
  apps:*)
    CF=compose.yml
    SHA_KEY=DEPLOY_SHA
    BAK_SUFFIX=""
    ;;
  obs:*)
    CF=compose.obs.yml
    SHA_KEY=DEPLOY_SHA_OBS
    BAK_SUFFIX="obs-"
    ;;
  dados:1)
    # só a lista (o CI confere as imagens dos três); publicar dados é por runbook
    CF=compose.dados.yml
    ;;
  *)
    echo "FAIL  projeto '$PROJECT' não se publica por aqui (apps, obs; dados só por runbook)"
    exit 1
    ;;
esac
DC="docker compose -f $CF"

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
# SHA anterior aos três projetos: o compose e o pós-deploy vêm deste checkout (acima, no cabeçalho)
PRESPLIT=""
COMPOSE_SRC="$STACK"
if [ ! -f "$STACK/compose.dados.yml" ]; then
  if [ "$PROJECT" != apps ]; then
    echo "FAIL  o SHA ${SHA:0:7} é anterior aos três projetos: não tem $CF"
    exit 1
  fi
  PRESPLIT=1
  COMPOSE_SRC="$HERE"
  POST="$HERE/post-deploy.sh"
fi
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
DADOS_DC="docker compose -f compose.dados.yml"
MIGRATIONS_SQL="cd $DIR && $DADOS_DC exec -T postgres sh -c 'psql -X -q -t -A -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"select count(*) from drizzle.__drizzle_migrations\"' </dev/null"

ssh() { command ssh -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 "$@"; }

echo "deploy ${SHA:0:7} (GitHub Actions)"

# ── serviços com imagem nossa ───────────────────────────────────────────────────────────────────────────────
# os que têm a tag de zeros do env.example no compose do SHA; fora de perfil, como o lineup-render, não
ZERO="$(sed -n 's/^TAG_API=//p' "$COMPOSE_SRC/env.example")"
config_json="$(docker compose -f "$COMPOSE_SRC/$CF" --env-file "$COMPOSE_SRC/env.example" config --format json)"
mapfile -t SERVICES < <(jq -r --arg z ":$ZERO" '.services | to_entries[] | select(.value.image | endswith($z)) | .key' <<< "$config_json" | sort)
mapfile -t NAMES < <(jq -r --arg z ":$ZERO" '.services[].image | select(endswith($z)) | rtrimstr($z) | sub(".*-"; "")' <<< "$config_json" | sort -u)
[ "${#SERVICES[@]}" -gt 0 ] || {
  echo "FAIL  nenhum serviço com a tag de imagem no $CF"
  exit 1
}
echo "serviços: ${SERVICES[*]} · imagens: ${NAMES[*]}"
# serviço → imagem, e os que rodam uma vez (migrate, s3-init): com --wait o compose os daria por falhos ao terminar
declare -A SVC_IMAGE=() ONE_SHOT=()
while IFS='=' read -r svc name; do SVC_IMAGE[$svc]="$name"; done < <(jq -r --arg z ":$ZERO" \
  '.services | to_entries[] | select(.value.image | endswith($z)) | "\(.key)=\(.value.image | rtrimstr($z) | sub(".*-"; ""))"' <<< "$config_json")
while IFS= read -r svc; do ONE_SHOT[$svc]=1; done < <(jq -r '.services | to_entries[] | select(.value.restart == "no") | .key' <<< "$config_json")
# o app web do SHA: site e console (issue #546) ou, antes da divisão, a demo; a troca, o smoke e a conferência valem
# para cada um
WEB=()
for svc in site console demo; do
  [ -z "${SVC_IMAGE[$svc]:-}" ] || WEB+=("$svc")
done
in_web() { case " ${WEB[*]} " in *" $1 "*) return 0 ;; esac; return 1; }
# o compose do SHA tem os candidatos (api e um por serviço web)? (um SHA anterior a eles publica sem o candidato)
candidates="$(docker compose -f "$COMPOSE_SRC/$CF" --env-file "$COMPOSE_SRC/env.example" --profile candidate config --services)"
HAS_CANDIDATE=1
for svc in api "${WEB[@]}"; do
  grep -qx -- "$svc-candidate" <<< "$candidates" || HAS_CANDIDATE=""
done
# --services: só a lista acima (o CI confere que ela, nos três projetos, bate com as imagens que o docker.yml publica)
[ -z "$ONLY_SERVICES" ] || exit 0

# a tag de cada imagem neste SHA: o in-<hash> da entrada dela (o que o docker.yml publicou), calculado no checkout do SHA
declare -A IMAGE_TAG_OF=()
for name in "${NAMES[@]}"; do
  if [ -n "$PRESPLIT" ]; then
    IMAGE_TAG_OF[$name]="$SHA"
  elif hash="$(bash "$TARGET/infra/ops/image-hash.sh" "$name" 2>/dev/null)" && [ -n "$hash" ]; then
    IMAGE_TAG_OF[$name]="in-$hash"
  else
    echo "FAIL  não deu para calcular a entrada da imagem $name no checkout do SHA; nada foi tocado na VPS"
    exit 1
  fi
  for tag in "$SHA" "${IMAGE_TAG_OF[$name]}"; do
    if ! docker buildx imagetools inspect "$REG-$name:$tag" >/dev/null 2>&1; then
      echo "FAIL  $REG-$name:$tag não está no GHCR (o workflow de imagens terminou com sucesso neste SHA?); nada foi tocado na VPS"
      exit 1
    fi
  done
done
echo "imagens do SHA no GHCR: ok"

# o que o .env.next leva: a tag de cada imagem deste projeto e o SHA publicado. As tags dos outros projetos ficam
ENV_LINES="$SHA_KEY=$SHA"
ENV_TAG_KEYS="IMAGE_TAG|$SHA_KEY"
for name in "${NAMES[@]}"; do
  ENV_LINES+=$'\n'"TAG_${name^^}=${IMAGE_TAG_OF[$name]}"
  ENV_TAG_KEYS+="|TAG_${name^^}"
done
# os processos deste SHA expõem a versão? (um SHA anterior só se confere pelo digest e pelo rótulo)
HAS_VERSION=""
if [ -z "$PRESPLIT" ] && grep -q GALAXIE_IMAGE_HASH "$TARGET/apps/api/Dockerfile"; then HAS_VERSION=1; fi

# ── saída: limpa a credencial, libera a trava e, se parou com a versão nova no ar, diz como voltar ───────────────
STAGE=start # start → up → finished; restored = já tratado
OLD=""
SCALE=""
MIG_BEFORE=""
MIG_AFTER=""
PRE_DUMP="" # dump de antes do migrate (só com migration nova)
EARLY_MIG="" # migrations aplicadas antes da troca
CAND_UP=""
TROCA="" # serviços que trocam neste deploy (deploy-plan.sh)
LOCK_ID="gha-$RUN_ID-$(date +%s)"

rollback_help() {
  local o="${OLD:0:7}"
  if [[ "$MIG_BEFORE" =~ ^[0-9]+$ && "$MIG_AFTER" =~ ^[0-9]+$ && "$MIG_AFTER" = "$MIG_BEFORE" ]]; then
    echo "FAIL  voltar para ${o}: ssh $VPS '$CD && cp $CF.bak-$o $CF && cp .env.bak-$BAK_SUFFIX$o .env && $DC up -d --remove-orphans --scale ingestor=${SCALE:-1}'"
    echo "FAIL  ou rode o workflow Deploy com sha=${OLD} (as imagens dele seguem no GHCR)"
  else
    if [[ "$MIG_BEFORE" =~ ^[0-9]+$ && "$MIG_AFTER" =~ ^[0-9]+$ ]]; then
      echo "FAIL  $((MIG_AFTER - MIG_BEFORE)) migration(s) nova(s) já aplicada(s): não volte só a imagem para ${o} (o código antigo pode quebrar com o schema novo)"
    else
      echo "FAIL  não deu para contar as migrations aplicadas (antes: '${MIG_BEFORE}', depois: '${MIG_AFTER}'): confira drizzle.__drizzle_migrations antes de voltar a imagem para ${o}"
    fi
    echo "FAIL  prefira corrigir para frente (deploy de um fix); voltar exige restaurar também o banco (infra/backup/restore.sh), perdendo o que foi gravado depois do dump"
    [ -z "$PRE_DUMP" ] || echo "FAIL  dump de antes do migrate: ssh $VPS 'cd $DIR && $DADOS_DC exec backup restore.sh --yes $PRE_DUMP' (com API e ingestor parados)"
  fi
  echo "FAIL  conferir: ssh $VPS 'cd $DIR && $DC ps -a && $DC logs --tail 50'"
}

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$STAGE" = up ]; then
    echo "FAIL  deploy parou no meio (código $code): parte da ${SHA:0:7} está no ar, sem o resto do roteiro"
    rollback_help
  fi
  # candidato que ficou no ar (job cancelado no meio do smoke)
  if [ -n "$CAND_UP" ]; then
    ssh -o ConnectTimeout=20 "$VPS" "cd $DIR && bash -s -- down" < "$HERE/candidate.sh" ||
      echo "WARN  candidato não foi removido; confira: ssh $VPS 'cd $DIR && docker compose --profile candidate ps -a'"
  fi
  # credencial, trava, .env da versão nova (tem os segredos) e o smoke copiado: saem mesmo com o job cancelado (o
  # runner manda INT/TERM antes de matar)
  ssh -o ConnectTimeout=20 "$VPS" "rm -rf $CFG $DIR/.env.next $DIR/.smoke-$RUN_ID.mjs; if [ \"\$(cut -d' ' -f1 $LOCK/owner 2>/dev/null)\" = '$LOCK_ID' ]; then rm -rf $LOCK; fi" ||
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

# a VPS já está em três projetos? Sem isso, o compose novo deixaria os dados sem dono
if ! ssh "$VPS" "test -f $DIR/compose.dados.yml"; then
  echo "FAIL  a VPS ainda está num projeto só: rode a transição antes (docs/runbooks/stack-em-tres-projetos.md); nada foi tocado"
  exit 1
fi

# o SHA publicado: DEPLOY_SHA; antes das tags por serviço, IMAGE_TAG
OLD="$(ssh "$VPS" "sed -n 's/^$SHA_KEY=//p' $DIR/.env | tail -n 1")"
[ -n "$OLD" ] || [ "$PROJECT" != apps ] || OLD="$(ssh "$VPS" "sed -n 's/^IMAGE_TAG=//p' $DIR/.env | tail -n 1")"
# o primeiro deploy de obs: o SHA de apps não diz o que obs tem no ar
OLD="${OLD:-sem-registro}"
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
ssh "$VPS" "cat > $DIR/$CF.new" < "$COMPOSE_SRC/$CF"
# script do diagnóstico só leitura (a única coisa que a chave VPS_DIAG_SSH_KEY roda): sempre o do SHA publicado
if [ "$PROJECT" = apps ] && [ -f "$STACK/diagnostico.sh" ] && [ -z "$PRESPLIT" ]; then
  ssh "$VPS" "cat > $DIR/diagnostico.sh.new && chmod 755 $DIR/diagnostico.sh.new && mv $DIR/diagnostico.sh.new $DIR/diagnostico.sh"     < "$STACK/diagnostico.sh" || echo "WARN  não consegui gravar o diagnostico.sh na VPS (o diagnóstico de alerta fica na versão anterior)"
fi
# escala atual do ingestor (0 enquanto a ingestão roda em outro ambiente); falha do ps não pode virar 0
SCALE=0
if [ "$PROJECT" = apps ]; then
  SCALE="$(ssh "$VPS" "cd $DIR && ids=\$(docker compose ps -q ingestor) && { printf '%s\n' \"\$ids\" | grep -c . ; true; }")" ||
    SCALE=""
fi
case "$SCALE" in
  '' | *[!0-9]*)
    echo "FAIL  não deu para ler a escala atual do ingestor (\"$SCALE\"); nada foi trocado na VPS"
    exit 1
    ;;
esac
echo "baixando as imagens (${SERVICES[*]})"
# .env.next: o .env com a versão nova, para validar, baixar e planejar; vira o .env na troca (ou sai na limpeza da saída)
if ! ssh "$VPS" "$CD && (umask 077 && { grep -vE '^($ENV_TAG_KEYS)=' .env | sed -e 's|^IMAGE_PREFIX=.*|IMAGE_PREFIX=$REG|'; printf '%s\n' '$ENV_LINES'; } > .env.next) \
  && docker compose -f $CF.new --env-file .env.next config -q \
  && $PULL -f $CF.new --env-file .env.next pull --policy missing --quiet ${SERVICES[*]} </dev/null"; then
  echo "FAIL  compose.yml/.env novos inválidos ou pull do GHCR falhou; nada foi trocado na VPS"
  exit 1
fi

# ── plano: quem troca ───────────────────────────────────────────────────────────────────────────────────────
plan_args=("$SCALE")
for svc in "${SERVICES[@]}"; do
  name="${SVC_IMAGE[$svc]}"
  plan_args+=("$svc=$REG-$name:${IMAGE_TAG_OF[$name]}")
done
if ! plan="$(ssh "$VPS" "cd $DIR && PLAN_FILE=$CF.new bash -s -- ${plan_args[*]}" < "$HERE/deploy-plan.sh")"; then
  printf '%s\n' "$plan"
  echo "FAIL  não deu para comparar o que está no ar com o que o SHA pede; nada foi trocado na VPS"
  exit 1
fi
TROCA="$(sed -n 's/^TROCA=//p' <<< "$plan")"
echo "plano: $(grep -vE '^(TROCA|SAI)=' <<< "$plan" | paste -sd '|' | sed 's/|/ · /g')"
in_troca() { case " $TROCA " in *" $1 "*) return 0 ;; esac; return 1; }
# serviços no ar que o compose novo não tem (serviço → imagem): saem quando os da mesma imagem trocam (swap_group)
declare -A GONE=() RETIRED=()
for entry in $(sed -n 's/^SAI=//p' <<< "$plan"); do GONE[${entry%%:*}]="${entry#*:}"; done
# Worker de um SHA anterior à versão exposta não tem o /health que o compose daqui espera: os webhooks ficam como estão
if [ -n "$PRESPLIT" ] && ! grep -q GALAXIE_IMAGE_HASH "$TARGET/apps/api/Dockerfile" && in_troca webhooks; then
  echo "WARN  webhooks ficam: a ${SHA:0:7} é anterior ao /health do worker"
  TROCA="$(for s in $TROCA; do [ "$s" = webhooks ] || printf '%s ' "$s"; done)"
  TROCA="${TROCA% }"
fi

# ── o banco, só em apps ─────────────────────────────────────────────────────────────────────────────────────
if [ "$PROJECT" = apps ]; then

# migrations aplicadas antes de qualquer troca: a base da volta automática (restore_previous)
MIG_BEFORE="$(ssh "$VPS" "$MIGRATIONS_SQL" 2>/dev/null)" || MIG_BEFORE=""
journal="$(grep -c '"idx"' "$TARGET/packages/db/drizzle/meta/_journal.json")" || journal=""

# ── dump antes do migrate ───────────────────────────────────────────────────────────────────────────────────
# Migration nova não tem volta automática (restore_previous recusa): o dump é a volta. Só quando o journal do SHA tem
# mais migrations que o banco; sem espaço ou com o pg_dump falhando, para aqui, sem ter trocado nada.
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

# ── migrate: antes de qualquer troca ────────────────────────────────────────────────────────────────────────
# Numa transação (falhou = nada aplicado); a versão no ar segue sobre o schema novo até a troca. O candidato precisa do
# schema novo: sem contagem confiável, para aqui. Sem nada para trocar, não há o que migrar.
NEW_MIG=""
if [[ "$journal" =~ ^[0-9]+$ && "$MIG_BEFORE" =~ ^[0-9]+$ ]]; then
  [ "$journal" -le "$MIG_BEFORE" ] || NEW_MIG=$((journal - MIG_BEFORE))
elif [ -n "$TROCA" ] || [ -n "$FORCE" ]; then
  echo "FAIL  não deu para contar as migrations (journal: '$journal', banco: '$MIG_BEFORE'); nada foi trocado na VPS"
  exit 1
fi
if [ -n "$FORCE" ] || [ -n "$NEW_MIG" ] || in_troca migrate; then
  echo "migrate da ${SHA:0:7}${NEW_MIG:+ ($NEW_MIG migration(s) nova(s))}"
  COMPOSE_NEW="docker compose -f $CF.new --env-file .env.next"
  if migrate="$(ssh "$VPS" "$CD && $COMPOSE_NEW up -d --no-deps --quiet-pull migrate </dev/null 2>/dev/null && docker wait \$($COMPOSE_NEW ps -aq migrate </dev/null)")"; then
    :
  else
    migrate="não rodou (código $?)"
  fi
  ssh "$VPS" "cd $DIR && $COMPOSE_NEW logs migrate </dev/null 2>&1 | tail -1" || true
  if [ "$migrate" != 0 ]; then
    echo "FAIL  migrate da ${SHA:0:7} falhou (saída: $migrate); a ${OLD:0:7} segue no ar e nada foi trocado"
    exit 1
  fi
  EARLY_MIG="$NEW_MIG"
fi
TROCA="$(for s in $TROCA; do [ "$s" = migrate ] || printf '%s ' "$s"; done)"
TROCA="${TROCA% }"
MIG_AFTER="$(ssh "$VPS" "$MIGRATIONS_SQL" 2>/dev/null)" || MIG_AFTER=""

# ── candidato: smoke na versão nova antes da troca ──────────────────────────────────────────────────────────
web_in_troca() {
  local s
  for s in "${WEB[@]}"; do in_troca "$s" && return 0; done
  return 1
}
if [ -z "$HAS_CANDIDATE" ] && { in_troca api || web_in_troca; }; then
  echo "WARN  compose.yml da ${SHA:0:7} sem os candidatos (api-candidate e ${WEB[*]/%/-candidate}): publica sem o candidato"
elif in_troca api || web_in_troca; then
  echo "candidato: api e ${WEB[*]} da ${SHA:0:7} ao lado dos que estão no ar (sem tráfego)"
  CAND_UP=1
  ssh "$VPS" "cat > $DIR/.smoke-$RUN_ID.mjs" < "$STACK/smoke.mjs"
  cand_smoke=""
  [ -z "$HAS_VERSION" ] || cand_smoke="SMOKE_API_IMAGE=${IMAGE_TAG_OF[api]} SMOKE_DEMO_IMAGE=${IMAGE_TAG_OF[demo]}"
  if ! ssh "$VPS" "cd $DIR && bash -s -- up" < "$HERE/candidate.sh" ||
    ! ssh "$VPS" "cd $DIR && bash -s -- smoke .smoke-$RUN_ID.mjs $cand_smoke" < "$HERE/candidate.sh"; then
    ssh "$VPS" "cd $DIR && bash -s -- down" < "$HERE/candidate.sh" || true
    CAND_UP=""
    echo "FAIL  candidato da ${SHA:0:7} reprovado (acima): sem troca, a ${OLD:0:7} segue no ar"
    if [ -n "$EARLY_MIG" ]; then
      echo "FAIL  $EARLY_MIG migration(s) da ${SHA:0:7} já aplicada(s): a ${OLD:0:7} roda sobre o schema novo. Corrija para frente; voltar o banco é o dump de antes do migrate${PRE_DUMP:+ ($PRE_DUMP)}"
    fi
    exit 1
  fi
  ssh "$VPS" "cd $DIR && bash -s -- down" < "$HERE/candidate.sh"
  CAND_UP=""
  echo "candidato aprovado no smoke: trocando"
fi

fi # apps

OLD_COMPOSE="$CF.bak-${OLD:0:7}"
OLD_ENV=".env.bak-$BAK_SUFFIX${OLD:0:7}"
ssh "$VPS" "$CD && cp $CF $OLD_COMPOSE && cp .env $OLD_ENV && mv $CF.new $CF && mv .env.next .env"

# Volta compose.yml e .env do deploy anterior e sobe de novo com as imagens antigas, que continuam na VPS ou no GHCR. Só
# quando é garantidamente o estado de antes: nenhuma migration nova aplicada, SHA anterior diferente e backups no lugar.
# Depois limpa o cache de novo (a versão nova pode ter gravado respostas). Nunca sai com 0.
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
  elif ! ssh "$VPS" "$CD && test -f $OLD_COMPOSE && test -f $OLD_ENV \
    && $PULL -f $OLD_COMPOSE --env-file $OLD_ENV pull --policy missing --quiet </dev/null \
    && cp $OLD_COMPOSE $CF && cp $OLD_ENV .env \
    && $DC up -d --remove-orphans $( [ "$PROJECT" != apps ] || echo "--scale ingestor=$SCALE" ) --quiet-pull </dev/null"; then
    why="backup ou imagem antiga faltando, ou o up de volta na ${o} falhou"
  fi
  if [ -z "$why" ]; then
    if [ "$PROJECT" = apps ]; then
      # a base semântica volta para a da versão anterior (a imagem dela traz o data/knowledge dela)
      ssh "$VPS" "cd $DIR && GIT_SHA=$OLD bash -s -- seed" < "$HERE/post-deploy.sh" ||
        echo "WARN  seed semântico da ${o} não rodou depois de voltar"
      ssh "$VPS" "cd $DIR && bash -s -- cache" < "$HERE/post-deploy.sh" || echo "WARN  cache não foi limpo depois de voltar"
    fi
    echo "FAIL  deploy desfeito: $CF e .env de ${o} de volta e o projeto subiu de novo nela; investigue antes de repetir"
    ssh "$VPS" "cd $DIR && $DC ps -a --format '{{.Service}}: {{.Status}}'" || true
  else
    echo "FAIL  sem restauração automática ($why); a stack pode estar com contêineres das duas versões"
    rollback_help
  fi
  exit 1
}

# Nada mudou (docs, workflow, comentário no compose): compose.yml e .env do SHA gravados acima, e só. Sem pós-deploy
# (o cache continua valendo) e sem smoke: não há versão nova para conferir.
if [ -z "$TROCA" ] && [ -z "$FORCE" ]; then
  echo "result=skip" >> "${GITHUB_OUTPUT:-/dev/null}"
  echo "SKIP  nada a publicar: ${SHA:0:7} não muda nenhum serviço no ar"
  exit 0
fi

STAGE=up
COMPOSE_BAK="COMPOSE_FILE=$OLD_COMPOSE COMPOSE_ENV_FILES=$OLD_ENV"

# sobe os serviços e espera ficarem healthy; quem roda uma vez, espera terminar com saída 0
up_wait() {
  local s scale="" rc long=() once=()
  for s in "$@"; do
    [ "$s" != ingestor ] || scale="--scale ingestor=$SCALE"
    if [ -n "${ONE_SHOT[$s]:-}" ]; then once+=("$s"); else long+=("$s"); fi
  done
  if [ "${#long[@]}" -gt 0 ]; then
    ssh "$VPS" "$CD && $DC up -d --no-deps --wait --wait-timeout ${SWAP_HEALTH_TIMEOUT:-180} $scale --quiet-pull ${long[*]} </dev/null" || return $?
  fi
  for s in "${once[@]}"; do
    rc="$(ssh "$VPS" "$CD && $DC up -d --no-deps --quiet-pull $s </dev/null 2>/dev/null && timeout ${SWAP_HEALTH_TIMEOUT:-180} docker wait \$($DC ps -aq $s </dev/null)")" || return $?
    if [ "$rc" != 0 ]; then
      echo "FAIL  $s terminou com código $rc"
      return 1
    fi
  done
}

# Troca um grupo (os serviços da mesma tag), um por vez na ordem dada: api, webhooks, site, console e demo lado a lado (o
# antigo só sai com o novo healthy), o resto por recriação simples. TOUCHED = os que saíram da configuração de antes.
# Com o grupo no ar, sai quem deixou o compose e tinha a mesma imagem (GONE: a demo, quando site e console sobem);
# RETIRED[grupo] guarda quem saiu, para a volta do grupo subi-lo de novo.
TOUCHED=()
swap_group() {
  local s plain=() images=" " gone
  TOUCHED=()
  for s in "$@"; do
    case "$s" in
      api | webhooks | site | console | demo)
        ssh "$VPS" "cd $DIR && bash -s -- $s" < "$HERE/rolling-swap.sh" || return $?
        TOUCHED+=("$s")
        ;;
      *) plain+=("$s") ;;
    esac
  done
  if [ "${#plain[@]}" -gt 0 ]; then
    TOUCHED+=("${plain[@]}")
    up_wait "${plain[@]}" || return $?
  fi
  for s in "$@"; do images+="${SVC_IMAGE[$s]:-} "; done
  for gone in "${!GONE[@]}"; do
    case "$images" in *" ${GONE[$gone]} "*) ;; *) continue ;; esac
    if ssh "$VPS" "cd $DIR && bash -s -- --retire $gone" < "$HERE/rolling-swap.sh"; then
      RETIRED["$*"]+="$gone "
      unset "GONE[$gone]"
    else
      echo "WARN  $gone saiu do compose e não foi tirado do ar; confira: ssh $VPS 'cd $DIR && docker ps -a | grep $gone'"
    fi
  done
}

# Volta só os serviços em TOUCHED para o compose.yml e o .env de antes, e a tag do grupo no .env (quem não tem imagem
# nossa fica sem isso). A configuração nova do serviço só entra no próximo deploy, que compara e tenta de novo. Quem
# saiu na troca do grupo (RETIRED) sobe de novo primeiro; serviço que o compose de antes não tem (site e console na
# volta para a demo) sai depois.
rollback_group() {
  local s scale var="" name tag="" key="$*" gone
  for gone in ${RETIRED[$key]:-}; do
    ssh "$VPS" "cd $DIR && $COMPOSE_BAK bash -s -- $gone" < "$HERE/rolling-swap.sh" ||
      echo "FAIL  $gone: não voltou ao ar com a configuração anterior"
  done
  unset "RETIRED[$key]"
  for s in "$@"; do
    name="${SVC_IMAGE[$s]:-}"
    [ -z "$name" ] || var="TAG_${name^^}"
  done
  if [ -n "$var" ]; then
    tag="$(ssh "$VPS" "cd $DIR && t=\$(sed -n 's/^$var=//p' $OLD_ENV | tail -n 1); [ -n \"\$t\" ] || t=\$(sed -n 's/^IMAGE_TAG=//p' $OLD_ENV | tail -n 1); printf '%s' \"\$t\"")" || tag=""
    if [ -n "$tag" ]; then
      ssh "$VPS" "cd $DIR && sed -i 's|^$var=.*|$var=$tag|' .env"
    else
      echo "WARN  $var anterior não encontrada em $OLD_ENV; o .env segue com a nova"
    fi
  fi
  for s in "${TOUCHED[@]}"; do
    case "$s" in
      api | webhooks | site | console | demo)
        ssh "$VPS" "cd $DIR && export $COMPOSE_BAK && if docker compose config --services </dev/null | grep -qx $s; then \
          bash -s -- $s; else bash -s -- --retire $s; fi" < "$HERE/rolling-swap.sh" ||
          echo "FAIL  $s: a volta para a configuração anterior falhou"
        ;;
      *)
        scale=""
        [ "$s" != ingestor ] || scale="--scale ingestor=$SCALE"
        ssh "$VPS" "$CD && export $COMPOSE_BAK && if docker compose config --services </dev/null | grep -qx $s; then \
          docker compose up -d --no-deps $scale --quiet-pull $s </dev/null; else $DC rm -sf $s </dev/null; fi" ||
          echo "FAIL  $s: a volta para a configuração anterior falhou"
        ;;
    esac
  done
  echo "FAIL  $*: de volta na versão anterior${tag:+ ($(printf '%.10s' "$tag"))}; os outros serviços seguem como estão"
}

# o .env fica com o SHA anterior: o deploy seguinte, mesmo do mesmo SHA, compara e tenta de novo o que voltou
mark_not_published() {
  ssh "$VPS" "cd $DIR && sed -i 's|^$SHA_KEY=.*|$SHA_KEY=$OLD|' .env" || echo "WARN  $SHA_KEY não voltou no .env"
}

# ingestor/agents → api/webhooks → site/console (ou demo) → cada imagem do resto → o que não tem imagem nossa
GROUPS_ORDER=("ingestor agents" "api webhooks" "site console demo" "backup" "prometheus" "grafana")
others=""
for s in $TROCA; do
  case " ${GROUPS_ORDER[*]} " in *" $s "*) ;; *) others+=" $s" ;; esac
done
GROUPS_ORDER+=("$others")
FAILED=()
SWAPPED_GROUPS=()
for group in "${GROUPS_ORDER[@]}"; do
  members=()
  for s in $group; do
    if in_troca "$s"; then members+=("$s"); fi
  done
  [ "${#members[@]}" -gt 0 ] || continue
  echo "trocando: ${members[*]}"
  if swap_group "${members[@]}"; then
    SWAPPED_GROUPS+=("${members[*]}")
  else
    rc=$?
    if [ "$rc" = 255 ]; then
      echo "FAIL  conexão com a VPS caiu durante a troca de ${members[*]}; estado da stack desconhecido"
      exit 1
    fi
    echo "FAIL  ${members[*]}: a troca falhou"
    rollback_group "${members[@]}"
    FAILED+=("${members[*]}")
  fi
done
[ "${#FAILED[@]}" -lt 2 ] || restore_previous "a troca falhou em mais de um serviço (${FAILED[*]})"

# Pós-deploy ou smoke vermelho: com um grupo trocado, é dele; com mais, não dá para saber de quem
after_swap_failed() {
  local group
  if [ "${#SWAPPED_GROUPS[@]}" = 1 ]; then
    STAGE=restored
    read -ra group <<< "${SWAPPED_GROUPS[0]}"
    TOUCHED=("${group[@]}")
    echo "FAIL  deploy da ${SHA:0:7}: $1"
    rollback_group "${group[@]}"
    mark_not_published
    if [ "${MIG_AFTER:-}" != "${MIG_BEFORE:-}" ]; then
      echo "WARN  migration(s) nova(s) já aplicada(s): ${group[*]} anterior roda sobre o schema novo"
    fi
    ssh "$VPS" "cd $DIR && bash -s -- cache" < "$HERE/post-deploy.sh" || echo "WARN  cache não foi limpo depois de voltar"
    exit 1
  fi
  restore_previous "$1"
}

if [ "$PROJECT" = apps ]; then

# a limpeza do cache só faz sentido com API, webhooks, ingestor ou agents novos; um SHA sem o passo sem-cache limpa sempre
POST_STEP=all
if grep -q 'sem-cache)' "$POST" && ! in_troca api && ! in_troca webhooks && ! in_troca ingestor && ! in_troca agents; then
  POST_STEP=sem-cache
fi
if ! ssh "$VPS" "cd $DIR && GIT_SHA=$SHA bash -s -- $POST_STEP" < "$POST"; then
  after_swap_failed "pós-deploy falhou (nomes, importância ou limpeza do cache)"
fi

echo "smoke test"
# as tags do .env, não as do SHA: um grupo que voltou acima tem de expor a anterior
smoke_env=""
if [ -n "$HAS_VERSION" ]; then
  smoke_env="-e SMOKE_API_IMAGE=\$(sed -n 's/^TAG_API=//p' .env) -e SMOKE_DEMO_IMAGE=\$(sed -n 's/^TAG_DEMO=//p' .env)"
fi
# em cada contêiner web no ar (site e console; a demo, num SHA de antes da divisão ou depois da volta do grupo), pelo
# rótulo do projeto e não pelo compose: o serviço que voltou pode não estar no compose.yml novo. Cada um confere o que o
# papel dele atende (APP_ROLE do contêiner)
ssh "$VPS" "cat > $DIR/.smoke-$RUN_ID.mjs" < "$STACK/smoke.mjs"
if ! ssh "$VPS" "cd $DIR && p=\$(docker compose config </dev/null | sed -n 's/^name: //p') && rc=0 && n=0 && \
  for s in site console demo; do \
    id=\$(docker ps -q --filter label=com.docker.compose.project=\$p --filter label=com.docker.compose.service=\$s </dev/null | head -n 1); \
    [ -n \"\$id\" ] || continue; n=\$((n + 1)); echo \"smoke no \$s\"; \
    docker exec -i $smoke_env \$id node - < .smoke-$RUN_ID.mjs || rc=1; \
  done; [ \$n -gt 0 ] || { echo 'FAIL  nenhum contêiner web (site, console ou demo) no ar para o smoke'; rc=1; }; exit \$rc"; then
  after_swap_failed "smoke test com falha"
fi

fi # apps

# ── confere: cada serviço trocado está na versão pedida ─────────────────────────────────────────────────────
# Digest e rótulo da imagem do contêiner, e o que o processo expõe. Serviço na versão errada: FAIL, e volta só ele. Com
# FORCE, confere todos os nossos, porque a lista pode estar vazia.
verify_args=()
to_verify=("${SWAPPED_GROUPS[@]:-}")
[ -z "$FORCE" ] || to_verify+=("${SERVICES[*]}")
declare -A VERIFIED=()
for group in "${to_verify[@]}"; do
  for s in $group; do
    name="${SVC_IMAGE[$s]:-}"
    [ -n "$name" ] && [ -z "${ONE_SHOT[$s]:-}" ] && [ -z "${VERIFIED[$s]:-}" ] || continue
    [ "$s" != ingestor ] || [ "$SCALE" != 0 ] || continue
    VERIFIED[$s]=1
    port=""
    if [ -n "$HAS_VERSION" ]; then
      case "$s" in
        api | webhooks) port=8080 ;;
        site | console | demo) port=3000 ;;
        ingestor | agents) port=9464 ;;
      esac
    fi
    tag="${IMAGE_TAG_OF[$name]}"
    [ -z "$PRESPLIT" ] || tag=""
    verify_args+=("$s=$REG-$name:${IMAGE_TAG_OF[$name]}=$tag=$port")
  done
done
if [ "${#verify_args[@]}" -gt 0 ]; then
  echo "conferindo a versão de cada serviço"
  if verify_out="$(ssh "$VPS" "cd $DIR && COMPOSE_FILE=$CF bash -s -- ${verify_args[*]}" < "$HERE/deploy-verify.sh")"; then
    grep -v '^DIVERGENTE=' <<< "$verify_out"
  else
    rc=$?
    grep -v '^DIVERGENTE=' <<< "$verify_out" || true
    if [ "$rc" = 255 ]; then
      echo "FAIL  sem conexão com a VPS para conferir as versões; o deploy não foi conferido"
      exit 1
    fi
    divergent="$(sed -n 's/^DIVERGENTE=//p' <<< "$verify_out")"
    [ -n "$divergent" ] || divergent="(a conferência não terminou: código $rc)"
    kept=()
    for group in "${SWAPPED_GROUPS[@]:-}"; do
      hit=""
      for s in $group; do
        case " $divergent " in *" $s "*) hit=1 ;; esac
      done
      if [ -n "$hit" ]; then
        read -ra members <<< "$group"
        TOUCHED=("${members[@]}")
        rollback_group "${members[@]}"
        FAILED+=("$group")
      elif [ -n "$group" ]; then
        kept+=("$group")
      fi
    done
    SWAPPED_GROUPS=("${kept[@]:-}")
    # divergência fora da lista (FORCE) não tem o que voltar: fica o FAIL acima e o vermelho abaixo
    [ "${#FAILED[@]}" -gt 0 ] || FAILED+=("$divergent")
    [ "${#FAILED[@]}" -lt 2 ] || restore_previous "mais de um serviço na versão errada (${FAILED[*]})"
  fi
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  STAGE=restored
  mark_not_published
  echo "FAIL  deploy parcial da ${SHA:0:7}: ${FAILED[*]} na versão anterior; da ${SHA:0:7} no ar: ${SWAPPED_GROUPS[*]:-nada}"
  exit 1
fi
STAGE=finished

# ── lineup-render (perfil render, não sobe no deploy) ────────────────────────────────────────────────────────
# A tag é a versão do Playwright (a do compose.yml), não o SHA; o docker.yml a publica quando a pasta muda, com o hash
# da pasta no rótulo. Só baixa quando a VPS não tem essa versão da pasta. Nada aqui falha o deploy.
lr_pull() {
  [ "$PROJECT" = apps ] || return 0
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
# a troca do ingestor mata o mirror que rodava dentro dele; sem ingestor no ar (escala 0), não há o que religar
[ "$PROJECT" != apps ] || ssh "$VPS" "cd $DIR && if pgrep -f mirror-assets >/dev/null; then echo 'mirror: já rodando'; \
  elif [ -n \"\$(docker compose ps -q ingestor)\" ]; then \
    (setsid nohup docker compose exec -T ingestor node dist/cli/mirror-assets.js --concorrencia 4 </dev/null > /tmp/mirror.log 2>&1 &); echo 'mirror: religado'; \
  else echo 'mirror: ingestor fora do ar, nada a religar'; fi" || echo "WARN  mirror: não deu para religar"

# ── backups do compose e do .env: os 10 mais novos de cada ─────────────────────────────────────────────────
ssh "$VPS" "cd $DIR && for f in compose.yml compose.obs.yml .env; do ls -1t \$f.bak-* 2>/dev/null | tail -n +11 | xargs -r rm -f --; done" ||
  echo "WARN  backups antigos do compose.yml e do .env não foram podados"

# ── imagens de versões antigas: ficam a no ar e as DEPLOY_KEEP_IMAGES anteriores (padrão 3) ──────────────────────
ssh "$VPS" "cd $DIR && bash -s -- ${DEPLOY_KEEP_IMAGES:-3}" < "$HERE/prune-images.sh" ||
  echo "WARN  imagens antigas não foram podadas"

# para as notas de versão: o hash de cada imagem no ar e o que este deploy trocou
versions=""
for name in "${NAMES[@]}"; do versions+="$name=${IMAGE_TAG_OF[$name]} "; done
if [ "$PROJECT" = apps ]; then
  {
    echo "versions=${versions% }"
    echo "swapped=${SWAPPED_GROUPS[*]:-}"
    echo "result=deployed"
  } >> "${GITHUB_OUTPUT:-/dev/null}"
else
  echo "result=$PROJECT" >> "${GITHUB_OUTPUT:-/dev/null}"
fi
echo "PASS  ${SHA:0:7} no ar"
