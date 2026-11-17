#!/bin/sh
# Cópia dos dumps do Postgres de produção para o NAS (camada 2 da política 3-2-1; docs/runbooks/exercicio-dr.md).
# Roda no container da stack `galaxie-sports-backup-nas` do NAS (compose.yml ao lado), pelo crond:
#   nas-pull.sh
# A cada execução:
#   1. lista os dumps do volume `backups` da VPS (chave só de leitura: rrsync -ro);
#   2. para cada dia UTC dos últimos NAS_KEEP_DAILY, baixa o dump mais recente daquele dia se o NAS não o tem (troca o
#      do mesmo dia mais antigo), com o .sha256, e confere o hash antes de guardar em daily/;
#   3. rotação avô-pai-filho por hardlink: weekly/ fica com o último dump de cada semana ISO (4) e monthly/ com o
#      último de cada mês (6); daily/ com os 7 dias mais recentes. Por contagem: com a cópia parada, nada some;
#   4. com NAS_S3_PREFIXES (os mesmos de BACKUP_S3_SYNC_PREFIXES da VPS), puxa também esses prefixos do bucket de assets,
#      que o s3-sync.sh da VPS espelha em s3/<prefixo>/ no volume `backups`, para $NAS_DIR/s3/<prefixo>/ (rsync, só o que
#      mudou). Sem rotação: os objetos são endereçados pelo conteúdo e nada é apagado (NAS_S3_DELETE=true espelha);
#   5. com o dump mais recente da VPS guardado e conferido (e os prefixos copiados), toca o recibo .nas_last_pull na VPS
#      (segunda chave, cujo único comando é o touch). O verificador da VPS (BACKUP_NAS_RECEIPT=true) acusa recibo com mais
#      de 26 h: a cópia dos assets que falha também deixa o recibo sem tocar.
# Com NAS_DUMPS_FROM_REPLICA=1 (docs/runbooks/replica-no-nas.md), os dumps nascem no próprio NAS, da réplica (stack
# nas-replica, infra/nas-replica/dump.sh), e os passos 1 a 3 são pulados: este script só puxa os prefixos do S3 e toca o
# recibo .nas_last_pull, que passa a significar "assets copiados". A rotação 7/4/6 de daily/ fica com o dump.sh.
set -eu

: "${NAS_DIR:=/data}"
: "${VPS_HOST:?defina VPS_HOST}"
: "${VPS_USER:=root}"
: "${VPS_PORT:=22}"
: "${DUMP_PREFIX:=galaxie_sports_}"
: "${NAS_KEEP_DAILY:=7}"
: "${NAS_KEEP_WEEKLY:=4}"
: "${NAS_KEEP_MONTHLY:=6}"
# Limite de banda do rsync em KiB/s (vazio = sem limite).
: "${NAS_BWLIMIT:=}"
# Prefixos do bucket de assets a puxar, separados por espaço ou vírgula (vazio = só os dumps) e se espelha as remoções.
: "${NAS_S3_PREFIXES:=}"
: "${NAS_S3_DELETE:=false}"
# 1 = os dumps vêm da réplica (dump.sh da stack nas-replica); aqui só os assets e o recibo.
: "${NAS_DUMPS_FROM_REPLICA:=0}"

# rotação e nomes dos dumps, compartilhados com o dump.sh da réplica (cópia de infra/nas-backup/nas-lib.sh, na mesma pasta)
# shellcheck source=infra/nas-backup/nas-lib.sh
. "$(dirname "$0")/nas-lib.sh"

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

copied=0
newest=""
if [ "$NAS_DUMPS_FROM_REPLICA" = 1 ]; then
  log info "NAS_DUMPS_FROM_REPLICA=1: os dumps vêm da réplica (dump.sh); só os assets e o recibo"
else
  # 1. Dumps da VPS (só os nomes, em ordem de tempo: o nome leva o horário UTC).
  remote=$(rsync --list-only -e "$pull_ssh" "$VPS_USER@$VPS_HOST:" 2>&1) || fail "listar os dumps da VPS: $remote"
  remote=$(printf '%s\n' "$remote" | awk '{print $NF}' | grep -E "^${DUMP_PREFIX}[0-9]{8}T[0-9]{6}Z\.dump(\.age)?$" | sort || true)
  [ -n "$remote" ] || fail "nenhum dump na VPS"
  newest=$(printf '%s\n' "$remote" | tail -n 1)

  # 2. O mais recente de cada dia, nos últimos NAS_KEEP_DAILY dias com dump na VPS.
  wanted=$(printf '%s\n' "$remote" | awk -v p="$DUMP_PREFIX" '{d=substr($0,length(p)+1,8); last[d]=$0} END {for (d in last) print last[d]}' |
    sort | tail -n "$NAS_KEEP_DAILY")

  for f in $wanted; do
    day=$(day_of "$f")
    # Um dump por dia: o do dia já guardado só é trocado por um mais recente do mesmo dia (o backup roda também na
    # partida do serviço, então a VPS pode ter vários no dia).
    stored=$(dumps_in "$NAS_DIR/daily" | grep "/${DUMP_PREFIX}${day}T" | tail -n 1 || true)
    if [ -n "$stored" ] && [ "$(printf '%s\n%s\n' "$(basename "$stored")" "$f" | sort | tail -n 1)" = "$(basename "$stored")" ]; then
      continue
    fi
    log info "copiando $f${stored:+ (substitui $(basename "$stored"))}"
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
    # weekly/ e monthly/ trocam o hardlink do mesmo período na rotação, abaixo
    [ -z "$stored" ] || rm -f "$stored" "$stored.sha256"
    copied=$((copied + 1))
  done

  # 3. Rotação (nas-lib.sh): weekly/ e monthly/ por hardlink a partir de daily/, e o corte 7/4/6 por contagem.
  rotate_dumps
fi

# 4. Assets: cada prefixo do bucket (espelhado pelo s3-sync.sh da VPS em s3/<prefixo>/ do volume). A chave de leitura só
# enxerga o volume `backups`; o nome do prefixo vira caminho, então só pastas simples (como no s3-sync.sh).
s3_objects=0
s3_list=$(printf '%s\n' "$NAS_S3_PREFIXES" | tr ', \t' '\n\n\n' | sed '/^$/d')
s3_delete=""
[ "$NAS_S3_DELETE" = true ] && s3_delete="--delete"
for p in $s3_list; do
  case "$p" in *..* | /* | */) fail "prefixo inválido em NAS_S3_PREFIXES: $p" ;; esac
  printf '%s' "$p" | grep -q '^[A-Za-z0-9._-]\{1,\}\(/[A-Za-z0-9._-]\{1,\}\)*$' || fail "prefixo inválido em NAS_S3_PREFIXES: $p"
  mkdir -p "$NAS_DIR/s3/$p"
  # shellcheck disable=SC2086 # NAS_BWLIMIT e s3_delete vazios somem de propósito
  rsync -rt --partial ${NAS_BWLIMIT:+--bwlimit=$NAS_BWLIMIT} $s3_delete -e "$pull_ssh" \
    "$VPS_USER@$VPS_HOST:s3/$p/" "$NAS_DIR/s3/$p/" || fail "copiar o prefixo $p do S3 (o s3-sync.sh da VPS já rodou?)"
  s3_objects=$((s3_objects + $(find "$NAS_DIR/s3/$p" -type f | wc -l)))
done

# 5. Recibo: só com o dump mais recente da VPS guardado e conferido (e os assets copiados). Com os dumps vindo da
# réplica, só com os assets copiados (o recibo do dump é outro: .nas_last_dump, do dump.sh).
if [ -n "$newest" ]; then
  [ -f "$NAS_DIR/daily/$newest" ] || fail "o dump mais recente ($newest) não foi guardado"
fi
out=$($receipt_ssh "$VPS_USER@$VPS_HOST" 2>&1) || fail "tocar o recibo na VPS: $out"

if [ -n "$newest" ]; then
  summary="$copied dump(s) novo(s); $(dumps_summary); mais recente na VPS: $newest${NAS_S3_PREFIXES:+; assets: $s3_objects objeto(s)}"
else
  summary="dumps pela réplica (NAS_DUMPS_FROM_REPLICA=1); $(dumps_summary)${NAS_S3_PREFIXES:+; assets: $s3_objects objeto(s)}"
fi
printf '%s ok: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$summary" >"$NAS_DIR/last_run.txt"
log info "cópia do NAS OK: $summary"
