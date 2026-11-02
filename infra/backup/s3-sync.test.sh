#!/usr/bin/env bash
# Teste do s3-sync.sh e da checagem do recibo no backup-check.sh com um `aws` falso no PATH (sem rede, sem Postgres):
# confere os comandos montados, as credenciais de cada lado, o recibo e as falhas. O ciclo com um S3 de verdade
# (RustFS) é o caso 11 do e2e-test.sh (CI).
#
#   bash infra/backup/s3-sync.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
calls="$work/calls.log"

# aws falso: registra "<chave usada> <argumentos>"; `sync s3://… <pasta>` cria um objeto na pasta (como o sync real);
# AWS_FAKE_FAIL=<texto> faz falhar a chamada cujos argumentos contêm o texto.
cat >"$work/bin/aws" <<'FAKE'
#!/bin/sh
echo "key=${AWS_ACCESS_KEY_ID:-} $*" >>"$CALLS"
if [ -n "${AWS_FAKE_FAIL:-}" ] && printf '%s' "$*" | grep -q -- "$AWS_FAKE_FAIL"; then exit 1; fi
while [ $# -gt 0 ]; do
  case "$1" in
  sync)
    shift
    src=""
    dst=""
    for a in "$@"; do case "$a" in --*) ;; *) if [ -z "$src" ]; then src="$a"; else dst="$a"; fi ;; esac; done
    case "$src" in s3://*) mkdir -p "$dst" && echo x >"$dst/objeto.png" ;; esac
    exit 0
    ;;
  esac
  shift
done
FAKE
# psql falso: o registro em ops.job_run é opcional (falha em silêncio), então o teste não depende de um banco
printf '#!/bin/sh\nexit 1\n' >"$work/bin/psql"
chmod +x "$work/bin/aws" "$work/bin/psql"

export PATH="$work/bin:$PATH" CALLS="$calls" BACKUP_LIB="$here/lib.sh" PGDATABASE=galaxie_sports
export S3_ENDPOINT=http://s3:9000 S3_BUCKET=galaxie-sports-assets S3_ACCESS_KEY=chave-rustfs S3_SECRET_KEY=segredo-rustfs
export AWS_ACCESS_KEY_ID=chave-remota AWS_SECRET_ACCESS_KEY=segredo-remoto

fails=0
novo() { # novo: volume limpo e sem chamadas
  rm -rf "$work/backups" "$calls"
  mkdir -p "$work/backups"
  export BACKUP_DIR="$work/backups"
  unset BACKUP_S3_SYNC_PREFIXES BACKUP_S3_SYNC_DIR BACKUP_S3_SYNC_DELETE BACKUP_S3_SYNC_DEST_PREFIX BACKUP_S3_BUCKET \
    BACKUP_S3_ENDPOINT AWS_FAKE_FAIL
  : >"$calls"
}
confere() { # confere <nome> <condição em sh>
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
sync() { sh "$here/s3-sync.sh" >"$work/out.log" 2>&1; }

novo
sync
confere "sem prefixos: nada acontece (sem chamada, sem recibo, sai 0)" '[ ! -s "$calls" ] && [ ! -e "$BACKUP_DIR/.s3_last_sync" ]'

novo
export BACKUP_S3_SYNC_PREFIXES="broadcasters, platforms commons/people" BACKUP_S3_BUCKET=bucket-remoto \
  BACKUP_S3_ENDPOINT=https://remoto.example
sync
confere "sync com sucesso sai 0 e grava o recibo" '[ -s "$BACKUP_DIR/.s3_last_sync" ]'
confere "vírgula, espaço e subprefixo: 3 prefixos copiados do RustFS" \
  '[ "$(grep -c "key=chave-rustfs --endpoint-url http://s3:9000 s3 sync --only-show-errors s3://galaxie-sports-assets/" "$calls")" = 3 ]'
confere "o RustFS usa a chave do RustFS e o remoto, a do remoto" \
  'grep -q "key=chave-remota --endpoint-url https://remoto.example s3 sync" "$calls" && ! grep -q "chave-remota.*s3://galaxie-sports-assets" "$calls"'
confere "destino remoto fora do prefixo dos dumps: assets/<prefixo>/" \
  'grep -q "s3://bucket-remoto/assets/commons/people/" "$calls" && grep -q "s3://bucket-remoto/assets/broadcasters/" "$calls"'
confere "espelho no volume: s3/<prefixo>/" '[ -f "$BACKUP_DIR/s3/broadcasters/objeto.png" ] && [ -f "$BACKUP_DIR/s3/commons/people/objeto.png" ]'
confere "sem --delete por padrão" '! grep -q -- "--delete" "$calls"'
confere "sem o segredo nos argumentos nem no log" '! grep -q "segredo" "$calls" "$work/out.log"'

novo
export BACKUP_S3_SYNC_PREFIXES=broadcasters BACKUP_S3_SYNC_DELETE=true BACKUP_S3_BUCKET=bucket-remoto
sync
confere "BACKUP_S3_SYNC_DELETE=true leva --delete aos dois lados" '[ "$(grep -c -- "--delete" "$calls")" = 2 ]'

novo
export BACKUP_S3_SYNC_PREFIXES=broadcasters BACKUP_S3_BUCKET=bucket-remoto BACKUP_S3_SYNC_DEST_PREFIX=copia
sync
confere "BACKUP_S3_SYNC_DEST_PREFIX: s3://<bucket>/copia/<prefixo>/" 'grep -q "s3://bucket-remoto/copia/broadcasters/" "$calls"'

novo
export BACKUP_S3_SYNC_PREFIXES=broadcasters
sync
confere "sem bucket remoto: só espelha no volume (para o NAS) e ainda grava o recibo" \
  '[ "$(wc -l <"$calls" | tr -d " ")" = 1 ] && [ -s "$BACKUP_DIR/.s3_last_sync" ]'

for ruim in "../fora" "/abs" "pasta/" "com espaco/../x" 'a;b' 'a$(b)'; do
  novo
  export BACKUP_S3_SYNC_PREFIXES="broadcasters $ruim"
  if sync; then r=0; else r=$?; fi
  confere "prefixo inválido ($ruim) falha antes de copiar qualquer prefixo" \
    '[ "$r" != 0 ] && [ ! -e "$BACKUP_DIR/.s3_last_sync" ] && [ ! -s "$calls" ]'
done

novo
export BACKUP_S3_SYNC_PREFIXES=broadcasters BACKUP_S3_BUCKET=bucket-remoto
(unset S3_SECRET_KEY && sh "$here/s3-sync.sh" >"$work/out.log" 2>&1) && r=0 || r=$?
confere "sem as chaves do RustFS falha, sem chamar o aws" '[ "$r" != 0 ] && [ ! -s "$calls" ] && [ ! -e "$BACKUP_DIR/.s3_last_sync" ]'

novo
export BACKUP_S3_SYNC_PREFIXES=broadcasters BACKUP_S3_BUCKET=bucket-remoto AWS_FAKE_FAIL="s3://bucket-remoto"
if sync; then r=0; else r=$?; fi
confere "falha no envio ao remoto: sai com erro e não grava o recibo" '[ "$r" != 0 ] && [ ! -e "$BACKUP_DIR/.s3_last_sync" ]'

# recibo velho não vale: o s3-sync.sh não apaga o anterior, e o verificador olha a idade
novo
export BACKUP_S3_SYNC_PREFIXES=broadcasters AWS_FAKE_FAIL="s3://galaxie-sports-assets"
echo velho >"$BACKUP_DIR/.s3_last_sync"
touch -d '2 days ago' "$BACKUP_DIR/.s3_last_sync"
if sync; then r=0; else r=$?; fi
confere "falha de leitura do RustFS: sai com erro e o recibo antigo continua velho" \
  '[ "$r" != 0 ] && [ "$(find "$BACKUP_DIR/.s3_last_sync" -mmin +2000 | wc -l | tr -d " ")" = 1 ]'

# ── backup-check.sh ────────────────────────────────────────────────────────────────────────────────────────────
check() { sh "$here/backup-check.sh" >"$work/out.log" 2>&1; }
dump_novo() { : >"$BACKUP_DIR/${PGDATABASE}_$(date -u +%Y%m%dT%H%M%SZ).dump"; }

novo
dump_novo
check && r=0 || r=$?
confere "verificador sem o sync ligado: não olha o recibo" '[ "$r" = 0 ]'

novo
dump_novo
export BACKUP_S3_SYNC_PREFIXES=broadcasters
check && r=0 || r=$?
confere "sync ligado e sem recibo: o verificador acusa" '[ "$r" != 0 ] && grep -q "sem recibo do sync do S3" "$work/out.log"'

touch "$BACKUP_DIR/.s3_last_sync"
check && r=0 || r=$?
confere "sync ligado e recibo de agora: o verificador passa" '[ "$r" = 0 ]'

touch -d '2 days ago' "$BACKUP_DIR/.s3_last_sync"
check && r=0 || r=$?
confere "recibo com mais de 26 h: o verificador acusa" '[ "$r" != 0 ] && grep -q "último sync do S3 há" "$work/out.log"'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: s3-sync.sh e a checagem do recibo"
