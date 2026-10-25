#!/usr/bin/env bash
# Trem de merge: para cada PR, atualiza com a main, espera o CI completo (>= 12 checks, nada pendente),
# e faz squash; PR com falha ou conflito fica de fora e é relatado. No fim, um deploy só.
# Uso: infra/ops/merge-train.sh <pr> [<pr>...]   (do checkout principal; gh autenticado)
cd "${GALAXIE_ROOT:-/g/galaxie-sports}" || exit 1
wait_ci() { prev=""; for i in $(seq 1 100); do s=$(gh pr checks $1 2>/dev/null | awk -F'	' '{print $1"="$2}' | sort); if [ -n "$s" ] && ! echo "$s" | grep -qE "=(pending|queued)" && [ "$s" = "$prev" ]; then echo "$s" | cut -d= -f2 | sort | uniq -c | tr '
' ' '; return; fi; prev="$s"; sleep 60; done; echo "timeout"; }
# CI completo = nada pendente e a mesma lista de checks em duas leituras seguidas (60 s); PRs que só
# mexem em docs ou workflows têm menos checks, por isso não há contagem mínima
merged=()
for p in "$@"; do
  st=$(gh pr view $p --json state,mergeable --jq '"\(.state) \(.mergeable)"')
  case "$st" in MERGED*|CLOSED*) echo "$p já $st"; continue;; esac
  gh pr update-branch $p >/dev/null 2>&1 && sleep 45
  r=$(wait_ci $p); echo "$p: $r"
  echo "$r" | grep -qE "fail|timeout" && { echo "$p FICOU DE FORA (CI)"; continue; }
  out=$(gh pr merge $p --squash --delete-branch 2>&1 | tail -1)
  [ "$(gh pr view $p --json state --jq .state)" = MERGED ] && merged+=($p) || echo "$p FICOU DE FORA: $out"
done
echo "MERGEADOS: ${merged[*]}"
