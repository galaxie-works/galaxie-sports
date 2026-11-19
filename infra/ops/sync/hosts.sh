#!/bin/bash
# Endereços da rodada NAS → produção, carregado (source) pelos scripts desta pasta. Nada de IP no código (#1430):
#   VPS, VPS_DIR   do ambiente; senão das vars VPS_SSH_TARGET e VPS_DIR do ambiente producao do GitHub (gh logado)
#   GALAXIE_ENV    do ambiente; senão o .env do checkout principal (o primeiro do `git worktree list`)
#   NAS_PG         host:porta do Postgres do dev, lido do DATABASE_URL desse .env
#   NAS_S3         host:porta do S3 do dev, lido do S3_ENDPOINT desse .env
_gh_var() { gh -R galaxie-works/galaxie-sports variable get "$1" --env producao 2>/dev/null || true; }
: "${VPS:=${VPS_SSH_TARGET:-$(_gh_var VPS_SSH_TARGET)}}"
: "${VPS_DIR:=$(_gh_var VPS_DIR)}"
: "${VPS:?defina VPS ou entre no gh com acesso à var VPS_SSH_TARGET do ambiente producao}"
: "${VPS_DIR:?defina VPS_DIR ou entre no gh com acesso à var VPS_DIR do ambiente producao}"
if [ -z "${GALAXIE_ENV:-}" ]; then
  _main="$(git -C "$(dirname "${BASH_SOURCE[0]}")" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
  GALAXIE_ENV="${_main:+$_main/.env}"
fi
[ -f "${GALAXIE_ENV:-}" ] || { echo "sem o .env do dev (defina GALAXIE_ENV)" >&2; exit 1; }
env_get() { grep -E "^$1=" "$GALAXIE_ENV" | tail -n 1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//"; }
# host:porta de uma URL (postgres://u:s@host:5433/db, http://host:9000)
_hostport() { printf '%s' "$1" | sed -E 's#^[a-z]+://([^@/]*@)?([^/?]+).*#\2#'; }
NAS_PG="$(_hostport "$(env_get DATABASE_URL)")"
NAS_S3="$(_hostport "$(env_get S3_ENDPOINT)")"
[ -n "$NAS_PG" ] && [ -n "$NAS_S3" ] || { echo "DATABASE_URL ou S3_ENDPOINT ausentes em $GALAXIE_ENV" >&2; exit 1; }
export VPS VPS_DIR GALAXIE_ENV NAS_PG NAS_S3
