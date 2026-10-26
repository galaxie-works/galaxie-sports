#!/bin/sh
# Cópia dos dumps do Postgres de produção para o NAS (camada 2 da política 3-2-1; docs/runbooks/exercicio-dr.md).
# Roda no container da stack `galaxie-sports-backup-nas` do NAS (compose.yml ao lado), pelo crond:
#   nas-pull.sh
# A cada execução:
#   1. lista os dumps do volume `backups` da VPS (chave só de leitura: rrsync -ro);
#   2. para cada dia UTC dos últimos NAS_KEEP_DAILY que ainda não tem cópia, baixa o dump mais recente daquele dia
#      com o .sha256 e confere o hash antes de guardar em daily/;
#   3. rotação avô-pai-filho por hardlink: weekly/ fica com o último dump de cada semana ISO (8) e monthly/ com o
#      último de cada mês (12); daily/ com os 14 dias mais recentes. Por contagem: com a cópia parada, nada some;
#   4. com o dump mais recente da VPS guardado e conferido, toca o recibo .nas_last_pull na VPS (segunda chave, cujo
#      único comando é o touch). O verificador da VPS (BACKUP_NAS_RECEIPT=true) acusa recibo com mais de 26 h.
set -eu

: "${NAS_DIR:=/data}"
: "${VPS_HOST:?defina VPS_HOST}"
: "${VPS_USER:=root}"
: "${VPS_PORT:=22}"
: "${DUMP_PREFIX:=galaxie_sports_}"
: "${NAS_KEEP_DAILY:=14}"
: "${NAS_KEEP_WEEKLY:=8}"
: "${NAS_KEEP_MONTHLY:=12}"
# Limite de banda do rsync em KiB/s (vazio = sem limite).
: "${NAS_BWLIMIT:=}"

ssh_dir="$NAS_DIR/ssh"
ssh_base="ssh -T -p $VPS_PORT -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
-o UserKnownHostsFile=$ssh_dir/known_hosts -o ConnectTimeout=30 -o ServerAliveInterval=30"
pull_ssh="$ssh_base -i $ssh_dir/pull_ed25519"
receipt_ssh="$ssh_base -i $ssh_dir/receipt_ed25519"

log() {
  level="$1"
  shift
  msg=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"level":"%s","time":"%s","service":"backup-nas","msg":"%s"}\n' "$level" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg"
}

fail() {
  log error "$*"
  printf '%s erro: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >"$NAS_DIR/last_run.txt"
  exit 1
}

# Uma execução por vez (o crond pode disparar de novo durante uma cópia lenta).
mkdir -p "$NAS_DIR/daily" "$NAS_DIR/weekly" "$NAS_DIR/monthly" "$NAS_DIR/incoming"
exec 9>"$NAS_DIR/.lock"
flock -n 9 || { log warn "outra cópia em andamento; saindo"; exit 0; }

# Data (AAAAMMDD) do nome galaxie_sports_AAAAMMDDThhmmssZ.dump.
day_of() { basename "$1" | sed -n "s/^${DUMP_PREFIX}\([0-9]\{8\}\)T[0-9]\{6\}Z\.dump$/\1/p"; }

# 1. Dumps da VPS (só os nomes, em ordem de tempo: o nome leva o horário UTC).
remote=$(rsync --list-only -e "$pull_ssh" "$VPS_USER@$VPS_HOST:" 2>&1) || fail "listar os dumps da VPS: $remote"
remote=$(printf '%s\n' "$remote" | awk '{print $NF}' | grep -E "^${DUMP_PREFIX}[0-9]{8}T[0-9]{6}Z\.dump$" | sort || true)
[ -n "$remote" ] || fail "nenhum dump na VPS"
newest=$(printf '%s\n' "$remote" | tail -n 1)
newest_day=$(day_of "$newest")

# 2. O mais recente de cada dia, nos últimos NAS_KEEP_DAILY dias com dump na VPS.
wanted=$(printf '%s\n' "$remote" | awk -v p="$DUMP_PREFIX" '{d=substr($0,length(p)+1,8); last[d]=$0} END {for (d in last) print last[d]}' |
  sort | tail -n "$NAS_KEEP_DAILY")

copied=0
for f in $wanted; do
  day=$(day_of "$f")
  if ls "$NAS_DIR/daily/${DUMP_PREFIX}${day}"T*Z.dump >/dev/null 2>&1; then
    continue
  fi
  log info "copiando $f"
  # shellcheck disable=SC2086 # NAS_BWLIMIT vazio some de propósito
  rsync -t --partial --inplace ${NAS_BWLIMIT:+--bwlimit=$NAS_BWLIMIT} -e "$pull_ssh" \
    "$VPS_USER@$VPS_HOST:$f" "$VPS_USER@$VPS_HOST:$f.sha256" "$NAS_DIR/incoming/" ||
    fail "copiar $f"
  expected=$(awk '{print $1}' "$NAS_DIR/incoming/$f.sha256")
  actual=$(sha256sum "$NAS_DIR/incoming/$f" | awk '{print $1}')
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    rm -f "$NAS_DIR/incoming/$f" "$NAS_DIR/incoming/$f.sha256"
    fail "sha256 não confere em $f (esperado ${expected:-vazio}, obtido $actual)"
  fi
  mv "$NAS_DIR/incoming/$f.sha256" "$NAS_DIR/daily/"
  mv "$NAS_DIR/incoming/$f" "$NAS_DIR/daily/"
  copied=$((copied + 1))
done

# 3. Rotação. Hardlink entre as pastas: um dump que é diário, semanal e mensal ocupa o disco uma vez só.
# keep_last <pasta> <n>: mantém os dumps dos n períodos mais recentes (um dump por período nessas pastas).
keep_last() {
  ls -1 "$1"/"${DUMP_PREFIX}"*.dump 2>/dev/null | sort | head -n "-$2" | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
}
# promote <pasta> <formato date>: a pasta fica com o dump mais recente de cada período (semana ISO ou mês).
promote() {
  dir="$1"
  fmt="$2"
  for d in $(ls -1 "$NAS_DIR"/daily/"${DUMP_PREFIX}"*.dump 2>/dev/null | sort); do
    printf '%s %s\n' "$(date -u -d "$(day_of "$d")" "+$fmt")" "$d"
  done | awk '{last[$1]=$2} END {for (p in last) print p, last[p]}' | while read -r period best; do
    for cur in "$dir"/"${DUMP_PREFIX}"*.dump; do
      [ -e "$cur" ] || continue
      [ "$(date -u -d "$(day_of "$cur")" "+$fmt")" = "$period" ] || continue
      [ "$(basename "$cur")" = "$(basename "$best")" ] && continue
      rm -f "$cur" "$cur.sha256"
    done
    [ -e "$dir/$(basename "$best")" ] || { ln "$best" "$dir/" && ln "$best.sha256" "$dir/"; }
  done
}
promote "$NAS_DIR/weekly" '%G-W%V'
promote "$NAS_DIR/monthly" '%Y-%m'
keep_last "$NAS_DIR/daily" "$NAS_KEEP_DAILY"
keep_last "$NAS_DIR/weekly" "$NAS_KEEP_WEEKLY"
keep_last "$NAS_DIR/monthly" "$NAS_KEEP_MONTHLY"

# 4. Recibo: só com o dia do dump mais recente da VPS guardado e conferido.
ls "$NAS_DIR/daily/${DUMP_PREFIX}${newest_day}"T*Z.dump >/dev/null 2>&1 || fail "o dia $newest_day não foi guardado"
out=$($receipt_ssh "$VPS_USER@$VPS_HOST" 2>&1) || fail "tocar o recibo na VPS: $out"

summary="$copied dump(s) novo(s); daily=$(ls "$NAS_DIR"/daily/*.dump 2>/dev/null | wc -l) weekly=$(ls "$NAS_DIR"/weekly/*.dump 2>/dev/null | wc -l) monthly=$(ls "$NAS_DIR"/monthly/*.dump 2>/dev/null | wc -l); mais recente na VPS: $newest"
printf '%s ok: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$summary" >"$NAS_DIR/last_run.txt"
log info "cópia do NAS OK: $summary"
