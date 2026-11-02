#!/usr/bin/env bash
# Ferramenta de runbook, para manutenção do banco (upgrade do Postgres, restauração): força a página de manutenção nos
# hosts da demo e da API. Não faz parte do deploy, que troca sem ela. Roda NA VPS, em /docker/galaxie-sports:
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- up'   < infra/vps-telemetry/maintenance.sh   # força
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- down' < infra/vps-telemetry/maintenance.sh   # volta ao normal
#
# Grava MAINTENANCE_PRIORITY no .env (10000 ganha dos routers de verdade; 1 só responde quando o de verdade some) e recria
# só o serviço maintenance. Idempotente. Enquanto forçada, ninguém alcança a demo nem a API pelo Traefik (nem admin), e um
# deploy no meio mantém a manutenção: o valor fica no .env. O smoke continua passando, pela rede interna.
# O script chega pelo stdin (bash -s): todo comando lê de /dev/null.
set -euo pipefail
export PULL_POLICY=missing

case "${1:-}" in
  up) priority=10000 ;;
  down) priority=1 ;;
  *)
    echo "uso: maintenance.sh up|down" >&2
    exit 2
    ;;
esac

# o .env só muda depois de o contêiner subir: falhou aqui, um deploy depois não força a manutenção sem ninguém pedir
MAINTENANCE_PRIORITY="$priority" docker compose up -d --no-deps --quiet-pull maintenance </dev/null
if grep -q '^MAINTENANCE_PRIORITY=' .env; then
  sed -i "s|^MAINTENANCE_PRIORITY=.*|MAINTENANCE_PRIORITY=$priority|" .env
else
  echo "MAINTENANCE_PRIORITY=$priority" >> .env
fi
echo "manutenção: $1 (MAINTENANCE_PRIORITY=$priority)"
