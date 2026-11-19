#!/usr/bin/env bash
# A mesma imagem de terceiros tem a mesma tag em todo lugar onde a infra a fixa: os compose de infra/ (produção, dev
# local, NAS) e os padrões dos testes de ponta a ponta (`${E2E_*_IMAGE:-imagem:tag}`). Divergência já deixou o NAS com
# rustfs 1.0.2 e o e2e com 1.0.4 enquanto a produção rodava 1.0.5 (#1432). Imagens nossas (ghcr.io/…) ficam de fora:
# a tag delas é o commit.
#   bash infra/ops/image-pins.test.sh            # na raiz do repositório
set -euo pipefail
cd "$(dirname "$0")/../.."

pins="$(
  {
    grep -rhoE '^[[:space:]]*image:[[:space:]]*["'"'"']?[a-z0-9./_-]+:[A-Za-z0-9._-]+' infra --include='*.yml' --include='*.yaml' |
      sed -E 's/^[[:space:]]*image:[[:space:]]*["'"'"']?//'
    grep -rhoE '\$\{E2E_[A-Z0-9_]+_IMAGE:-[a-z0-9./_-]+:[A-Za-z0-9._-]+\}' infra --include='*.sh' |
      sed -E 's/^\$\{E2E_[A-Z0-9_]+_IMAGE:-//; s/\}$//'
  } | grep -v '^ghcr\.io/' | sort -u
)"

[ -n "$pins" ] || { echo "FALHA: nenhuma imagem encontrada (o padrão do grep quebrou?)" >&2; exit 1; }

divergent="$(printf '%s\n' "$pins" | awk -F: '{ n = $1; t = substr($0, length(n) + 2); tags[n] = tags[n] " " t; c[n]++ }
  END { for (n in c) if (c[n] > 1) print n ":" tags[n] }' | sort)"

if [ -n "$divergent" ]; then
  echo "FALHA: imagem com tags diferentes na infra (alinhe todas na mesma versão):" >&2
  printf '  %s\n' "$divergent" >&2
  for img in $(printf '%s\n' "$divergent" | cut -d: -f1); do
    grep -rnE "(image:[[:space:]]*[\"']?|_IMAGE:-)$img:" infra --include='*.yml' --include='*.yaml' --include='*.sh' | sed 's/^/    /' >&2
  done
  exit 1
fi
echo "ok: $(printf '%s\n' "$pins" | wc -l | tr -d ' ') imagens fixadas, nenhuma com tag divergente"
