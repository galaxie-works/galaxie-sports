#!/usr/bin/env bash
# Conferência depois do corte da migração da produção (docs/runbooks/migracao-producao-cpu-dedicada.md). SÓ LEITURA e
# idempotente: GET na API, selects no Postgres e ls/stat no volume dos backups; nada é escrito, parado ou reiniciado.
# Roda NA MÁQUINA DE PRODUÇÃO, na pasta da stack (os três compose e o .env), ou por ssh:
#
#   cd /docker/galaxie-sports && bash conferir-pos-corte.sh [opções]
#   ssh "$VPS" 'cd /docker/galaxie-sports && bash -s -- --resolve <ip-novo>' < infra/ops/conferir-pos-corte.sh
#
# Checagens (cada linha PASS, WARN, SKIP ou FAIL; sai com 1 se houver FAIL):
#   1. GET /health/db da API responde 200;
#   2. GET /version traz image_hash, igual à TAG_API do .env (WARN se diferente: versão no ar ≠ .env);
#   3. Postgres promovido (pg_is_in_recovery() falso) e sem réplica ligada (pg_stat_replication vazio; com linhas, WARN:
#      só a réplica reversa da volta atrás deve aparecer);
#   4. jogo em andamento (status live/break/starting, começado nas últimas 6 h) atualizado nos últimos --live-min minutos;
#      sem jogo em andamento, SKIP;
#   5. último dump do backup em /backups (volume `backups`, lido pelo contêiner backup): até --dump-max-h horas, tamanho > 0
#      e o .sha256 ao lado;
#   6. recibo do NAS (/backups/.nas_last_pull) tocado há até --receipt-max-h horas.
#
# Opções (ou variáveis de ambiente de mesmo nome em maiúsculas, ex.: API_URL):
#   --dir DIR            pasta da stack (padrão: a atual); de lá vêm o .env e o compose.dados.yml
#   --api URL            base da API (padrão: https://$API_DOMAIN do .env)
#   --resolve IP         manda o host da API para este IP (curl --resolve), para conferir a máquina nova antes da DNS
#   --live-min N         minutos sem atualização que um jogo em andamento pode ter (padrão 10)
#   --dump-max-h N       idade máxima do último dump, em horas (padrão 26, a do alerta BackupStale)
#   --receipt-max-h N    idade máxima do recibo do NAS, em horas (padrão 26, a do BackupCheckFailed)
# Nenhuma credencial aqui nem nos argumentos: o psql roda dentro do contêiner postgres com o usuário dele, e do .env só se
# leem API_DOMAIN e TAG_API (sem `source`: o arquivo não é executado).
set -uo pipefail

DIR="${DIR:-.}"
API_URL="${API_URL:-}"
RESOLVE="${RESOLVE:-}"
LIVE_MIN="${LIVE_MIN:-10}"
DUMP_MAX_H="${DUMP_MAX_H:-26}"
RECEIPT_MAX_H="${RECEIPT_MAX_H:-26}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir precisa de um valor}"; shift ;;
    --api) API_URL="${2:?--api precisa de um valor}"; shift ;;
    --resolve) RESOLVE="${2:?--resolve precisa de um valor}"; shift ;;
    --live-min) LIVE_MIN="${2:?--live-min precisa de um valor}"; shift ;;
    --dump-max-h) DUMP_MAX_H="${2:?--dump-max-h precisa de um valor}"; shift ;;
    --receipt-max-h) RECEIPT_MAX_H="${2:?--receipt-max-h precisa de um valor}"; shift ;;
    -h | --help) if [ -f "$0" ]; then sed -n '2,30p' "$0"; else echo "opções no cabeçalho de infra/ops/conferir-pos-corte.sh"; fi; exit 0 ;;
    *) echo "FAIL  opção desconhecida: $1 (-h mostra as opções)"; exit 1 ;;
  esac
  shift
done
for n in "$LIVE_MIN" "$DUMP_MAX_H" "$RECEIPT_MAX_H"; do
  case "$n" in '' | *[!0-9]*) echo "FAIL  número inválido: '$n' (--live-min, --dump-max-h e --receipt-max-h são inteiros)"; exit 1 ;; esac
done

fails=0
warns=0
pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; warns=$((warns + 1)); }
skip() { echo "SKIP  $*"; }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }

# valor de uma variável do .env, sem executar o arquivo (a última ocorrência vale, como no compose)
env_value() { sed -n "s/^$1=//p" "$DIR/.env" 2>/dev/null | tail -n 1 | sed 's/^["'"'"']//; s/["'"'"']$//'; }

cd "$DIR" 2>/dev/null || { fail "pasta da stack não encontrada: $DIR"; exit 1; }
[ -f compose.dados.yml ] || warn "compose.dados.yml não está em $PWD: as checagens do Postgres e do backup vão falhar fora da pasta da stack"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── 1 e 2: API ───────────────────────────────────────────────────────────────────────────────────
if [ -z "$API_URL" ]; then
  domain="$(env_value API_DOMAIN)"
  [ -n "$domain" ] && API_URL="https://$domain"
fi
API_URL="${API_URL%/}"
if [ -z "$API_URL" ]; then
  fail "sem a base da API: --api URL ou API_DOMAIN no $DIR/.env"
else
  host="${API_URL#*://}"
  host="${host%%/*}"
  port=443
  case "$host" in
    *:*) port="${host##*:}"; host="${host%%:*}" ;;
    *) case "$API_URL" in http://*) port=80 ;; esac ;;
  esac
  curl_opts=(-sS -m 10)
  [ -z "$RESOLVE" ] || curl_opts+=(--resolve "$host:$port:$RESOLVE")
  # http <caminho> <arquivo do corpo>: imprime o status (000 sem resposta)
  http() {
    local code
    code="$(curl "${curl_opts[@]}" -o "$2" -w '%{http_code}' "$API_URL$1" 2>"$tmp/curl.err")" || code="000"
    printf '%s' "${code:-000}"
  }

  code="$(http /health/db "$tmp/health")"
  if [ "$code" = 200 ]; then
    pass "GET $API_URL/health/db → 200${RESOLVE:+ (resolvendo $host para $RESOLVE)}"
  else
    fail "GET $API_URL/health/db → ${code} $(head -c 200 "$tmp/health" 2>/dev/null; head -c 200 "$tmp/curl.err" 2>/dev/null)"
  fi

  code="$(http /version "$tmp/version")"
  hash="$(sed -n 's/.*"image_hash":"\([^"]*\)".*/\1/p' "$tmp/version" 2>/dev/null | head -n 1)"
  tag="$(env_value TAG_API)"
  if [ "$code" != 200 ] || [ -z "$hash" ]; then
    fail "GET $API_URL/version → ${code}, sem image_hash: $(head -c 200 "$tmp/version" 2>/dev/null)"
  elif [ -z "$tag" ]; then
    warn "versão no ar: $hash (sem TAG_API no .env para comparar)"
  elif [ "$hash" = "$tag" ]; then
    pass "versão no ar: $hash = TAG_API do .env"
  else
    warn "versão no ar: $hash ≠ TAG_API do .env ($tag): deploy no meio, ou .env de outro SHA"
  fi
fi

# ── 3 e 4: Postgres ──────────────────────────────────────────────────────────────────────────────
# psql de leitura dentro do contêiner, com o usuário dele; </dev/null porque este script pode chegar pela stdin do bash -s
sql() {
  docker compose -f compose.dados.yml exec -T postgres sh -c \
    'psql -X -q -t -A -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$1" </dev/null 2>"$tmp/sql.err"
}

if rec="$(sql 'select pg_is_in_recovery()')"; then
  case "$rec" in
    f) pass "Postgres promovido (pg_is_in_recovery() = false)" ;;
    t) fail "Postgres ainda em recovery (réplica não promovida): select pg_promote()" ;;
    *) fail "pg_is_in_recovery() respondeu '$rec'" ;;
  esac
  n="$(sql 'select count(*) from pg_stat_replication' || echo '?')"
  if [ "$n" = 0 ]; then
    pass "pg_stat_replication vazio: nenhuma réplica ligada a esta máquina"
  else
    rows="$(sql "select coalesce(client_addr::text, '-') || ' ' || state from pg_stat_replication" | tr '\n' ';')"
    warn "pg_stat_replication com $n linha(s) [$rows]: esperado só durante a réplica reversa da volta atrás"
  fi

  live="$(sql "select count(*) || '|' || coalesce(extract(epoch from now() - max(updated_at))::int, -1) from core.event where status in ('live','break','starting') and starts_at > now() - interval '6 hours'")" || live=""
  live_n="${live%%|*}"
  live_age="${live##*|}"
  case "$live_n" in
    '' | *[!0-9]*) fail "consulta dos jogos em andamento falhou: $(head -c 200 "$tmp/sql.err")" ;;
    0)
      last="$(sql "select coalesce(extract(epoch from now() - max(updated_at))::int, -1) from core.event where updated_at > now() - interval '1 day'" || echo -1)"
      if [ "$last" -ge 0 ] 2>/dev/null; then
        skip "nenhum jogo em andamento; último jogo atualizado há $((last / 60)) min (o ao vivo só se prova com jogo)"
      else
        skip "nenhum jogo em andamento nem jogo atualizado nas últimas 24 h (o ao vivo só se prova com jogo)"
      fi
      ;;
    *)
      if [ "$live_age" -ge 0 ] 2>/dev/null && [ "$live_age" -le $((LIVE_MIN * 60)) ]; then
        pass "$live_n jogo(s) em andamento; o mais recente atualizado há $((live_age / 60)) min (limite $LIVE_MIN)"
      else
        fail "$live_n jogo(s) em andamento sem atualização há $((live_age / 60)) min (limite $LIVE_MIN): veja docker compose ps live e os logs"
      fi
      ;;
  esac
else
  fail "psql no contêiner postgres falhou: $(head -c 300 "$tmp/sql.err")"
fi

# ── 5 e 6: backup e recibo do NAS ────────────────────────────────────────────────────────────────
# lido pelo contêiner backup (o volume `backups` está em /backups nele): nome, tamanho e idade do dump mais novo e a idade
# do recibo, em segundos. Só ls e stat.
backup_info="$(docker compose -f compose.dados.yml exec -T backup sh -c '
d="${BACKUP_DIR:-/backups}"; now=$(date +%s)
f=$(ls -t "$d"/*.dump "$d"/*.dump.age 2>/dev/null | head -n 1)
if [ -n "$f" ]; then
  printf "dump %s %s %s %s\n" "$(basename "$f")" "$(stat -c %s "$f")" $((now - $(stat -c %Y "$f"))) "$([ -f "$f.sha256" ] && echo sha256 || echo sem-sha256)"
else echo "dump -"; fi
if [ -f "$d/.nas_last_pull" ]; then printf "recibo %s\n" $((now - $(stat -c %Y "$d/.nas_last_pull"))); else echo "recibo -"; fi
' </dev/null 2>"$tmp/backup.err")" || backup_info=""

if [ -z "$backup_info" ]; then
  fail "não deu para ler /backups pelo contêiner backup: $(head -c 300 "$tmp/backup.err")"
else
  read -r dump_name dump_size dump_age dump_sha <<<"$(printf '%s\n' "$backup_info" | sed -n 's/^dump //p')"
  if [ "$dump_name" = "-" ] || [ -z "$dump_name" ]; then
    fail "nenhum dump em /backups (o backup roda na partida com BACKUP_ON_START=true, ou docker compose -f compose.dados.yml exec -T backup backup.sh)"
  elif [ "${dump_size:-0}" -le 0 ] 2>/dev/null; then
    fail "último dump $dump_name com tamanho zero"
  elif [ "${dump_age:-0}" -gt $((DUMP_MAX_H * 3600)) ]; then
    fail "último dump $dump_name tem $((dump_age / 3600)) h (limite $DUMP_MAX_H h): BackupStale a caminho"
  elif [ "$dump_sha" != sha256 ]; then
    fail "último dump $dump_name sem o .sha256 ao lado (o restore.sh e o nas-pull.sh exigem)"
  else
    pass "último dump $dump_name: $((dump_size / 1024 / 1024)) MiB, há $((dump_age / 60)) min, com .sha256"
  fi

  receipt_age="$(printf '%s\n' "$backup_info" | sed -n 's/^recibo //p')"
  if [ "$receipt_age" = "-" ] || [ -z "$receipt_age" ]; then
    fail "sem recibo do NAS (/backups/.nas_last_pull): o nas-pull ainda não rodou contra esta máquina (VPS_HOST e known_hosts da stack do NAS)"
  elif [ "$receipt_age" -gt $((RECEIPT_MAX_H * 3600)) ]; then
    fail "recibo do NAS tocado há $((receipt_age / 3600)) h (limite $RECEIPT_MAX_H h): BackupCheckFailed a caminho"
  else
    pass "recibo do NAS tocado há $((receipt_age / 60)) min"
  fi
fi

echo
avisos=""
[ "$warns" -eq 0 ] || avisos=" ($warns aviso(s))"
if [ "$fails" -gt 0 ]; then
  echo "FAIL  $fails falha(s)$avisos: a máquina ainda não está pronta como produção"
  exit 1
fi
echo "PASS  conferência pós-corte sem falha$avisos"
