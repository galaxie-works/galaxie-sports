#!/bin/sh
# Funções comuns das stacks do NAS que mexem nos dumps da pasta de backups (NAS_DIR): a cópia da VPS (nas-pull.sh,
# stack galaxie-sports-backup-nas) e o dump a partir da réplica (infra/nas-replica/dump.sh, stack nas-replica). Fica na
# própria pasta do NAS, ao lado do nas-pull.sh (cópia de infra/nas-backup/nas-lib.sh): quem a usa faz
#   . "$NAS_DIR/nas-lib.sh"   (ou . "$(dirname "$0")/nas-lib.sh")
# Precisa de NAS_DIR e DUMP_PREFIX definidos antes; os NAS_KEEP_* têm padrão aqui. Só sh (busybox) e GNU date.

: "${NAS_KEEP_DAILY:=7}"
: "${NAS_KEEP_WEEKLY:=4}"
: "${NAS_KEEP_MONTHLY:=6}"

# Data (AAAAMMDD) do nome galaxie_sports_AAAAMMDDThhmmssZ.dump (ou .dump.age, cifrado com age: o arquivo é guardado
# como está, e a chave privada nunca fica no NAS).
day_of() { basename "$1" | sed -n "s/^${DUMP_PREFIX}\([0-9]\{8\}\)T[0-9]\{6\}Z\.dump\(\.age\)\{0,1\}$/\1/p"; }
# Dumps de uma pasta (em claro e cifrados), em ordem de tempo (o nome leva o horário UTC).
dumps_in() { ls -1 "$1"/"${DUMP_PREFIX}"*.dump "$1"/"${DUMP_PREFIX}"*.dump.age 2>/dev/null | sort; }

# Rotação avô-pai-filho por hardlink. keep_last <pasta> <n>: mantém os dumps dos n períodos mais recentes (um dump por
# período nessas pastas).
keep_last() {
  dumps_in "$1" | head -n "-$2" | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
}
# promote <pasta> <formato date>: a pasta fica com o dump mais recente de cada período (semana ISO ou mês) de daily/.
promote() {
  dir="$1"
  fmt="$2"
  for d in $(dumps_in "$NAS_DIR/daily"); do
    printf '%s %s\n' "$(date -u -d "$(day_of "$d")" "+$fmt")" "$d"
  done | awk '{last[$1]=$2} END {for (p in last) print p, last[p]}' | while read -r period best; do
    for cur in "$dir"/"${DUMP_PREFIX}"*.dump "$dir"/"${DUMP_PREFIX}"*.dump.age; do
      [ -e "$cur" ] || continue
      [ "$(date -u -d "$(day_of "$cur")" "+$fmt")" = "$period" ] || continue
      [ "$(basename "$cur")" = "$(basename "$best")" ] && continue
      rm -f "$cur" "$cur.sha256"
    done
    [ -e "$dir/$(basename "$best")" ] || { ln "$best" "$dir/" && ln "$best.sha256" "$dir/"; }
  done
}
# A rotação inteira: weekly/ e monthly/ a partir de daily/, depois o corte por contagem nas três. Um dump que é diário,
# semanal e mensal ocupa o disco uma vez só. Por contagem: com a cópia (ou o dump) parado, nada some.
rotate_dumps() {
  mkdir -p "$NAS_DIR/daily" "$NAS_DIR/weekly" "$NAS_DIR/monthly"
  promote "$NAS_DIR/weekly" '%G-W%V'
  promote "$NAS_DIR/monthly" '%Y-%m'
  keep_last "$NAS_DIR/daily" "$NAS_KEEP_DAILY"
  keep_last "$NAS_DIR/weekly" "$NAS_KEEP_WEEKLY"
  keep_last "$NAS_DIR/monthly" "$NAS_KEEP_MONTHLY"
}
# Resumo das três pastas para o last_run.txt e o log.
dumps_summary() {
  printf 'daily=%s weekly=%s monthly=%s' "$(dumps_in "$NAS_DIR/daily" | wc -l)" \
    "$(dumps_in "$NAS_DIR/weekly" | wc -l)" "$(dumps_in "$NAS_DIR/monthly" | wc -l)"
}
