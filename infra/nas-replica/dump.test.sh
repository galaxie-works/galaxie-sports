#!/usr/bin/env bash
# Teste do dump.sh com psql, pg_dump, pg_restore, ssh, age e rclone falsos: as paradas (réplica promovida, atrasada,
# slot perdido, recibo antigo na VPS), o dump diário e o pré-migrate, o replay pausado à mão, o pedido do deploy
# (--pedido), a cifragem e a cópia fora de casa. Precisa de GNU date e coreutils (como no contêiner do NAS e no CI).
#
#   bash infra/nas-replica/dump.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
nas="$work/nas"
vps="$work/vps"
remote="$work/remote"
mkdir -p "$work/bin" "$nas/ssh" "$vps" "$remote"
cp "$here/../nas-backup/nas-lib.sh" "$nas/nas-lib.sh"
: >"$nas/ssh/receipt_ed25519"
: >"$nas/ssh/known_hosts"

# psql falso: responde conforme a consulta; -h tunnel é a produção. Variáveis do teste: RECOVERY (t/f), PAUSED (t/f),
# RESUME_FAILS=1, LAG_MB, SLOT ("t reserved" | "t lost" | ""), PRIMARY_DOWN=1 (a produção não responde)
cat >"$work/bin/psql" <<'FAKE'
#!/bin/sh
sql=""
host=""
while [ $# -gt 0 ]; do
  case "$1" in
  -c) sql="$2"; shift 2 ;;
  -h) host="$2"; shift 2 ;;
  -d | -p | -U | -v) shift 2 ;;
  *) shift ;;
  esac
done
echo "psql ${host:-replica}: $sql" >>"$CALLS"
if [ "$host" = tunnel ]; then
  [ -n "${PRIMARY_DOWN:-}" ] && exit 2
  case "$sql" in
  *pg_current_wal_lsn*) echo "0/5000000" ;;
  *pg_replication_slots*) echo "${SLOT-t reserved}" ;;
  esac
  exit 0
fi
case "$sql" in
*pg_is_in_recovery*) echo "${RECOVERY:-t}" ;;
*pg_is_wal_replay_paused*) echo "${PAUSED:-f}" ;;
*pg_wal_replay_resume*) [ -n "${RESUME_FAILS:-}" ] && exit 1; echo "" ;;
*pg_wal_lsn_diff*) echo "${LAG_MB:-3}" ;;
*pg_last_wal_replay_lsn* | *pg_last_wal_receive_lsn*) echo "0/4FF0000" ;;
*pg_last_xact_replay_timestamp*) echo "2026-01-01 03:29:00+00" ;;
*) echo "" ;;
esac
FAKE
# pg_dump escreve no --file; pg_restore --list aceita tudo; pg_isready ok
cat >"$work/bin/pg_dump" <<'FAKE'
#!/bin/sh
echo "pg_dump $*" >>"$CALLS"
for a in "$@"; do case "$a" in --file=*) printf 'conteudo-do-dump-%s\n' "$(date +%s%N)" >"${a#--file=}" ;; esac; done
FAKE
printf '#!/bin/sh\necho "pg_restore $*" >>"$CALLS"\n' >"$work/bin/pg_restore"
printf '#!/bin/sh\nexit 0\n' >"$work/bin/pg_isready"
# ssh falso: o comando forçado da VPS (galaxie-nas-receipt: pull, dump, pedido). Com SSH_OLD=1 é o comando antigo (só
# toca .nas_last_pull); PEDIDO="<quando> <rótulo>" é um pedido pendente na VPS
cat >"$work/bin/ssh" <<'FAKE'
#!/bin/sh
cmd=""
for a in "$@"; do cmd="$a"; done
echo "ssh $cmd" >>"$CALLS"
if [ -n "${SSH_OLD:-}" ]; then touch "$VPS/.nas_last_pull"; exit 0; fi
set -- $cmd
case "$1" in
dump)
  printf '%s %s %s\n' "$2" "$3" "$4" >"$VPS/.nas_last_dump"
  rm -f "$VPS/.nas_dump_request"
  echo "recibo dump ok"
  ;;
pedido)
  [ -f "$VPS/.nas_dump_request" ] && echo "pedido $(cat "$VPS/.nas_dump_request")"
  echo "recibo pedido ok"
  ;;
*) echo "recibo: comando desconhecido"; exit 1 ;;
esac
FAKE
# age falso: "cifra" copiando; rclone falso: copyto/lsf/deletefile numa pasta
cat >"$work/bin/age" <<'FAKE'
#!/bin/sh
echo "age $*" >>"$CALLS"
out=""; in=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -R) shift 2 ;; *) in="$1"; shift ;; esac; done
cp "$in" "$out"
FAKE
cat >"$work/bin/rclone" <<'FAKE'
#!/bin/sh
echo "rclone $*" >>"$CALLS"
op="$1"; shift
args=""
for a in "$@"; do case "$a" in --*) ;; *) args="$args $a" ;; esac; done
set -- $args
case "$op" in
copyto) cp "$1" "$REMOTE/${2#*/}" ;;
lsf) ls -1 "$REMOTE" ;;
deletefile) rm -f "$REMOTE/${1#*/}" ;;
esac
FAKE
# flock falso: o teste roda uma execução por vez (o Git Bash do Windows não tem flock)
printf '#!/bin/sh\nexit 0\n' >"$work/bin/flock"
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH" CALLS="$work/calls.log" VPS="$vps" REMOTE="$remote" \
  NAS_DIR="$nas" PGDATABASE=galaxie_sports VPS_HOST=vps.example REPLICATOR_PASSWORD=x DUMP_PREFIX=galaxie_sports_

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
dump() { sh "$here/dump.sh" "$@" >"$work/out.log" 2>&1; }
limpa() {
  rm -rf "$nas/daily" "$nas/weekly" "$nas/monthly" "$nas/pre-migrate" "$nas/incoming" "$nas/last_dump.txt" "$vps/.nas_last_dump" "$vps/.nas_dump_request" "$remote"
  mkdir -p "$remote"
  : >"$CALLS"
  unset RECOVERY PAUSED RESUME_FAILS LAG_MB SLOT PRIMARY_DOWN SSH_OLD DUMP_AGE_RECIPIENTS OFFSITE_RCLONE_REMOTE OFFSITE_ALLOW_PLAINTEXT
}
n_daily() { ls -1 "$nas/daily/"*.dump 2>/dev/null | wc -l; }

limpa
dump && r=0 || r=$?
confere "dump diário em daily/ com .sha256, sem sobra em incoming/" '[ "$r" = 0 ] && [ "$(n_daily)" = 1 ] && [ -f "$(ls "$nas"/daily/*.dump).sha256" ] && [ -z "$(ls "$nas/incoming")" ]'
confere "sem pausar o replay (o papel de backup não é superusuário)" '! grep -q "pg_wal_replay_pause\|pg_wal_replay_resume" "$CALLS"'
confere "pg_dump no formato do backup da VPS" 'grep -q -- "--format=custom --compress=zstd:5 --no-owner --no-privileges --exclude-table-data=enrich.related_content" "$CALLS"'
confere "recibo na VPS com quando, bytes e arquivo" 'read -r q b f <"$vps/.nas_last_dump" && [ "$b" -gt 0 ] && [ "$f" = "$(basename "$(ls "$nas"/daily/*.dump)")" ] && case "$q" in 20*T*Z) true ;; *) false ;; esac'
confere "last_dump.txt ok, sem cópia fora de casa" 'grep -q " ok: daily " "$nas/last_dump.txt" && ! grep -q rclone "$CALLS"'

# o dump do mesmo dia que o nas-pull.sh trouxe da VPS fica como está (a trava é a mesma; a rotação cuida)
echo da-vps >"$nas/daily/galaxie_sports_$(date -u +%Y%m%d)T000000Z.dump" && : >"$nas/daily/galaxie_sports_$(date -u +%Y%m%d)T000000Z.dump.sha256"
sleep 1
dump
confere "dump do mesmo dia trazido da VPS fica (dois em daily/)" '[ "$(n_daily)" = 3 ] && [ -f "$nas/daily/galaxie_sports_$(date -u +%Y%m%d)T000000Z.dump" ]'

dump pre-migrate abc1234-def5678
confere "pre-migrate vai para pre-migrate/, fora de daily/" '[ "$(ls -1 "$nas/pre-migrate/"*pre-migrate_*_abc1234-def5678.dump | wc -l)" = 1 ] && [ "$(n_daily)" = 3 ]'
sleep 1; dump pre-migrate b; sleep 1; dump pre-migrate c
confere "pre-migrate guarda só PRE_MIGRATE_KEEP (2)" '[ "$(ls -1 "$nas/pre-migrate/"*.dump | wc -l)" = 2 ] && [ -z "$(ls "$nas/pre-migrate/" | grep abc1234)" ]'
confere "rótulo inválido é recusado" '! sh "$here/dump.sh" pre-migrate "x y" >/dev/null 2>&1'

: >"$CALLS"
dump --se-velho && r=0 || r=$?
confere "--se-velho com dump recente não faz nada" '[ "$r" = 0 ] && ! grep -q "pg_dump " "$CALLS"'

# o pedido do deploy (nas-dump-check.sh com DUMP_MODE=nas): --pedido a cada minuto
: >"$CALLS"
dump --pedido && r=0 || r=$?
confere "--pedido sem pedido pendente: consulta a VPS e não dumpa" '[ "$r" = 0 ] && grep -q "ssh pedido" "$CALLS" && ! grep -q "pg_dump " "$CALLS"'
printf '2026-11-17T04:00:00Z gha-123-abc1234-def5678\n' >"$vps/.nas_dump_request"
sleep 1
dump --pedido && r=0 || r=$?
confere "--pedido com pedido: dump pre-migrate com o rótulo do deploy, recibo tocado e pedido apagado" \
  '[ "$r" = 0 ] && [ -f "$(ls "$nas/pre-migrate/"*_gha-123-abc1234-def5678.dump)" ] && grep -q "_gha-123-abc1234-def5678.dump" "$vps/.nas_last_dump" && [ ! -f "$vps/.nas_dump_request" ]'
printf 'ontem rm -rf /\n' >"$vps/.nas_dump_request"
: >"$CALLS"
dump --pedido && r=0 || r=$?
confere "--pedido malformado é ignorado" '[ "$r" = 0 ] && ! grep -q "pg_dump " "$CALLS"'
rm -f "$vps/.nas_dump_request"

limpa
export PAUSED=t
dump && r=0 || r=$?
confere "replay pausado à mão: retomado antes do dump, com aviso" '[ "$r" = 0 ] && grep -q "pg_wal_replay_resume" "$CALLS" && grep -q "retomado antes do dump" "$work/out.log"'
limpa
export PAUSED=t RESUME_FAILS=1
dump && r=0 || r=$?
confere "replay pausado e sem permissão para retomar: dump sai com o aviso do superusuário" '[ "$r" = 0 ] && grep -q "como superusuário na réplica" "$work/out.log"'

limpa
export RECOVERY=f
dump && r=0 || r=$?
confere "réplica fora da recuperação (promovida): falha sem dump" '[ "$r" != 0 ] && [ "$(n_daily)" = 0 ] && ! grep -q "pg_dump " "$CALLS" && grep -q "NÃO está em recuperação" "$nas/last_dump.txt"'

limpa
export LAG_MB=999
dump && r=0 || r=$?
confere "réplica atrasada além de DUMP_MAX_LAG_MB: falha com o atraso no motivo" '[ "$r" != 0 ] && [ "$(n_daily)" = 0 ] && grep -q "999 MB de WAL" "$nas/last_dump.txt"'

limpa
export SLOT="f lost"
dump && r=0 || r=$?
confere "slot perdido na produção: falha e manda refazer a réplica" '[ "$r" != 0 ] && [ "$(n_daily)" = 0 ] && grep -q "wal_status=lost" "$nas/last_dump.txt"'

limpa
export PRIMARY_DOWN=1
dump && r=0 || r=$?
confere "sem a produção pelo túnel: dump sai pelo atraso que a réplica sabe, com aviso" '[ "$r" = 0 ] && [ "$(n_daily)" = 1 ] && grep -q "sem acesso à produção" "$work/out.log"'

limpa
export SSH_OLD=1
dump && r=0 || r=$?
confere "VPS com o comando antigo do recibo: falha, o dump fica e manda rodar preparar-replica.sh" \
  '[ "$r" != 0 ] && [ "$(n_daily)" = 1 ] && [ ! -f "$vps/.nas_last_dump" ] && grep -q "preparar-replica.sh" "$nas/last_dump.txt"'

limpa
export OFFSITE_RCLONE_REMOTE=r2:galaxie-dumps
dump && r=0 || r=$?
confere "cópia fora de casa com dump em claro é recusada (dump e recibo feitos)" '[ "$r" != 0 ] && [ -f "$vps/.nas_last_dump" ] && ! grep -q "rclone copyto" "$CALLS" && grep -q "só vai cifrada" "$nas/last_dump.txt"'

limpa
export OFFSITE_RCLONE_REMOTE=r2:galaxie-dumps OFFSITE_KEEP=2
chave_age="age1$(printf 'q%.0s' $(seq 58))" # uma chave pública do age de faz de conta, no formato certo (age1 + 58)
export DUMP_AGE_RECIPIENTS="$chave_age"
dump && r=0 || r=$?
confere "com DUMP_AGE_RECIPIENTS o dump sai .dump.age e vai para o remoto com o .sha256" \
  '[ "$r" = 0 ] && [ "$(ls -1 "$nas"/daily/*.dump.age | wc -l)" = 1 ] && [ -z "$(ls "$nas/incoming")" ] && [ "$(ls -1 "$remote" | wc -l)" = 2 ] && grep -q "age -R" "$CALLS"'
sleep 1; dump; sleep 1; dump pre-migrate x
confere "o remoto fica só com os OFFSITE_KEEP (2) dumps mais novos" '[ "$(ls -1 "$remote"/*.dump.age | wc -l)" = 2 ] && [ "$(ls -1 "$remote" | wc -l)" = 4 ]'
unset OFFSITE_KEEP

limpa
export DUMP_AGE_RECIPIENTS="nao-e-chave"
dump && r=0 || r=$?
confere "DUMP_AGE_RECIPIENTS inválido: falha antes do pg_dump" '[ "$r" != 0 ] && ! grep -q "pg_dump " "$CALLS"'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: dump.sh da réplica do NAS"
