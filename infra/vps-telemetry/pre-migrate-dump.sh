#!/usr/bin/env bash
# Dump do banco antes do migrate, só quando a versão nova traz migration que o banco ainda não tem. Roda na VPS,
# na pasta da stack, chamado pelo deploy-gh.sh e pelo deploy.sh antes de trocar o compose.yml e o .env:
#
#   ssh $VPS "cd $DIR && bash -s -- <migrations no journal do SHA novo> <rótulo>" < pre-migrate-dump.sh
#
# O rollback automático do deploy recusa voltar a imagem quando há migration nova aplicada (o código antigo pode não
# funcionar com o schema novo). Sem este dump, a única volta era o backup diário, de até 24 h antes. Com ele, voltar
# é restaurar backups/pre-migrate-*.dump (infra/backup/restore.sh) e subir a versão anterior.
#
# Saída: 0 = sem migration nova (nada feito) ou dump gravado e conferido (imprime PRE_DUMP=<arquivo>); 1 = não deu
# para fazer o dump (sem espaço, pg_dump falhou, arquivo ilegível): o deploy para antes de tocar em qualquer coisa.
# Variáveis: PRE_MIGRATE_KEEP (padrão 3) dumps pre-migrate-* guardados; PRE_MIGRATE_TIMEOUT_MIN (padrão 30).
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

# todo docker compose exec com </dev/null: este script chega pela stdin do bash -s, e o exec a consumiria
psql_value() {
  docker compose exec -T postgres sh -c "psql -X -q -t -A -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"$1\"" </dev/null
}

applied="$(psql_value 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || true)"
if [[ "$applied" =~ ^[0-9]+$ ]] && [ "$applied" -ge "$want" ]; then
  echo "pré-migrate: sem migration nova ($applied aplicadas, $want no journal); sem dump"
  exit 0
fi
echo "pré-migrate: ${applied:-?} aplicadas, $want no journal; dump antes do migrate"

mkdir -p backups
# espaço: o dump comprimido fica bem abaixo do tamanho do banco; exige metade dele livre, com folga
db_bytes="$(psql_value 'select pg_database_size(current_database())' 2>/dev/null || true)"
free_bytes="$(($(df -Pk backups | awk 'NR == 2 { print $4 }') * 1024))"
if [[ "$db_bytes" =~ ^[0-9]+$ ]] && [ "$free_bytes" -lt "$((db_bytes / 2))" ]; then
  echo "FAIL  pouco espaço para o dump: $((free_bytes / 1048576)) MB livres, banco com $((db_bytes / 1048576)) MB"
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="backups/pre-migrate-$stamp-$label.dump"
tmp="$file.partial"
started="$(date +%s)"
if ! timeout "${TIMEOUT_MIN}m" docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=zstd:5 --no-owner --no-privileges' \
  </dev/null >"$tmp"; then
  rm -f "$tmp"
  echo "FAIL  pg_dump antes do migrate falhou (ou passou de $TIMEOUT_MIN min)"
  exit 1
fi
# um dump que o pg_restore não lista não é backup
if ! docker compose exec -T postgres pg_restore --list <"$tmp" >/dev/null; then
  rm -f "$tmp"
  echo "FAIL  o dump gerado não é legível pelo pg_restore"
  exit 1
fi
mv "$tmp" "$file"
sha256sum "$file" >"$file.sha256"
echo "pré-migrate: $(basename "$file") ($(($(stat -c %s "$file") / 1048576)) MB, $(($(date +%s) - started)) s)"

# só os KEEP mais novos (o nome leva o horário: ordem de nome = ordem de tempo)
ls -1 backups/pre-migrate-*.dump 2>/dev/null | sort | head -n "-$KEEP" | while read -r old; do
  rm -f "$old" "$old.sha256"
  echo "pré-migrate: removido $(basename "$old")"
done
echo "PRE_DUMP=$(pwd)/$file"
