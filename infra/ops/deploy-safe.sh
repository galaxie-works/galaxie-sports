#!/usr/bin/env bash
# PLANO B: o deploy normal roda no GitHub Actions (.github/workflows/deploy.yml; docs/runbooks/deploy-pelo-github.md).
# Antes de usar este, desligue o automático (gh variable delete DEPLOY_AUTO); a trava na VPS é a mesma dos dois.
# Deploy da main com trava e tempo máximo, da máquina de dev (Windows, Git Bash):
#   - trava por mkdir (atômico): um deploy por vez; quem chega espera;
#   - sobe o Docker Desktop, roda infra/vps-telemetry/deploy.sh com teto de 80 min (DEPLOY_TIMEOUT; o deploy espera o CI por até 20 min) (travou = falha, não espera
#     para sempre), fecha o Docker e religa o espelho de assets na VPS;
#   - log em $GALAXIE_OPS_STATE/deploy-<rótulo>.log.
# Uso: infra/ops/deploy-safe.sh <rótulo>   (rode do checkout principal na main)
set -u
STATE="${GALAXIE_OPS_STATE:-$HOME/.galaxie-ops}"; mkdir -p "$STATE"
LOCK="$STATE/deploy.lock"; label="${1:-deploy}"; ROOT="${GALAXIE_ROOT:-/g/galaxie-sports}"
VPS="${VPS:-root@145.223.94.149}"
until mkdir "$LOCK" 2>/dev/null; do sleep 20; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
cd "$ROOT" || exit 1
git fetch -q origin && { [ "$(git branch --show-current)" = main ] && git merge -q --ff-only origin/main || true; }
git log --oneline -1 origin/main
powershell -NoProfile -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"
for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
timeout "${DEPLOY_TIMEOUT:-80m}" bash infra/vps-telemetry/deploy.sh > "$STATE/deploy-$label.log" 2>&1
code=$?
[ $code -eq 124 ] && echo "deploy TRAVOU (${DEPLOY_TIMEOUT:-80m}) — ver $STATE/deploy-$label.log" || echo "deploy exit=$code"
grep -E "^(FAIL|WARN|PASS  IA)|ok ·|Migrations|release " "$STATE/deploy-$label.log" | tail -10
powershell -NoProfile -Command "Get-Process 'Docker Desktop','com.docker.backend','com.docker.build' -ErrorAction SilentlyContinue | Stop-Process -Force; wsl --terminate docker-desktop" >/dev/null 2>&1
echo "docker fechado"
timeout 2m ssh -o ServerAliveInterval=30 "$VPS" 'cd /docker/galaxie-sports; pgrep -f mirror-assets >/dev/null || (setsid nohup docker compose exec -T ingestor node dist/cli/mirror-assets.js --concorrencia 4 > /tmp/mirror.log 2>&1 &); echo mirror ok'
exit $code
