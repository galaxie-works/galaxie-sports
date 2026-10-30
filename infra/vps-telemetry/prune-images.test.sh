#!/usr/bin/env bash
# Teste da poda das imagens antigas (prune-images.sh) contra o Docker de verdade, no CI (docker.yml › valida stack):
# imagens mínimas (docker import de um arquivo só) com o nome e a tag da stack, um .env e .env.bak-* como os do
# deploy. Ficam a versão no ar, as KEEP anteriores, a tag em uso por contêiner parado, o lineup-render e o que não é
# do IMAGE_PREFIX; sai o resto.
#
#   bash infra/vps-telemetry/prune-images.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
P="galaxie-prune-test/gs"
OTHER="galaxie-prune-test/outro"
mapfile -t S < <(for i in 1 2 3 4 5 6; do printf '%s%039d\n' "$i" 0 | tr 0 a; done)
CTR=""

cleanup() {
  [ -z "$CTR" ] || docker rm -f "$CTR" >/dev/null 2>&1 || true
  docker images --format '{{.Repository}}:{{.Tag}}' | grep '^galaxie-prune-test/' | xargs -r docker rmi -f >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

img() {
  local dir
  dir="$(mktemp -d)"
  echo "$1" > "$dir/v"
  tar -C "$dir" -c v | docker import -c 'CMD ["/v"]' - "$1" >/dev/null
  rm -rf "$dir"
}

# S[0] mais velha … S[5] no ar; S[1] tem um contêiner parado
for s in "${S[@]}"; do
  img "$P-api:$s"
  img "$P-demo:$s"
done
img "$P-lineup-render:1.64.0"
img "$P-api:manual"
img "$OTHER-api:${S[0]}"
CTR="$(docker create "$P-api:${S[1]}")"

cd "$WORK"
printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$P" "${S[5]}" > .env
# .env.bak-<sha7> do deploy (o mais novo é o anterior ao no ar) e um backup manual com a mesma tag de outro
for i in 0 1 2 3 4; do
  printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$P" "${S[$i]}" > ".env.bak-${S[$i]:0:7}"
  touch -d "@$((1700000000 + i * 60))" ".env.bak-${S[$i]:0:7}"
done
cp ".env.bak-${S[4]:0:7}" .env.bak-manual
touch -d "@1700000600" .env.bak-manual

out="$(bash -s -- 2 < "$HERE/prune-images.sh")"
echo "$out"

fail=0
has() { docker image inspect "$1" >/dev/null 2>&1; }
want() {
  if has "$1"; then echo "ok    fica $1"; else
    echo "FAIL  $1 deveria ficar"
    fail=1
  fi
}
gone() {
  if has "$1"; then
    echo "FAIL  $1 deveria sair"
    fail=1
  else echo "ok    sai $1"; fi
}
# no ar (S5) e as 2 anteriores distintas (S4, que aparece em dois backups, e S3)
for s in "${S[5]}" "${S[4]}" "${S[3]}"; do
  want "$P-api:$s"
  want "$P-demo:$s"
done
gone "$P-api:${S[2]}"
gone "$P-demo:${S[2]}"
gone "$P-api:${S[0]}"
gone "$P-demo:${S[1]}"
want "$P-api:${S[1]}" # contêiner parado
want "$P-lineup-render:1.64.0"
want "$P-api:manual"
want "$OTHER-api:${S[0]}"
grep -q '^imagens: 5 tag(s) antiga(s) removida(s); ficaram a no ar e 2 anterior(es), 1 antiga(s) em uso por contêiner;' <<< "$out" || {
  echo "FAIL  resumo inesperado"
  fail=1
}

# .env sem IMAGE_TAG: não remove nada
printf 'IMAGE_PREFIX=%s\n' "$P" > .env
out="$(bash -s -- 0 < "$HERE/prune-images.sh")"
grep -q '^WARN  imagens: IMAGE_PREFIX ou IMAGE_TAG fora do .env' <<< "$out" && has "$P-api:${S[5]}" || {
  echo "FAIL  sem IMAGE_TAG deveria só avisar"
  fail=1
}

[ "$fail" = 0 ] && echo "PASS  poda das imagens"
exit "$fail"
