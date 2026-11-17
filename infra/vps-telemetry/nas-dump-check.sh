#!/usr/bin/env bash
# Prova de backup antes do migrate com DUMP_MODE=nas (docs/runbooks/replica-no-nas.md): em vez de rodar o pg_dump na
# VPS (pre-migrate-dump.sh, que custava CPU e disco e disparava o corte de CPU do provedor), confere que existe um dump
# recente feito fora dela. Roda na VPS, na pasta da stack, chamado pelo deploy-gh.sh e pelo deploy.sh:
#
#   ssh $VPS "cd $DIR && NAS_DUMP_MAX_AGE_MIN=120 bash -s -- <migrations no journal do SHA novo>" < nas-dump-check.sh
#
# Só quando o journal do SHA novo tem mais migrations que o banco (como o pre-migrate-dump.sh). Aí vale como prova, por
# ordem: (1) o recibo .nas_last_dump que o dump.sh da réplica do NAS deixa no volume de backups ("<quando> <bytes>
# <arquivo>"), com até NAS_DUMP_MAX_AGE_MIN minutos (padrão 120) e tamanho plausível (pelo menos NAS_DUMP_MIN_MB, padrão
# 256, e pelo menos 5% do tamanho do banco); (2) um dump feito na própria VPS (diário em /backups ou em pre-migrate/) com
# a mesma idade máxima, para o caso de o NAS estar fora. Sem nenhum dos dois, falha SEM tocar no banco e diz as duas
# saídas: pedir o dump ao NAS ou rodar o deploy uma vez com DUMP_MODE=vps.
# Saída: 0 = sem migration nova, ou prova encontrada (imprime NAS_DUMP=<arquivo> (<origem>, há N min, M MB));
# 1 = sem prova (o deploy para antes de qualquer troca).
set -euo pipefail

# Postgres no projeto `dados` (docs/runbooks/stack-em-tres-projetos.md); antes da transição, neste
if [ -f compose.dados.yml ]; then DADOS=(docker compose -f compose.dados.yml); else DADOS=(docker compose); fi

want="${1:?informe quantas migrations o journal do SHA novo tem}"
MAX_AGE_MIN="${NAS_DUMP_MAX_AGE_MIN:-120}"
MIN_MB="${NAS_DUMP_MIN_MB:-256}"
BACKUPS_DIR="${NAS_BACKUPS_DIR:-/var/lib/docker/volumes/galaxie-sports_backups/_data}"
DUMP_PREFIX="${DUMP_PREFIX:-galaxie_sports_}"
for v in "$want" "$MAX_AGE_MIN" "$MIN_MB"; do
  case "$v" in '' | *[!0-9]*)
    echo "FAIL  valor inválido ('$v'): contagem do journal, NAS_DUMP_MAX_AGE_MIN e NAS_DUMP_MIN_MB são inteiros"
    exit 1
    ;;
  esac
done

# todo docker compose com </dev/null: este script chega pela stdin do bash -s, e o docker a consumiria
applied="$("${DADOS[@]}" exec -T postgres sh -c \
  'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from drizzle.__drizzle_migrations"' \
  </dev/null 2>/dev/null || true)"
if [[ "$applied" =~ ^[0-9]+$ ]] && [ "$applied" -ge "$want" ]; then
  echo "pré-migrate: sem migration nova ($applied aplicadas, $want no journal); sem prova de backup a conferir"
  exit 0
fi
echo "pré-migrate (DUMP_MODE=nas): ${applied:-?} aplicadas, $want no journal; conferindo um dump recente fora da VPS"

db_bytes="$("${DADOS[@]}" exec -T postgres sh -c \
  'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select pg_database_size(current_database())"' \
  </dev/null 2>/dev/null || true)"
[[ "$db_bytes" =~ ^[0-9]+$ ]] || db_bytes=""

now=$(date -u +%s)
age_min() { echo $((($(date -u +%s) - $(stat -c %Y "$1")) / 60)); }

# 1. O recibo do dump feito no NAS.
receipt="$BACKUPS_DIR/.nas_last_dump"
nas_why=""
if [ ! -f "$receipt" ]; then
  nas_why="sem recibo do NAS ($receipt): o dump.sh da réplica nunca rodou, ou a chave de recibo ainda tem o comando antigo (preparar-replica.sh)"
else
  read -r when bytes name <"$receipt" || true
  age=$(age_min "$receipt")
  if ! [[ "$bytes" =~ ^[0-9]+$ ]] || [ -z "${name:-}" ]; then
    nas_why="recibo do NAS ilegível ($(head -c 200 "$receipt" | tr -d '\n'))"
  elif [ "$age" -gt "$MAX_AGE_MIN" ]; then
    nas_why="recibo do NAS velho: $name há $age min (máximo $MAX_AGE_MIN)"
  elif [ "$bytes" -lt "$((MIN_MB * 1048576))" ]; then
    nas_why="dump do NAS pequeno demais: $name com $((bytes / 1048576)) MB (mínimo NAS_DUMP_MIN_MB=$MIN_MB)"
  elif [ -n "$db_bytes" ] && [ "$((bytes * 20))" -lt "$db_bytes" ]; then
    nas_why="dump do NAS implausível: $name com $((bytes / 1048576)) MB para um banco de $((db_bytes / 1048576)) MB (menos de 5%)"
  else
    echo "NAS_DUMP=$name (NAS, há $age min, $((bytes / 1048576)) MB, recibo de $when)"
    exit 0
  fi
fi

# 2. Um dump feito na própria VPS (diário ou pré-migrate), como alternativa.
local_file=""
local_age=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  a=$(age_min "$f")
  if [ -z "$local_age" ] || [ "$a" -lt "$local_age" ]; then
    local_age="$a"
    local_file="$f"
  fi
done < <(find "$BACKUPS_DIR" "$BACKUPS_DIR/pre-migrate" -maxdepth 1 -type f \
  \( -name "${DUMP_PREFIX}*.dump" -o -name "${DUMP_PREFIX}*.dump.age" \) 2>/dev/null || true)
if [ -n "$local_file" ] && [ "$local_age" -le "$MAX_AGE_MIN" ]; then
  echo "WARN  $nas_why"
  echo "NAS_DUMP=$(basename "$local_file") (VPS, há $local_age min, $(($(stat -c %s "$local_file") / 1048576)) MB)"
  exit 0
fi

echo "FAIL  sem prova de backup recente para o migrate: $nas_why${local_file:+; dump local mais novo: $(basename "$local_file") há $local_age min}${local_file:-; nenhum dump em $BACKUPS_DIR}"
echo "FAIL  saídas: (a) peça o dump ao NAS e dispare o deploy de novo: docker exec nas-replica-dumper-1 /dump.sh pre-migrate <antigo>-<novo> (pela API do Portainer do NAS; docs/runbooks/replica-no-nas.md)"
echo "FAIL          (b) ou rode este deploy uma vez com DUMP_MODE=vps (o pg_dump na VPS, como antes; custa CPU e disco)"
echo "FAIL  nada foi tocado no banco (idade máxima: NAS_DUMP_MAX_AGE_MIN=$MAX_AGE_MIN min; agora: $(date -u -d "@$now" +%Y-%m-%dT%H:%M:%SZ))"
exit 1
