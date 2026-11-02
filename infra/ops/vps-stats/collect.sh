#!/usr/bin/env bash
# Coletor de memória e CPU por contêiner (issue #533): uma amostra do `docker stats` por execução, com a hora em UTC,
# num CSV por dia. Roda na VPS, no cron de cada minuto; não precisa de nada além do Docker, do date e do flock.
#
#   * * * * * STATS_UNTIL=2026-11-12 /root/stats/collect.sh
#
# Saída: $STATS_DIR/docker-stats-AAAA-MM-DD.csv, uma linha por contêiner:
#   2026-11-02T19:38:54Z,galaxie-sports-postgres-1,658.7MiB / 1GiB,64.32%,0.81%
#   (hora UTC, nome, uso / limite, % do limite, % de CPU de UMA vCPU: 200% = as 2 vCPU cheias)
# Como ler: infra/ops/vps-stats/summarize.sh e docs/runbooks/on-call.md › Uso por contêiner.
#
#   STATS_DIR    pasta dos CSVs (padrão /root/stats)
#   STATS_UNTIL  último dia (UTC, AAAA-MM-DD) em que ainda grava; depois dele sai sem fazer nada. Vazio = sem fim.
set -euo pipefail

dir="${STATS_DIR:-/root/stats}"
until_day="${STATS_UNTIL:-}"

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
day="${now%%T*}"

# passou do último dia: nada a fazer (a linha do cron pode ficar; `crontab -e` e apague quando quiser)
if [ -n "$until_day" ] && [[ "$day" > "$until_day" ]]; then
  exit 0
fi

mkdir -p "$dir"

# uma coleta por vez: com a máquina carregada o `docker stats` demora, e a do minuto seguinte não deve empilhar
exec 9>"$dir/.collect.lock"
flock -n 9 || exit 0

out="$(docker stats --no-stream --format '{{.Name}},{{.MemUsage}},{{.MemPerc}},{{.CPUPerc}}')"

# sem saída (daemon parado, por exemplo) não grava linha nenhuma
[ -n "$out" ] || exit 0

# mesma hora em todas as linhas da amostra: as somas por instante do summarize.sh dependem disso
printf '%s\n' "$out" | sed "s/^/${now},/" >>"$dir/docker-stats-${day}.csv"
