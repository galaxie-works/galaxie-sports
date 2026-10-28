#!/usr/bin/env bash
# Dump do banco antes do migrate, só quando a versão nova traz migration que o banco ainda não tem. Roda na VPS,
# na pasta da stack, chamado pelo deploy-gh.sh e pelo deploy.sh antes de trocar o compose.yml e o .env:
#
#   ssh $VPS "cd $DIR && bash -s -- <migrations no journal do SHA novo> <rótulo>" < pre-migrate-dump.sh
#
# O rollback automático do deploy recusa voltar a imagem quando há migration nova aplicada (o código antigo pode não
# funcionar com o schema novo). Sem este dump, a única volta era o backup diário, de até 24 h antes. O dump fica no
# volume `backups`, em /backups/pre-migrate/ (fora da rotação dos diários; .dump.age quando os diários são cifrados),
# com o .sha256 ao lado, e é o que o restore.sh do serviço backup lê:
#
#   docker compose exec backup restore.sh --yes pre-migrate/<arquivo>
#
# Saída: 0 = sem migration nova (nada feito) ou dump gravado e conferido (imprime PRE_DUMP=pre-migrate/<arquivo>);
# 1 = não deu para fazer o dump (sem espaço, pg_dump falhou, arquivo ilegível): o deploy para antes de tocar em nada.
# Variáveis: PRE_MIGRATE_KEEP (padrão 3) dumps guardados; PRE_MIGRATE_TIMEOUT_MIN (padrão 30).
set -euo pipefail

want="${1:?informe quantas migrations o journal do SHA novo tem}"
label="${2:-deploy}"
KEEP="${PRE_MIGRATE_KEEP:-3}"
TIMEOUT_MIN="${PRE_MIGRATE_TIMEOUT_MIN:-30}"
case "$want" in '' | *[!0-9]*)
  echo "FAIL  contagem do journal inválida: '$want'"
  exit 1
  ;;
esac
case "$label" in *[!A-Za-z0-9._-]*)
  echo "FAIL  rótulo inválido: '$label'"
  exit 1
  ;;
esac

# todo docker compose com </dev/null: este script chega pela stdin do bash -s, e o docker a consumiria
applied="$(docker compose exec -T postgres sh -c \
  'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from drizzle.__drizzle_migrations"' \
  </dev/null 2>/dev/null || true)"
if [[ "$applied" =~ ^[0-9]+$ ]] && [ "$applied" -ge "$want" ]; then
  echo "pré-migrate: sem migration nova ($applied aplicadas, $want no journal); sem dump"
  exit 0
fi
echo "pré-migrate: ${applied:-?} aplicadas, $want no journal; dump antes do migrate"

# Dentro de um contêiner avulso do serviço backup (o do compose em uso, antes da troca): ele já tem o pg_dump, as
# variáveis PG*, o volume e o lib.sh. O mesmo formato do backup.sh, inclusive a cifragem: com BACKUP_AGE_RECIPIENTS,
# no volume só fica o .dump.age, conferido com a chave do ensaio (que o restore.sh usa para decifrar). O .sha256 leva
# o nome relativo à pasta (o restore.sh confere de dentro dela); só os KEEP mais novos ficam.
inner='set -eu
. /usr/local/lib/galaxie-backup/lib.sh
dir="$BACKUP_DIR/pre-migrate"
mkdir -p "$dir"
# sobra em claro de um deploy interrompido (o clean_plaintext do lib.sh só olha a raiz do volume)
rm -f "$dir"/*.partial
db_bytes=$(psql -X -q -t -A -d "$PGDATABASE" -c "select pg_database_size(current_database())")
free_bytes=$(($(df -Pk "$dir" | awk "NR == 2 { print \$4 }") * 1024))
if [ "$free_bytes" -lt "$((db_bytes / 2))" ]; then
  echo "FAIL  pouco espaço para o dump: $((free_bytes / 1048576)) MB livres, banco com $((db_bytes / 1048576)) MB"
  exit 1
fi
name="${PGDATABASE}_pre-migrate_$(date -u +%Y%m%dT%H%M%SZ)_$1.dump"
plain="$dir/$name.partial"
recipients=""
id=""
trap "rm -f \"\$plain\" \"\${tmp:-}\" \"\$recipients\" \"\$id\"" EXIT
trap "exit 143" TERM
trap "exit 130" INT
fail() {
  echo "FAIL  $1"
  exit 1
}
# imagem de antes da cifragem (sem age_enabled no lib.sh): dump em claro, como os diários dela
if type age_enabled >/dev/null 2>&1 && age_enabled; then
  recipients=$(age_recipients_file) || fail "BACKUP_AGE_RECIPIENTS inválido: use chaves públicas do age (age1…)"
  [ -n "${BACKUP_AGE_IDENTITY:-}" ] || fail "BACKUP_AGE_RECIPIENTS sem BACKUP_AGE_IDENTITY para conferir o dump cifrado"
  name="$name.age"
fi
tmp="$dir/$name.partial"
started=$(date +%s)
pg_dump --format=custom --compress=zstd:5 --no-owner --no-privileges --file="$plain" ||
  fail "pg_dump antes do migrate falhou"
pg_restore --list "$plain" >/dev/null || fail "o dump gerado não é legível pelo pg_restore"
if [ -n "$recipients" ]; then
  age -R "$recipients" -o "$tmp" "$plain" || fail "age não cifrou o dump"
  rm -f "$plain"
  id=$(age_identity_file) || fail "não deu para gravar a chave do ensaio"
  age -d -i "$id" "$tmp" | pg_restore --list >/dev/null ||
    fail "o dump cifrado não decifra com a chave do ensaio (BACKUP_AGE_IDENTITY fora de BACKUP_AGE_RECIPIENTS?)"
fi
mv "$tmp" "$dir/$name"
(cd "$dir" && sha256sum "$name" >"$name.sha256")
echo "pré-migrate: $name ($(($(wc -c <"$dir/$name") / 1048576)) MB, $(($(date +%s) - started)) s)"
dumps() { ls -1 "$dir"/*.dump "$dir"/*.dump.age 2>/dev/null | sort; }
count=$(dumps | wc -l)
if [ "$count" -gt "$2" ]; then
  dumps | head -n "$((count - $2))" | while read -r old; do
    rm -f "$old" "$old.sha256"
    echo "pré-migrate: removido $(basename "$old")"
  done
fi
echo "PRE_DUMP=pre-migrate/$name"'

# a imagem do backup em uso já está na VPS: nada de pull (o deploy não passa credencial do GHCR aqui)
if ! PULL_POLICY=missing timeout "${TIMEOUT_MIN}m" docker compose run --rm --no-deps --pull never -T --entrypoint sh backup -c "$inner" sh "$label" "$KEEP" </dev/null; then
  echo "FAIL  dump antes do migrate não terminou (falhou ou passou de $TIMEOUT_MIN min)"
  exit 1
fi
