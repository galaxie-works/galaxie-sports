#!/usr/bin/env bash
# Teste do hash da entrada (image-hash.sh), no CI (docker.yml › valida stack): as duas formas da fórmula, em relação ao
# git deste checkout, e a imagem desconhecida, que tem de falhar em vez de devolver o hash de uma lista vazia.
#
#   bash infra/ops/image-hash.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HASH="$ROOT/infra/ops/image-hash.sh"
fail=0

check() {
  if [ "$2" = "$3" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: '$2' ≠ '$3'"
    fail=1
  fi
}

for pair in backup:infra/backup prometheus:infra/observability/prometheus grafana:infra/observability/grafana caddy:infra/caddy; do
  check "${pair%%:*}: hash git da pasta" "$(bash "$HASH" "${pair%%:*}" 2>/dev/null)" "$(git -C "$ROOT" rev-parse "HEAD:${pair#*:}")"
done

for image in api demo ingestor; do
  read -ra paths <<< "$(node "$ROOT/infra/ops/image-inputs.mjs" "$image")"
  check "$image: sha256 da listagem git" "$(bash "$HASH" "$image" 2>/dev/null)" \
    "$(git -C "$ROOT" ls-tree HEAD -- "${paths[@]}" | sha256sum | cut -c1-40)"
done

# o segundo argumento escolhe o commit (producao-atrasada.mjs): HEAD explícito = sem argumento; o commit pelo SHA também
check "rev explícito" "$(bash "$HASH" api HEAD 2>/dev/null)" "$(bash "$HASH" api 2>/dev/null)"
check "rev pelo SHA" "$(bash "$HASH" api "$(git -C "$ROOT" rev-parse HEAD)" 2>/dev/null)" "$(bash "$HASH" api 2>/dev/null)"

# de qualquer pasta: o deploy roda do checkout da main, com o script do checkout do SHA
check "não depende da pasta atual" "$(cd / && bash "$HASH" api 2>/dev/null)" "$(bash "$HASH" api 2>/dev/null)"

if out="$(bash "$HASH" naoexiste 2>/dev/null)"; then
  echo "FAIL  imagem desconhecida devolveu '$out'"
  fail=1
else
  echo "ok    imagem desconhecida falha"
fi

[ "$fail" = 0 ] && echo "PASS  hash da entrada"
exit "$fail"
