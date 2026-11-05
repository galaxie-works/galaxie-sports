#!/usr/bin/env bash
# Teste do nas-pull.sh com rsync e ssh falsos (uma pasta faz de volume `backups` da VPS): dumps, assets do S3
# (NAS_S3_PREFIXES) e o recibo, que só sai com tudo copiado. Precisa de GNU date (como no contêiner do NAS).
#
#   bash infra/nas-backup/nas-pull.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
vps="$work/vps"
nas="$work/nas"
mkdir -p "$work/bin" "$vps/s3/broadcasters" "$vps/s3/commons/people" "$nas/ssh"
dump=galaxie_sports_20260101T033000Z.dump
echo dump >"$vps/$dump"
(cd "$vps" && sha256sum "$dump" >"$dump.sha256")
echo svg >"$vps/s3/broadcasters/a.svg"
echo jpg >"$vps/s3/commons/people/q.jpg"

# rsync falso: --list-only lista a pasta da VPS; o resto copia "usuario@host:<caminho relativo>" (ou a pasta) para o destino
cat >"$work/bin/rsync" <<'FAKE'
#!/bin/sh
echo "$*" >>"$CALLS"
args=""
for a in "$@"; do args="$args $a"; done
case " $args " in *" --list-only "*) (cd "$VPS" && ls -1 | sed 's/^/-rw-r--r-- 1 x /'); exit 0 ;; esac
srcs=""
dst=""
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in -e) skip=1 ;; -*) ;; *@*:*) srcs="$srcs ${a#*:}" ;; *) dst="$a" ;; esac
done
[ -n "${RSYNC_FAIL:-}" ] && case "$srcs" in *"$RSYNC_FAIL"*) exit 23 ;; esac
for s in $srcs; do
  case "$s" in
  */) [ -d "$VPS/$s" ] || exit 23; cp -R "$VPS/$s." "$dst" ;;
  *) cp "$VPS/$s" "$dst" ;;
  esac
done
FAKE
# ssh falso: é o do recibo (único uso sem rsync); registra e toca o recibo na pasta da VPS
cat >"$work/bin/ssh" <<'FAKE'
#!/bin/sh
echo "ssh $*" >>"$CALLS"
touch "$VPS/.nas_last_pull"
FAKE
# flock falso: o teste roda uma execução por vez (o Git Bash do Windows não tem flock)
printf '#!/bin/sh
exit 0
' >"$work/bin/flock"
chmod +x "$work/bin/rsync" "$work/bin/ssh" "$work/bin/flock"
export PATH="$work/bin:$PATH" VPS="$vps" CALLS="$work/calls.log" NAS_DIR="$nas" VPS_HOST=vps.example VPS_USER=root

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
pull() { sh "$here/nas-pull.sh" >"$work/out.log" 2>&1; }
limpa() { rm -rf "$nas/s3" "$nas/daily" "$nas/weekly" "$nas/monthly" "$nas/last_run.txt" "$vps/.nas_last_pull"; : >"$CALLS"; }

limpa
unset NAS_S3_PREFIXES NAS_S3_DELETE RSYNC_FAIL
pull
confere "sem NAS_S3_PREFIXES: só os dumps, e o recibo sai" '[ -f "$nas/daily/$dump" ] && [ ! -d "$nas/s3" ] && [ -f "$vps/.nas_last_pull" ]'

limpa
export NAS_S3_PREFIXES="broadcasters, commons/people"
pull
confere "com prefixos: o NAS recebe s3/<prefixo>/" '[ -f "$nas/s3/broadcasters/a.svg" ] && [ -f "$nas/s3/commons/people/q.jpg" ]'
confere "o recibo sai depois dos assets" '[ -f "$vps/.nas_last_pull" ] && grep -q "assets: 2 objeto" "$nas/last_run.txt"'
confere "sem --delete por padrão" '! grep -q -- "--delete" "$CALLS"'

# o objeto que some da VPS fica no NAS (sem --delete)
rm "$vps/s3/broadcasters/a.svg"
pull
confere "objeto removido na VPS continua no NAS" '[ -f "$nas/s3/broadcasters/a.svg" ]'
echo svg >"$vps/s3/broadcasters/a.svg"

limpa
export NAS_S3_DELETE=true
pull
confere "NAS_S3_DELETE=true leva --delete ao rsync dos assets" 'grep -q -- "--delete" "$CALLS"'
unset NAS_S3_DELETE

limpa
export NAS_S3_PREFIXES="broadcasters ../fora"
pull && r=0 || r=$?
confere "prefixo inválido falha sem tocar o recibo" '[ "$r" != 0 ] && [ ! -f "$vps/.nas_last_pull" ] && grep -q "prefixo inválido" "$nas/last_run.txt"'

limpa
export NAS_S3_PREFIXES="broadcasters ausente" RSYNC_FAIL="s3/ausente"
pull && r=0 || r=$?
confere "prefixo que o s3-sync.sh da VPS ainda não criou falha e deixa o recibo sem tocar" \
  '[ "$r" != 0 ] && [ ! -f "$vps/.nas_last_pull" ] && grep -q "ausente" "$nas/last_run.txt"'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: nas-pull.sh com assets do S3"
