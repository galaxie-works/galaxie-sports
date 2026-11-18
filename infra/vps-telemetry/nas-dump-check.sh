#!/usr/bin/env bash
# Prova de backup antes do migrate com DUMP_MODE=nas (docs/runbooks/replica-no-nas.md): em vez de rodar o pg_dump na
# VPS (pre-migrate-dump.sh, que custava CPU e disco e disparava o corte de CPU do provedor), garante que existe um dump
# recente feito fora dela, pedindo um ao NAS quando não há. Roda na VPS, na pasta da stack, chamado pelo deploy-gh.sh e
# pelo deploy.sh:
#
#   ssh $VPS "cd $DIR && NAS_DUMP_MAX_AGE_MIN=120 NAS_DUMP_WAIT_MIN=30 bash -s -- <migrations no journal do SHA novo> <rótulo>" < nas-dump-check.sh
#
# Só quando o journal do SHA novo tem mais migrations que o banco (como o pre-migrate-dump.sh). Aí, nesta ordem:
#   1. o recibo .nas_last_dump que o dump.sh da réplica do NAS deixa no volume de backups ("<quando> <bytes> <arquivo>"),
#      com até NAS_DUMP_MAX_AGE_MIN minutos (padrão 120) e tamanho plausível (pelo menos NAS_DUMP_MIN_MB, padrão 256, e
#      pelo menos 5% do tamanho do banco), dispensa o pedido;
#   2. um dump feito na própria VPS (diário em /backups ou em pre-migrate/) com a mesma idade também dispensa (o
#      semanal de domingo, ou um deploy anterior com DUMP_MODE=vps);
#   3. senão, deixa o PEDIDO de dump no volume (.nas_dump_request: "<quando> <rótulo>", o rótulo é o id do deploy) e
#      espera até NAS_DUMP_WAIT_MIN minutos (padrão 30) por um recibo mais novo que o pedido. O dumper do NAS consulta o
#      pedido a cada minuto (dump.sh --pedido, pela chave de recibo), faz o pg_dump da réplica em pre-migrate/, toca o
#      recibo e o próprio recibo apaga o pedido. Recibo novo e plausível = prova;
#   4. sem recibo no prazo: apaga o pedido (para o NAS não fazer um dump inútil depois) e falha SEM tocar no banco, com
#      a saída: conferir o NAS (túnel, réplica, last_dump.txt) ou publicar com DUMP_MODE=vps por um deploy.
# Saída: 0 = sem migration nova, ou prova encontrada (imprime NAS_DUMP=<arquivo> (<origem>, há N min, M MB));
# 1 = sem prova (o deploy para antes de qualquer troca). Para testes: NAS_DUMP_WAIT_S e NAS_DUMP_POLL_S (segundos).
set -euo pipefail

# Postgres no projeto `dados` (docs/runbooks/stack-em-tres-projetos.md); antes da transição, neste
if [ -f compose.dados.yml ]; then DADOS=(docker compose -f compose.dados.yml); else DADOS=(docker compose); fi

want="${1:?informe quantas migrations o journal do SHA novo tem}"
label="${2:-deploy}"
MAX_AGE_MIN="${NAS_DUMP_MAX_AGE_MIN:-120}"
MIN_MB="${NAS_DUMP_MIN_MB:-256}"
WAIT_MIN="${NAS_DUMP_WAIT_MIN:-30}"
WAIT_S="${NAS_DUMP_WAIT_S:-$((WAIT_MIN * 60))}"
POLL_S="${NAS_DUMP_POLL_S:-30}"
BACKUPS_DIR="${NAS_BACKUPS_DIR:-/var/lib/docker/volumes/galaxie-sports_backups/_data}"
DUMP_PREFIX="${DUMP_PREFIX:-galaxie_sports_}"
for v in "$want" "$MAX_AGE_MIN" "$MIN_MB" "$WAIT_MIN" "$WAIT_S" "$POLL_S"; do
  case "$v" in '' | *[!0-9]*)
    echo "FAIL  valor inválido ('$v'): contagem do journal, NAS_DUMP_MAX_AGE_MIN, NAS_DUMP_MIN_MB e NAS_DUMP_WAIT_MIN são inteiros"
    exit 1
    ;;
  esac
done
case "$label" in '' | *[!A-Za-z0-9._-]*)
  echo "FAIL  rótulo inválido: '$label'"
  exit 1
  ;;
esac
label="${label:0:100}"

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

age_min() { echo $((($(date -u +%s) - $(stat -c %Y "$1")) / 60)); }
receipt="$BACKUPS_DIR/.nas_last_dump"
request="$BACKUPS_DIR/.nas_dump_request"

# O recibo do NAS vale? Imprime a prova e devolve 0; senão devolve 1 com o motivo em nas_why. Com $1 (epoch), só vale
# um recibo gravado depois desse instante (o pedido).
nas_why=""
receipt_ok() {
  local since="${1:-0}" when bytes name age
  nas_why=""
  if [ ! -f "$receipt" ]; then
    nas_why="sem recibo do NAS ($receipt)"
    return 1
  fi
  read -r when bytes name <"$receipt" || true
  if ! [[ "${bytes:-}" =~ ^[0-9]+$ ]] || [ -z "${name:-}" ]; then
    nas_why="recibo do NAS ilegível ($(head -c 200 "$receipt" | tr -d '\n'))"
    return 1
  fi
  if [ "$(stat -c %Y "$receipt")" -lt "$since" ]; then
    nas_why="recibo do NAS anterior ao pedido ($name, de $when)"
    return 1
  fi
  age=$(age_min "$receipt")
  if [ "$since" = 0 ] && [ "$age" -gt "$MAX_AGE_MIN" ]; then
    nas_why="recibo do NAS velho: $name há $age min (máximo $MAX_AGE_MIN)"
    return 1
  fi
  if [ "$bytes" -lt "$((MIN_MB * 1048576))" ]; then
    nas_why="dump do NAS pequeno demais: $name com $((bytes / 1048576)) MB (mínimo NAS_DUMP_MIN_MB=$MIN_MB)"
    return 1
  fi
  if [ -n "$db_bytes" ] && [ "$((bytes * 20))" -lt "$db_bytes" ]; then
    nas_why="dump do NAS implausível: $name com $((bytes / 1048576)) MB para um banco de $((db_bytes / 1048576)) MB (menos de 5%)"
    return 1
  fi
  echo "NAS_DUMP=$name (NAS, há $age min, $((bytes / 1048576)) MB, recibo de $when)"
  return 0
}

# 1. Recibo recente do NAS: dispensa o pedido.
if receipt_ok; then exit 0; fi

# 2. Um dump feito na própria VPS (diário ou pré-migrate) com a mesma idade: também dispensa.
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
  echo "WARN  $nas_why; vale o dump feito na VPS"
  echo "NAS_DUMP=$(basename "$local_file") (VPS, há $local_age min, $(($(stat -c %s "$local_file") / 1048576)) MB)"
  exit 0
fi

# 3. Pedido ao NAS e a espera pelo recibo.
asked=$(date -u +%s)
(umask 022 && printf '%s %s\n' "$(date -u -d "@$asked" +%Y-%m-%dT%H:%M:%SZ)" "$label" >"$request.tmp" && mv "$request.tmp" "$request")
echo "pré-migrate (DUMP_MODE=nas): $nas_why${local_file:+; dump local mais novo: $(basename "$local_file") há $local_age min}. Pedido de dump deixado para o NAS (rótulo $label); esperando até $WAIT_MIN min pelo recibo (o dumper consulta a cada minuto e o pg_dump da réplica leva de 10 a 40 min)"
deadline=$((asked + WAIT_S))
while :; do
  if receipt_ok "$asked"; then
    rm -f "$request"
    exit 0
  fi
  [ "$(date -u +%s)" -lt "$deadline" ] || break
  sleep "$POLL_S"
done

# 4. Prazo estourado.
rm -f "$request"
echo "FAIL  o NAS não atendeu o pedido de dump em $WAIT_MIN min ($nas_why); pedido retirado"
echo "FAIL  confira o NAS: NAS_BACKUP_PATH/last_dump.txt e os logs de nas-replica-dumper-1, -postgres-1 e -tunnel-1 no Portainer (túnel caído? réplica atrasada ou no basebackup? dump ainda rodando?); na VPS, preparar-replica.sh --status"
echo "FAIL  para publicar mesmo assim: DUMP_MODE=vps por um deploy (gh variable set DUMP_MODE --body vps; o pg_dump volta a rodar na VPS, custa CPU e disco)"
echo "FAIL  nada foi tocado no banco (idade máxima do recibo: NAS_DUMP_MAX_AGE_MIN=$MAX_AGE_MIN min; espera: NAS_DUMP_WAIT_MIN=$WAIT_MIN min; agora: $(date -u +%Y-%m-%dT%H:%M:%SZ))"
exit 1
