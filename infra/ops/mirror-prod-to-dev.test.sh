#!/usr/bin/env bash
# Teste do mirror-prod-to-dev.sh com psql, pg_restore, pg_dump, age e aws falsos no PATH (sem rede, sem Postgres): uma
# pasta faz de cópia do NAS (daily/ e s3/). Confere os argumentos, a conferência do dump, a decifragem, a prévia (que
# não aplica nada), a aplicação (dump do dev, troca pelo nome, assets, recibo), as recusas e as falhas.
#
#   bash infra/ops/mirror-prod-to-dev.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/mirror-prod-to-dev.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
backups="$work/backups"
data="$work/data"
mkdir -p "$work/bin" "$backups/daily" "$backups/s3/acervo" "$backups/s3/tasks-bucket" "$data"
calls="$work/calls.log"
dump=galaxie_sports_20261101T033000Z.dump.age
echo cifrado >"$backups/daily/$dump"
(cd "$backups/daily" && sha256sum "$dump" >"$dump.sha256")
echo svg >"$backups/s3/acervo/a.svg"
echo tgz >"$backups/s3/tasks-bucket/pacote.tgz"

# psql falso: registra "<banco> <argumentos>" e responde o que cada consulta do script espera
cat >"$work/bin/psql" <<'FAKE'
#!/bin/sh
db=""
file=""
prev=""
for a in "$@"; do
  [ "$prev" = -d ] && db="$a"
  [ "$prev" = -f ] && file="$a"
  prev="$a"
done
# printf, não echo: o echo do dash interpreta o \c de "\copy" e corta a linha
printf '%s\n' "psql db=$db $*" >>"$CALLS"
[ -n "$file" ] && { printf '%s\n' "anonimiza db=$db sql=$file" >>"$CALLS"; exit 0; }
all="$*"
case "$all" in
*"select 1 from pg_database where datname = 'galaxie_sports_pre_espelho'"*) [ -z "${PSQL_FAKE_HAS_PREVIOUS:-}" ] || echo 1; exit 0 ;;
*"select 1 from pg_database"*) [ -n "${PSQL_FAKE_NO_DEV:-}" ] || echo 1; exit 0 ;;
*"select column_name from information_schema.columns where table_schema"*)
  case "$all" in
  *"table_name = 'user'"*) printf 'email\nid\nname\n' ;;
  *"table_name = 'account'"*) [ -n "${PSQL_FAKE_NO_ACCOUNT:-}" ] && [ "$db" != "${PGDATABASE}_espelho" ] || printf 'id\nuserId\n' ;;
  *"table_name = 'tenant'"*) printf 'id\noperator_platform_id\nslug\n' ;;
  *"table_name = 'api_key'"*) printf 'id\nprefix\ntenant_id\n' ;;
  *"table_name = 'publishable_key'"*) printf 'id\nkey_hash\ntenant_id\nwidget_id\n' ;;
  esac
  exit 0
  ;;
*"\\copy (select"*)
  csv=$(printf '%s' "$all" | sed -n "s/.* to '\([^']*\)' csv.*/\1/p")
  printf 'a,b,c\nd,e,f\n' >"$csv"
  exit 0
  ;;
*"espelho:colisoes"*) printf '%s\n' "${PSQL_FAKE_COLISOES:-0/0}"; exit 0 ;;
*"espelho_tmp.prod_api_key"*)
  printf 'sessoes_codigos_e_afins=0\ncontas_de_login_reais=0\nusuarios_reais=0\nchaves_api_da_producao=%s\n' "${PSQL_FAKE_SOBRA:-0}"
  printf 'chaves_publicaveis_da_producao=0\nwebhooks=0\nsobrescritas_do_painel=0\npedidos_pendentes=0\nbackfills_pendentes=0\n'
  exit 0
  ;;
*"query_to_xml"*"pg_class"*)
  case "$db" in
  *_espelho) printf 'core.event=120\ncore.participant=40\ndemo_auth.session=0\napi.api_key=1\ndrizzle.__drizzle_migrations=%s\n' "${PSQL_FAKE_MIGRATIONS:-70}" ;;
  *) printf 'core.event=100\ncore.participant=38\ndemo_auth.session=7\napi.api_key=1\ndrizzle.__drizzle_migrations=70\n' ;;
  esac
  exit 0
  ;;
esac
exit 0
FAKE
cat >"$work/bin/pg_restore" <<'FAKE'
#!/bin/sh
echo "pg_restore $*" >>"$CALLS"
case "$*" in *--list*) [ -z "${PG_RESTORE_FAKE_BAD:-}" ] || exit 1; exit 0 ;; esac
[ -z "${PG_RESTORE_FAKE_FAIL:-}" ] || exit 1
exit 0
FAKE
cat >"$work/bin/pg_dump" <<'FAKE'
#!/bin/sh
echo "pg_dump $*" >>"$CALLS"
for a in "$@"; do case "$a" in --file=*) echo dev >"${a#--file=}" ;; esac; done
exit 0
FAKE
# age falso: `age -d -i <chave> -o <saída> <entrada>`; a chave tem de estar num arquivo que existe
cat >"$work/bin/age" <<'FAKE'
#!/bin/sh
echo "age $*" >>"$CALLS"
[ "$1 $2" = "-d -i" ] && [ -f "$3" ] && grep -q "chave-do-ensaio" "$3" || { echo "age falso: chamada inesperada: $*" >&2; exit 1; }
[ -z "${AGE_FAKE_FAIL:-}" ] || exit 1
echo plano >"$5"
FAKE
cat >"$work/bin/redis-cli" <<'FAKE'
#!/bin/sh
printf '%s\n' "redis-cli $*" >>"$CALLS"
[ -z "${REDIS_FAKE_FAIL:-}" ] || exit 1
echo OK
FAKE
cat >"$work/bin/aws" <<'FAKE'
#!/bin/sh
echo "aws key=${AWS_ACCESS_KEY_ID:-} $*" >>"$CALLS"
[ -z "${AWS_FAKE_FAIL:-}" ] || exit 1
exit 0
FAKE
# flock falso: o teste roda uma execução por vez (o Git Bash do Windows não tem flock)
printf '#!/bin/sh\nexit 0\n' >"$work/bin/flock"
chmod +x "$work/bin"/*
export PATH="$work/bin:$PATH" CALLS="$calls"
export PGDATABASE=galaxie_sports ESPELHO_BACKUPS_DIR="$backups" ESPELHO_DIR="$data" ESPELHO_SQL="$here/mirror-prod-to-dev.sql"
export BACKUP_AGE_IDENTITY=chave-do-ensaio-falsa
export S3_ENDPOINT=http://s3:9000 S3_BUCKET=galaxie-sports-assets S3_ACCESS_KEY=chave-dev S3_SECRET_KEY=segredo-dev

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
roda() {
  sh "$script" "$@" >"$work/out.log" 2>&1
  rc=$?
  [ -z "${TEST_VERBOSE:-}" ] || cat "$work/out.log"
  return $rc
}
limpa() {
  rm -rf "$data"
  mkdir -p "$data"
  : >"$calls"
  unset ESPELHO_S3_PREFIXES ESPELHO_S3_DELETE PSQL_FAKE_NO_DEV PSQL_FAKE_NO_ACCOUNT PSQL_FAKE_SOBRA PG_RESTORE_FAKE_BAD \
    PG_RESTORE_FAKE_FAIL AGE_FAKE_FAIL AWS_FAKE_FAIL
  export BACKUP_AGE_IDENTITY=chave-do-ensaio-falsa
}

echo "== argumentos"
limpa
roda --help && r=0 || r=$?
confere "--help sai com 0 e mostra o uso" '[ "$r" = 0 ] && grep -q "uso:" "$work/out.log"'
roda --forcar && r=0 || r=$?
confere "opção desconhecida sai com 2 sem tocar no banco" '[ "$r" = 2 ] && ! grep -q "create database" "$calls"'

echo "== prévia"
limpa
export ESPELHO_S3_PREFIXES="acervo"
roda --plan && r=0 || r=$?
confere "a prévia termina OK" '[ "$r" = 0 ]'
confere "decifra com a chave do ensaio num arquivo temporário e confere o dump" \
  'grep -q "^age -d -i $data/tmp/" "$calls" && grep -q "pg_restore --list" "$calls" && [ -z "$(ls -A "$data/tmp")" ]'
confere "restaura no banco temporário, não no dev" \
  'grep -q "pg_restore --no-owner --no-privileges --exit-on-error --jobs=2 -d galaxie_sports_espelho" "$calls" && ! grep -q "pg_restore .* -d galaxie_sports " "$calls"'
confere "anonimiza no temporário com a SQL do repositório e o sufixo das contas de teste" \
  'grep -q "anonimiza db=galaxie_sports_espelho sql=$ESPELHO_SQL" "$calls" && grep -q "suffix=@galaxie.test" "$calls"'
confere "preserva do dev as contas de teste, os tenants e as chaves do dev" \
  'grep -q "copy (select \"email\",\"id\",\"name\" from demo_auth.\"user\" where email like .%@galaxie.test" "$calls" &&
   grep -q "insert into api.\"tenant\"" "$calls" && grep -q "insert into api.\"api_key\"" "$calls" && grep -q "insert into ops.\"publishable_key\"" "$calls" &&
   grep -q "insert into demo_auth.\"account\"" "$calls"'
confere "a conferência não conta as chaves do dev como sobra da produção" \
  'grep -q "prefix not in (select prefix from espelho_tmp.dev_api_key)" "$calls" &&
   grep -q "key_hash not in (select key_hash from espelho_tmp.dev_publishable_key)" "$calls" &&
   grep -q "insert into espelho_tmp.dev_api_key select prefix from espelho_tmp.api_key" "$calls" &&
   ! grep -q "AVISO: chave(s) do dev" "$work/out.log"'
confere "imprime as contagens por tabela, dev de hoje × cópia" \
  'grep -q "core.event *100 *120" "$work/out.log" && grep -q "demo_auth.session *7 *0" "$work/out.log"'
confere "apaga o temporário e não aplica: sem dump do dev, sem rename, sem aws" \
  'grep -q "drop database if exists \"galaxie_sports_espelho\" with (force)" "$calls" && ! grep -q "pg_dump" "$calls" &&
   ! grep -q "rename to" "$calls" && ! grep -q "^aws" "$calls"'
confere "a prévia deixa last_plan.txt e não toca em last_run.txt" \
  'grep -q "prévia: dump $dump" "$data/last_plan.txt" && grep -q "core.event=120" "$data/last_plan.txt" && [ ! -f "$data/last_run.txt" ]'

echo "== prévia com chave do dev que a produção também tem"
limpa
PSQL_FAKE_COLISOES=1/0 roda --plan && r=0 || r=$?
confere "a chave do dev não barra o espelho e sai como aviso" \
  '[ "$r" = 0 ] && grep -q "AVISO: chave(s) do dev que a produção também tem ou teve (api/publicável: 1/0)" "$work/out.log"'

echo "== aplicação"
limpa
export ESPELHO_S3_PREFIXES="acervo"
roda && r=0 || r=$?
confere "a aplicação termina OK" '[ "$r" = 0 ]'
confere "dump do dev antes da troca, com .sha256, em dev-dumps/" \
  'ls "$data"/dev-dumps/galaxie_sports_dev_*.dump >/dev/null && ls "$data"/dev-dumps/galaxie_sports_dev_*.dump.sha256 >/dev/null'
confere "troca pelo nome: fecha e derruba as conexões do dev, guarda o anterior, promove a cópia" \
  'grep -q "allow_connections false" "$calls" && grep -q "pg_terminate_backend" "$calls" &&
   grep -q "alter database \"galaxie_sports\" rename to \"galaxie_sports_pre_espelho\"" "$calls" &&
   grep -q "alter database \"galaxie_sports_espelho\" rename to \"galaxie_sports\"" "$calls"'
confere "o dump do dev vem antes da troca" \
  '[ "$(grep -n "^pg_dump" "$calls" | head -1 | cut -d: -f1)" -lt "$(grep -n "rename to" "$calls" | head -1 | cut -d: -f1)" ]'
confere "assets: o prefixo vai da cópia do NAS para o bucket do dev, com as chaves do RustFS do dev e sem --delete" \
  'grep -q "aws key=chave-dev --endpoint-url http://s3:9000 s3 sync --only-show-errors $backups/s3/acervo/ s3://galaxie-sports-assets/acervo/" "$calls"'
confere "depois da troca, o Valkey do dev é esvaziado (cache de respostas do banco antigo)" \
  '[ "$(grep -n "^redis-cli -h valkey -p 6379 flushall" "$calls" | head -1 | cut -d: -f1)" -gt "$(grep -n "rename to \"galaxie_sports\"" "$calls" | head -1 | cut -d: -f1)" ]'
confere "o recibo sai com o dump, as contagens, a conferência e os assets" \
  'grep -q "ok: dump $dump" "$data/last_run.txt" && grep -q "core.participant=40" "$data/last_run.txt" &&
   grep -q "sessoes_codigos_e_afins=0" "$data/last_run.txt" && grep -q "assets: 1 objeto" "$data/last_run.txt" &&
   grep -q "galaxie_sports_pre_espelho" "$data/last_run.txt"'
confere "nada em claro sobra na pasta temporária" '[ -z "$(ls -A "$data/tmp")" ]'
confere "sem rollback anterior: nada a guardar, e o _old é apagado no fim"   '! grep -q "rename to \"galaxie_sports_pre_espelho_old\"" "$calls" && grep -q "drop database if exists \"galaxie_sports_pre_espelho_old\"" "$calls"'

limpa
export PSQL_FAKE_HAS_PREVIOUS=1
roda && r=0 || r=$?
confere "o rollback anterior vira _old antes da troca e só é apagado depois dela"   '[ "$r" = 0 ] && [ "$(grep -n "rename to \"galaxie_sports_pre_espelho_old\"" "$calls" | head -1 | cut -d: -f1)" -lt "$(grep -n "rename to \"galaxie_sports\"" "$calls" | head -1 | cut -d: -f1)" ] &&
   [ "$(grep -n "drop database if exists \"galaxie_sports_pre_espelho_old\"" "$calls" | tail -1 | cut -d: -f1)" -gt "$(grep -n "rename to \"galaxie_sports\"" "$calls" | head -1 | cut -d: -f1)" ]'
unset PSQL_FAKE_HAS_PREVIOUS

limpa
export REDIS_FAKE_FAIL=1
roda && r=0 || r=$?
confere "Valkey fora do ar só avisa (o banco já está trocado)" '[ "$r" = 0 ] && grep -q "ok: dump" "$data/last_run.txt" && grep -q "Valkey" "$work/out.log"'

limpa
export ESPELHO_S3_DELETE=true ESPELHO_S3_PREFIXES="acervo"
roda && r=0 || r=$?
confere "ESPELHO_S3_DELETE=true leva --delete ao aws" '[ "$r" = 0 ] && grep -q "sync --only-show-errors --delete" "$calls"'

limpa
roda && r=0 || r=$?
confere "sem ESPELHO_S3_PREFIXES: só o banco, e o recibo sai sem assets" '[ "$r" = 0 ] && ! grep -q "^aws" "$calls" && ! grep -q "assets:" "$data/last_run.txt"'

limpa
export PSQL_FAKE_NO_DEV=1
roda && r=0 || r=$?
confere "dev sem o banco ainda: cria sem preservar nada e sem dump prévio" \
  '[ "$r" = 0 ] && ! grep -q "pg_dump" "$calls" && ! grep -q "insert into" "$calls" && grep -q "rename to \"galaxie_sports\"" "$calls"'

limpa
export PSQL_FAKE_NO_ACCOUNT=1
roda --plan && r=0 || r=$?
confere "tabela que o dev não tem só avisa" '[ "$r" = 0 ] && grep -q "sem demo_auth.account" "$work/out.log" && ! grep -q "insert into demo_auth.\"account\"" "$calls"'

limpa
export PSQL_FAKE_MIGRATIONS=68
roda --plan && r=0 || r=$?
confere "cópia com menos migrations que o dev: aviso na prévia e no recibo (rodar o migrate depois)" \
  '[ "$r" = 0 ] && grep -q "2 migration(s) a menos" "$data/last_plan.txt" && grep -q "db:migrate" "$work/out.log"'

echo "== recusas e falhas"
limpa
export ESPELHO_S3_PREFIXES="acervo tasks-bucket"
roda --plan && r=0 || r=$?
confere "tasks-bucket (bucket privado, uploads de cliente) é recusado antes de mexer no banco" \
  '[ "$r" != 0 ] && grep -q "bucket privado" "$data/last_plan.txt" && ! grep -q "create database" "$calls"'

limpa
export ESPELHO_S3_PREFIXES="acervo ../fora"
roda --plan && r=0 || r=$?
confere "prefixo inválido é recusado" '[ "$r" != 0 ] && grep -q "prefixo inválido" "$data/last_plan.txt"'

limpa
export ESPELHO_S3_PREFIXES="acervo ausente"
roda --plan && r=0 || r=$?
confere "prefixo sem objeto na cópia do NAS é recusado antes do banco" \
  '[ "$r" != 0 ] && grep -q "ausente" "$data/last_plan.txt" && ! grep -q "create database" "$calls"'

limpa
unset BACKUP_AGE_IDENTITY
roda --plan && r=0 || r=$?
confere "dump cifrado sem a chave do ensaio falha antes do banco" \
  '[ "$r" != 0 ] && grep -q "BACKUP_AGE_IDENTITY" "$data/last_plan.txt" && ! grep -q "create database" "$calls"'

limpa
export AGE_FAKE_FAIL=1
roda --plan && r=0 || r=$?
confere "dump que não decifra falha e não deixa sobra" '[ "$r" != 0 ] && grep -q "decifrar" "$data/last_plan.txt" && [ -z "$(ls -A "$data/tmp")" ]'

limpa
echo outro >"$backups/daily/$dump"
roda --plan && r=0 || r=$?
confere "sha256 que não confere falha antes de decifrar" '[ "$r" != 0 ] && grep -q "sha256" "$data/last_plan.txt" && ! grep -q "^age" "$calls"'
echo cifrado >"$backups/daily/$dump"

limpa
rm "$backups/daily/$dump.sha256"
roda --plan && r=0 || r=$?
confere "sem o .sha256 falha" '[ "$r" != 0 ] && grep -q "sha256" "$data/last_plan.txt"'
(cd "$backups/daily" && sha256sum "$dump" >"$dump.sha256")

limpa
export PG_RESTORE_FAKE_FAIL=1
roda && r=0 || r=$?
confere "pg_restore que falha apaga o temporário e deixa o dev intacto" \
  '[ "$r" != 0 ] && grep -q "pg_restore falhou" "$data/last_run.txt" && ! grep -q "rename to" "$calls" &&
   [ "$(grep -c "drop database if exists \"galaxie_sports_espelho\"" "$calls")" = 2 ]'

limpa
export PSQL_FAKE_SOBRA=2
roda && r=0 || r=$?
confere "sobra da produção na conferência barra a troca e apaga o temporário" \
  '[ "$r" != 0 ] && grep -q "chaves_api_da_producao=2" "$data/last_run.txt" && ! grep -q "rename to" "$calls" && ! grep -q "pg_dump" "$calls"'

limpa
export ESPELHO_S3_PREFIXES="acervo" AWS_FAKE_FAIL=1
roda && r=0 || r=$?
confere "aws que falha depois da troca registra erro no recibo (banco já trocado)" \
  '[ "$r" != 0 ] && grep -q "banco já trocado" "$data/last_run.txt" && grep -q "rename to \"galaxie_sports\"" "$calls"'

limpa
mv "$backups/daily" "$backups/daily.off"
roda --plan && r=0 || r=$?
confere "sem dump nenhum falha com a dica do nas-pull.sh" '[ "$r" != 0 ] && grep -q "nas-pull" "$data/last_plan.txt"'
mv "$backups/daily.off" "$backups/daily"

limpa
roda --plan --dump "$dump" && r=0 || r=$?
confere "--dump <nome> usa o arquivo de daily/" '[ "$r" = 0 ] && grep -q "age -d -i .* $backups/daily/$dump" "$calls"'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: mirror-prod-to-dev.sh"
