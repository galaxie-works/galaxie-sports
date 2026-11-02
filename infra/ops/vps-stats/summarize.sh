#!/usr/bin/env bash
# Resume o CSV do collect.sh (issue #533): pico, p95 e média de memória e de CPU por contêiner, e a soma de todos por
# instante (o pico da soma é o que tem de caber nos 7,9 GB da VPS).
#
#   infra/ops/vps-stats/summarize.sh                      # todos os CSVs de /root/stats
#   infra/ops/vps-stats/summarize.sh /caminho/dos/csv     # outra pasta, ou arquivos
#   DE=2026-11-07 ATE=2026-11-08 infra/ops/vps-stats/summarize.sh   # só o fim de semana (dias UTC, inclusive)
#
# Memória em MiB (a que o Docker conta contra o limite, sem cache de página); CPU em % de UMA vCPU (200% = as 2 vCPU).
# Contêiner de `docker compose run` (nome com -run-<hash>) entra com o nome do serviço. Linhas do que mais ao que menos
# usa memória no pico; "uso/lim" é o pico sobre o limite (sem limite o Docker mostra a RAM da máquina, ~7,9 GB, e a
# coluna fica perto de zero).
set -euo pipefail

STATS_DIR="${STATS_DIR:-/root/stats}"
DE="${DE:-0000-00-00}"
ATE="${ATE:-9999-99-99}"

if [ "$#" -eq 0 ]; then
  set -- "$STATS_DIR"
fi

files=()
for a in "$@"; do
  if [ -d "$a" ]; then
    for f in "$a"/docker-stats-*.csv; do [ -e "$f" ] && files+=("$f"); done
  elif [ -e "$a" ]; then
    files+=("$a")
  fi
done
if [ "${#files[@]}" -eq 0 ]; then
  echo "nenhum CSV docker-stats-*.csv em: $*" >&2
  exit 1
fi

# funções comuns aos dois resumos (awk do Ubuntu é o mawk: sem asort, por isso o shell sort)
awk_lib='
# "658.7MiB", "752KiB", "1.125GiB", "0B" -> MiB
function mib(s,   n, u) {
  n = s + 0
  u = s; sub(/^[0-9.]+/, "", u)
  if (u == "B")   return n / 1048576
  if (u == "KiB") return n / 1024
  if (u == "MiB") return n
  if (u == "GiB") return n * 1024
  if (u == "kB")  return n * 1000 / 1048576
  if (u == "MB")  return n * 1000000 / 1048576
  if (u == "GB")  return n * 1000000000 / 1048576
  return n
}
# ordenação (shell sort)
function sortv(a, n,   gap, i, j, t) {
  for (gap = int(n / 2); gap > 0; gap = int(gap / 2))
    for (i = gap + 1; i <= n; i++) {
      t = a[i]
      for (j = i; j > gap && a[j - gap] > t; j -= gap) a[j] = a[j - gap]
      a[j] = t
    }
}
function p95(a, n,   i) { i = int(n * 0.95 + 0.9999); if (i < 1) i = 1; return a[i] }
'

cat "${files[@]}" | awk -F, -v de="$DE" -v ate="$ATE" "$awk_lib"'
{
  ts = $1; day = substr(ts, 1, 10)
  if (day < de || day > ate) next
  if (NF < 5 || $4 == "--") next
  name = $2; sub(/^galaxie-sports-/, "", name); sub(/-1$/, "", name); sub(/-run-[0-9a-f]+$/, "", name)
  split($3, p, " / ")
  m = mib(p[1]); lim = mib(p[2]); c = $5 + 0
  n[name]++
  M[name, n[name]] = m; C[name, n[name]] = c
  limit[name] = lim
  tm[ts] += m; tc[ts] += c
  if (first == "" || ts < first) first = ts
  if (ts > last) last = ts
}
END {
  if (first == "") { print "nenhuma amostra no período" > "/dev/stderr"; exit 1 }
  printf "%-26s %8s | %9s %9s %9s %9s | %8s %8s %8s | %7s\n", "contêiner", "limite", "mem_pico", "mem_p95", "mem_med", "uso/lim", "cpu_pico", "cpu_p95", "cpu_med", "amostras"
  for (name in n) {
    k = n[name]; delete am; delete ac
    smax = 0; ssum = 0; cmax = 0; csum = 0
    for (i = 1; i <= k; i++) {
      am[i] = M[name, i]; ac[i] = C[name, i]
      if (am[i] > smax) smax = am[i]
      if (ac[i] > cmax) cmax = ac[i]
      ssum += am[i]; csum += ac[i]
    }
    sortv(am, k); sortv(ac, k)
    printf "%s\t%.0f\t%.0f\t%.0f\t%.0f\t%.0f%%\t%.0f%%\t%.0f%%\t%.0f%%\t%d\n", name, limit[name], smax, p95(am, k), ssum / k, (limit[name] > 0 ? 100 * smax / limit[name] : 0), cmax, p95(ac, k), csum / k, k
  }
}' | {
  IFS= read -r header
  echo "$header"
  # do que mais usa ao que menos usa (coluna 3 = mem_pico), alinhado como o cabeçalho
  sort -t$'\t' -k3,3nr | awk -F'\t' '{ printf "%-26s %6sMi | %7sMi %7sMi %7sMi %9s | %8s %8s %8s | %7s\n", $1, $2, $3, $4, $5, $6, $7, $8, $9, $10 }'
}

# soma de todos os contêineres por instante: pico, p95 e média da memória (MiB) e da CPU (% de uma vCPU)
cat "${files[@]}" | awk -F, -v de="$DE" -v ate="$ATE" "$awk_lib"'
{
  ts = $1; day = substr(ts, 1, 10)
  if (day < de || day > ate) next
  if (NF < 5 || $4 == "--") next
  split($3, p, " / ")
  tm[ts] += mib(p[1]); tc[ts] += $5 + 0
  if (first == "" || ts < first) first = ts
  if (ts > last) last = ts
}
END {
  for (ts in tm) {
    k++; am[k] = tm[ts]; ac[k] = tc[ts]
    if (am[k] > mx) { mx = am[k]; mxts = ts }
    if (ac[k] > cx) { cx = ac[k]; cxts = ts }
    ms += am[k]; cs += ac[k]
  }
  sortv(am, k); sortv(ac, k)
  printf "\nSOMA de todos os contêineres (%d instantes, de %s a %s)\n", k, first, last
  printf "  memória: pico %.0f MiB (em %s)  p95 %.0f MiB  média %.0f MiB\n", mx, mxts, p95(am, k), ms / k
  printf "  CPU:     pico %.0f%% de uma vCPU (em %s)  p95 %.0f%%  média %.0f%%   (200%% = as 2 vCPU cheias)\n", cx, cxts, p95(ac, k), cs / k
}'
