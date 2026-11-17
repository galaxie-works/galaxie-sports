#!/usr/bin/env bash
# Teste do conferir-pos-corte.sh com curl e docker falsos: API no ar e fora, réplica promovida ou não, jogo em andamento
# fresco, parado ou ausente, dump e recibo do NAS em dia ou velhos, e o --resolve chegando ao curl.
#
#   bash infra/ops/conferir-pos-corte.test.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
stack="$work/stack"
backups="$work/backups"
mkdir -p "$work/bin" "$stack" "$backups"
touch "$stack/compose.dados.yml"
printf 'API_DOMAIN=api.exemplo.test\nTAG_API=in-abc1234\n' >"$stack/.env"

# curl falso: grava a chamada, escreve o corpo em -o e imprime o status conforme a URL
cat >"$work/bin/curl" <<'FAKE'
#!/bin/sh
echo "curl $*" >>"$CALLS"
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -w | -m | --resolve) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
[ "${FAKE_CURL_DOWN:-}" = 1 ] && { echo "curl: (7) Failed to connect" >&2; exit 7; }
case "$url" in
  */health/db) printf '%s' "${FAKE_HEALTH_BODY:-{\"status\":\"ok\"\}}" >"$out"; printf '%s' "${FAKE_HEALTH_CODE:-200}" ;;
  */version) printf '{"service":"api","image_hash":"%s","node":"v24"}' "${FAKE_HASH:-in-abc1234}" >"$out"; printf 200 ;;
  *) printf 404 ;;
esac
FAKE
# docker falso: o psql do contêiner postgres responde pela consulta (último argumento); o sh -c do contêiner backup roda
# aqui mesmo, contra a pasta falsa de backups (o trecho é o mesmo do script)
cat >"$work/bin/docker" <<'FAKE'
#!/bin/sh
echo "docker $*" >>"$CALLS"
case " $* " in
  *" postgres sh -c "*)
    [ "${FAKE_PG_DOWN:-}" = 1 ] && { echo "service postgres is not running" >&2; exit 1; }
    q=""; for a in "$@"; do q="$a"; done
    case "$q" in
      *pg_is_in_recovery*) echo "${FAKE_RECOVERY:-f}" ;;
      *"count(*) from pg_stat_replication"*) echo "${FAKE_REPL_N:-0}" ;;
      *pg_stat_replication*) printf '%s\n' "${FAKE_REPL_ROWS:-}" ;;
      *"status in ('live'"*) echo "${FAKE_LIVE:-0|-1}" ;;
      *"updated_at > now() - interval '1 day'"*) echo "${FAKE_LAST:-600}" ;;
      *) echo "consulta inesperada: $q" >&2; exit 2 ;;
    esac ;;
  *" backup sh -c "*)
    snippet=""; prev=""
    for a in "$@"; do [ "$prev" = "-c" ] && snippet="$a"; prev="$a"; done
    BACKUP_DIR="$FAKE_BACKUPS" sh -c "$snippet" ;;
  *) echo "docker falso: $*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$work/bin/curl" "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS="$work/calls.log" FAKE_BACKUPS="$backups"

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
run() { (cd "$stack" && bash "$here/conferir-pos-corte.sh" "$@") >"$work/out.log" 2>&1; echo $? >"$work/rc"; [ -z "${DEBUG:-}" ] || { echo "--- rc=$(cat "$work/rc")"; cat "$work/out.log"; }; }
rc() { cat "$work/rc"; }
out() { cat "$work/out.log"; }
limpa() {
  rm -rf "$backups"; mkdir -p "$backups"; : >"$CALLS"
  unset FAKE_CURL_DOWN FAKE_HEALTH_CODE FAKE_HEALTH_BODY FAKE_HASH FAKE_PG_DOWN FAKE_RECOVERY FAKE_REPL_N FAKE_REPL_ROWS FAKE_LIVE FAKE_LAST
}
dump_ok() {
  f="$backups/galaxie_sports_20261118T033000Z.dump"
  head -c 2048 /dev/zero >"$f"; echo "x  $(basename "$f")" >"$f.sha256"
  touch -d "${1:-1 hour ago}" "$f"
}
recibo_ok() { touch -d "${1:-30 minutes ago}" "$backups/.nas_last_pull"; }

# 1. tudo em ordem, sem jogo: só PASS e SKIP, sai 0
limpa; dump_ok; recibo_ok
run
confere "tudo em ordem sai 0" '[ "$(rc)" = 0 ]'
confere "health/db e versão PASS" 'out | grep -q "PASS  GET https://api.exemplo.test/health/db → 200" && out | grep -q "PASS  versão no ar: in-abc1234 = TAG_API"'
confere "promovido e sem réplica" 'out | grep -q "PASS  Postgres promovido" && out | grep -q "PASS  pg_stat_replication vazio"'
confere "sem jogo em andamento é SKIP" 'out | grep -q "SKIP  nenhum jogo em andamento; último jogo atualizado há 10 min"'
confere "dump e recibo em dia" 'out | grep -q "PASS  último dump galaxie_sports_20261118T033000Z.dump: 0 MiB" && out | grep -q "PASS  recibo do NAS tocado há"'
confere "nenhum FAIL" '! out | grep -q "^FAIL"'

# 2. --resolve chega ao curl, e a URL continua pelo nome
limpa; dump_ok; recibo_ok
run --resolve 203.0.113.10
confere "--resolve vira curl --resolve host:443:ip" 'grep -q -- "--resolve api.exemplo.test:443:203.0.113.10" "$CALLS" && grep -q "https://api.exemplo.test/health/db" "$CALLS"'
confere "--resolve sai 0" '[ "$(rc)" = 0 ]'

# 3. API fora: FAIL e sai 1, mas o resto é conferido
limpa; dump_ok; recibo_ok; export FAKE_CURL_DOWN=1
run
confere "API fora é FAIL e sai 1" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  GET https://api.exemplo.test/health/db → 000"'
confere "o resto ainda é conferido" 'out | grep -q "PASS  Postgres promovido"'

# 4. health/db 503
limpa; dump_ok; recibo_ok; export FAKE_HEALTH_CODE=503 FAKE_HEALTH_BODY='{"status":"error"}'
run
confere "health/db 503 é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "health/db → 503"'

# 5. versão diferente da TAG_API: WARN, não FAIL
limpa; dump_ok; recibo_ok; export FAKE_HASH=in-outra
run
confere "versão ≠ TAG_API é WARN e sai 0" '[ "$(rc)" = 0 ] && out | grep -q "WARN  versão no ar: in-outra ≠ TAG_API do .env (in-abc1234)"'

# 6. ainda em recovery
limpa; dump_ok; recibo_ok; export FAKE_RECOVERY=t
run
confere "em recovery é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  Postgres ainda em recovery"'

# 7. réplica ligada (reversa): WARN com as linhas
limpa; dump_ok; recibo_ok; export FAKE_REPL_N=1 FAKE_REPL_ROWS='10.0.0.9 streaming'
run
confere "réplica ligada é WARN, sai 0" '[ "$(rc)" = 0 ] && out | grep -q "WARN  pg_stat_replication com 1 linha(s) \[10.0.0.9 streaming;\]"'

# 8. jogo em andamento fresco e parado
limpa; dump_ok; recibo_ok; export FAKE_LIVE='2|120'
run
confere "jogo atualizado há 2 min é PASS" '[ "$(rc)" = 0 ] && out | grep -q "PASS  2 jogo(s) em andamento; o mais recente atualizado há 2 min (limite 10)"'
limpa; dump_ok; recibo_ok; export FAKE_LIVE='1|1500'
run
confere "jogo parado há 25 min é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  1 jogo(s) em andamento sem atualização há 25 min"'
run --live-min 30
confere "--live-min 30 aceita 25 min" '[ "$(rc)" = 0 ] && out | grep -q "PASS  1 jogo(s) em andamento"'

# 9. dump velho, sem .sha256 e ausente; recibo velho e ausente
limpa; dump_ok "30 hours ago"; recibo_ok
run
confere "dump de 30 h é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  último dump galaxie_sports_20261118T033000Z.dump tem 30 h (limite 26 h)"'
run --dump-max-h 48
confere "--dump-max-h 48 aceita 30 h" '[ "$(rc)" = 0 ]'
limpa; dump_ok; rm "$backups"/*.sha256; recibo_ok
run
confere "dump sem .sha256 é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "sem o .sha256 ao lado"'
limpa; recibo_ok
run
confere "sem dump é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  nenhum dump em /backups"'
limpa; dump_ok; recibo_ok "40 hours ago"
run
confere "recibo de 40 h é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  recibo do NAS tocado há 40 h (limite 26 h)"'
limpa; dump_ok
run
confere "sem recibo é FAIL com a dica do nas-pull" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  sem recibo do NAS" && out | grep -q "VPS_HOST e known_hosts"'

# 10. postgres fora
limpa; dump_ok; recibo_ok; export FAKE_PG_DOWN=1
run
confere "psql fora é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  psql no contêiner postgres falhou"'

# 11. sem .env e sem --api: FAIL na API; --api supre
limpa; dump_ok; recibo_ok; mv "$stack/.env" "$stack/.env.off"
run
confere "sem API_DOMAIN nem --api é FAIL" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  sem a base da API"'
run --api http://127.0.0.1:3000/
confere "--api supre o .env (sem TAG_API vira WARN)" '[ "$(rc)" = 0 ] && out | grep -q "PASS  GET http://127.0.0.1:3000/health/db → 200" && out | grep -q "WARN  versão no ar: in-abc1234 (sem TAG_API"'
mv "$stack/.env.off" "$stack/.env"

# 12. só leitura: nenhum docker compose up/stop/restart/exec que escreva, nenhum curl que não seja GET
limpa; dump_ok; recibo_ok
run
confere "só leitura: nenhum up, stop, restart, start ou rm" '! grep -qE "docker compose( -f [^ ]+)? (up|stop|restart|start|rm|down) " "$CALLS" && grep -qE "docker compose -f compose.dados.yml exec -T (postgres|backup) " "$CALLS"'
confere "só leitura: curl sem -X, -d nem --data" '! grep -qE "curl .*(-X |-d |--data)" "$CALLS"'

# 13. opção inválida
run --live-min abc
confere "número inválido sai 1" '[ "$(rc)" = 1 ] && out | grep -q "FAIL  número inválido"'
run --xyz
confere "opção desconhecida sai 1" '[ "$(rc)" = 1 ] && out | grep -q "opção desconhecida"'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: conferir-pos-corte.sh"
