#!/usr/bin/env bash
# Hash da entrada de uma imagem no HEAD do checkout onde este script está: a tag in-<hash> e o rótulo
# works.galaxie.context-tree. Uma fórmula só para quem publica (docker.yml › Entrada da imagem) e para quem publica na
# VPS (deploy-gh.sh): pasta única = hash git dela; várias = sha256 da listagem git delas. A lista das imagens do Node
# sai do grafo do pnpm (image-inputs.mjs); as outras são a própria pasta.
#
#   bash infra/ops/image-hash.sh api        # o hash na saída; a entrada, na saída de erro
set -euo pipefail

image="${1:?uso: image-hash.sh <imagem>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# o script roda fora do read: dentro dele, uma falha passaria calada e o ls-tree sem caminho listaria a raiz
case "$image" in
  backup) list=infra/backup ;;
  prometheus) list=infra/observability/prometheus ;;
  grafana) list=infra/observability/grafana ;;
  caddy) list=infra/caddy ;;
  *) list="$(node "$ROOT/infra/ops/image-inputs.mjs" "$image")" ;;
esac
read -ra paths <<< "$list"
echo "entrada de $image: ${paths[*]}" >&2
if [ "${#paths[@]}" = 1 ]; then
  git -C "$ROOT" rev-parse "HEAD:${paths[0]}"
else
  git -C "$ROOT" ls-tree HEAD -- "${paths[@]}" | sha256sum | cut -c1-40
fi
