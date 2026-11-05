#!/usr/bin/env bash
# Poda das imagens de versões antigas da stack, rodada NA VPS dentro de /docker/galaxie-sports no fim do deploy (os
# dois roteiros mandam este arquivo pelo ssh, depois do smoke):
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- 3' < infra/vps-telemetry/prune-images.sh
#
# Cada troca traz uma tag nova da imagem que mudou, e nada tirava as antigas: com vários deploys por dia o disco enchia
# (alerta DiskFillingUp, #452). Para cada imagem (api, demo, ingestor, backup, prometheus, grafana) ficam a tag no ar
# (TAG_* do .env) e as KEEP anteriores distintas dela (padrão 3), lidas dos .env.bak-* mais novos: a volta de um serviço
# usa a imediatamente anterior, e o deploy.sh (plano B) carrega imagens que podem não estar no GHCR. Um .env de antes das
# tags por serviço vale pelo IMAGE_TAG, para todas. Sai só tag de deploy (<sha> ou in-<hash>, 40 hex) com o IMAGE_PREFIX
# do .env; o lineup-render (tag = versão do Playwright) e imagens de terceiros ficam.
# Imagem em uso por um contêiner, mesmo parado, também fica (docker rmi sem -f recusa). Por fim, as imagens sem tag
# (dangling: uma tag que foi baixada ou construída de novo, como o lineup-render quando a pasta muda). Não mexe em
# volume, contêiner nem cache de build.
# Saída: sempre 0 (o deploy só avisa); imprime o espaço livre antes e depois.
set -uo pipefail

KEEP="${1:-3}"
case "$KEEP" in '' | *[!0-9]*)
  echo "WARN  imagens: quantidade a manter inválida ('$KEEP'); nada removido"
  exit 0
  ;;
esac

IMAGES=(api demo ingestor backup prometheus grafana)

# a tag de uma imagem num .env: a dela ou, de antes das tags por serviço, a única
tag_in() {
  local t
  t="$(sed -n "s/^TAG_${2^^}=//p" "$1" 2>/dev/null | tail -n 1)"
  [ -n "$t" ] || t="$(sed -n 's/^IMAGE_TAG=//p' "$1" 2>/dev/null | tail -n 1)"
  printf '%s' "$t"
}

prefix="$(sed -n 's/^IMAGE_PREFIX=//p' .env 2>/dev/null | tail -n 1)"
if [ -z "$prefix" ]; then
  echo "WARN  imagens: IMAGE_PREFIX fora do .env; nada removido"
  exit 0
fi
for name in "${IMAGES[@]}"; do
  if [ -z "$(tag_in .env "$name")" ]; then
    echo "WARN  imagens: tag de $name fora do .env; nada removido"
    exit 0
  fi
done

free_mb() { df -Pk /var/lib/docker 2>/dev/null | awk 'NR == 2 { print int($4 / 1024) }'; }
before="$(free_mb)"

mapfile -t backups < <(ls -1t .env.bak-* 2>/dev/null)
# imagem:tag no ar e as KEEP anteriores distintas de cada imagem, do backup do .env mais novo para o mais velho
keep=" "
for name in "${IMAGES[@]}"; do
  keep="$keep$name:$(tag_in .env "$name") "
  n=0
  for f in "${backups[@]}"; do
    [ "$n" -lt "$KEEP" ] || break
    t="$(tag_in "$f" "$name")"
    [ -n "$t" ] || continue
    case "$keep" in *" $name:$t "*) continue ;; esac
    keep="$keep$name:$t "
    n=$((n + 1))
  done
done

removed=0
kept_in_use=0
while IFS= read -r ref; do
  repo="${ref%:*}"
  tag="${ref##*:}"
  [[ "$repo" == "$prefix-"* && "$repo" != *-lineup-render && "$tag" =~ ^(in-)?[0-9a-f]{40}$ ]] || continue
  case "$keep" in *" ${repo#"$prefix"-}:$tag "*) continue ;; esac
  if docker rmi "$ref" >/dev/null 2>&1; then
    removed=$((removed + 1))
  else
    kept_in_use=$((kept_in_use + 1))
  fi
done < <(docker images --format '{{.Repository}}:{{.Tag}}')

docker image prune -f >/dev/null 2>&1 || echo "WARN  imagens: a poda das imagens sem tag falhou"

after="$(free_mb)"
in_use=""
[ "$kept_in_use" -eq 0 ] || in_use=", $kept_in_use antiga(s) em uso por contêiner"
echo "imagens: $removed tag(s) antiga(s) removida(s); de cada imagem ficaram a no ar e até $KEEP anterior(es)$in_use; livre: ${before:-?} MB → ${after:-?} MB"
exit 0
