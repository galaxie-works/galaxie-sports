#!/usr/bin/env bash
# Plano B do migrate do dev (#550): aplica as migrations no Postgres do NAS a partir da máquina de dev, quando o
# `migrate` da stack do Portainer (infra/nas-dev/compose.yml, que roda a cada merge na main) não deu conta. O caminho
# normal não é este: confira antes com `pnpm --filter @galaxie/ingestor gs dev:esquema` e o contêiner migrate no
# Portainer. Runbook: docs/runbooks/ambiente-de-dev.md › Plano B.
#
# Lê DATABASE_URL do ambiente ou do .env do checkout principal (GALAXIE_ENV, padrão /g/galaxie-sports/.env) e RECUSA
# uma URL que não seja a do dev (NAS 192.168.1.34, ou localhost; DEV_HOSTS muda a lista), a não ser com --forcar.
#
#   infra/ops/migrate-dev.sh                 # a imagem publicada, tag main: docker run …-api:main migrate-cli.js
#   infra/ops/migrate-dev.sh --tag in-abc1234   # outra tag da imagem (a do SHA ou in-<hash>)
#   infra/ops/migrate-dev.sh --pnpm          # as migrations DESTE checkout (pnpm db:migrate), sem Docker: inclui as
#                                            # que ainda não entraram na main
#   infra/ops/migrate-dev.sh --plan          # só mostra o que faria
set -euo pipefail

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
}

MODE=imagem
TAG=main
PLAN=0
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pnpm) MODE=pnpm ;;
    --tag)
      [ $# -ge 2 ] || { echo "--tag precisa da tag" >&2; exit 2; }
      TAG="$2"
      shift
      ;;
    --tag=*) TAG="${1#*=}" ;;
    --plan | --plano) PLAN=1 ;;
    --forcar) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "opção desconhecida: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${GALAXIE_ENV:-/g/galaxie-sports/.env}"
URL="${DATABASE_URL:-}"
if [ -z "$URL" ]; then
  [ -f "$ENV_FILE" ] || { echo "sem DATABASE_URL no ambiente e sem $ENV_FILE (GALAXIE_ENV)" >&2; exit 2; }
  URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//")"
fi
[ -n "$URL" ] || { echo "DATABASE_URL vazia" >&2; exit 2; }

host="$(printf '%s' "$URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#')"
masked="$(printf '%s' "$URL" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#')"

dev=0
for h in ${DEV_HOSTS:-192.168.1.34 localhost 127.0.0.1}; do
  [ "$host" = "$h" ] && dev=1
done
if [ "$dev" != 1 ]; then
  cat >&2 <<EOF

##########################################################################
#                                                                        #
#   ATENÇÃO: DATABASE_URL NÃO É A DO DEV                                 #
#                                                                        #
#   host lido: $host
#   url:       $masked
#                                                                        #
#   Este script migra o Postgres de DEV do NAS (192.168.1.34:5433).      #
#   Para seguir mesmo assim, repita o comando com --forcar.              #
#                                                                        #
##########################################################################

EOF
  [ "$FORCE" = 1 ] || exit 1
  echo "--forcar: seguindo contra $host" >&2
fi

run() {
  if [ "$PLAN" = 1 ]; then
    echo "plano: $*"
  else
    echo "+ $*" >&2
    "$@"
  fi
}

case "$MODE" in
  imagem)
    IMAGE="${IMAGE_PREFIX:-ghcr.io/galaxie-works/galaxie-sports}-api:$TAG"
    # localhost dentro do contêiner é o próprio contêiner: o Docker Desktop expõe a máquina como host.docker.internal
    curl="$URL"
    case "$host" in
      localhost | 127.0.0.1) curl="$(printf '%s' "$URL" | sed -E "s#@$host([:/])#@host.docker.internal\1#")" ;;
    esac
    echo "migrate do dev pela imagem $IMAGE contra $masked (precisa do Docker e do login no ghcr.io)" >&2
    if [ "$PLAN" = 1 ]; then
      echo "plano: docker run --rm --pull always -e DATABASE_URL=*** -e DB_ROLES=off $IMAGE node node_modules/@galaxie/db/dist/migrate-cli.js"
    else
      run docker run --rm --pull always -e "DATABASE_URL=$curl" -e DB_ROLES=off "$IMAGE" \
        node node_modules/@galaxie/db/dist/migrate-cli.js
    fi
    ;;
  pnpm)
    branch="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '?')"
    echo "migrate do dev com as migrations DESTE checkout (branch $branch) contra $masked: inclui as que ainda não estão na main" >&2
    (
      cd "$ROOT"
      export DATABASE_URL="$URL" DB_ROLES=off
      run pnpm --filter @galaxie/db build
      run pnpm --filter @galaxie/db db:migrate
    )
    ;;
esac
