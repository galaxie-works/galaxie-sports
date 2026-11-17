#!/usr/bin/env bash
# Teste do preparar-replica.sh com docker falso (responde ao psql pela stdin e aos comandos do compose) numa pasta de
# stack de faz de conta: gera REPLICATOR_PASSWORD no .env sem imprimir, aplica wal_keep_size/max_slot_wal_keep_size por
# ALTER SYSTEM, cria o papel com a senha pela stdin, libera o pg_hba, sobe o replica-proxy, instala o comando forçado do
# recibo (idêntico a galaxie-nas-receipt.sh) e grava as chaves do NAS; é idempotente; recusa com deploy em curso; e o
# comando forçado aceita pull e dump e recusa o resto.
#
#   bash infra/vps-telemetry/preparar-replica.test.sh
# shellcheck disable=SC2034 # r e pw são lidos nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/stack" "$work/ssh" "$work/backups"
printf 'POSTGRES_PASSWORD=x\nOUTRA=mantida\n' >"$work/stack/.env"
printf 'services:\n  postgres:\n    image: postgres:17-alpine\n  replica-proxy:\n    image: alpine:3.22\n' >"$work/stack/compose.dados.yml"
printf 'ssh-ed25519 AAAAdev dev\ncommand="touch /x/.nas_last_pull",restrict ssh-ed25519 AAAArecibo galaxie-nas-receipt\n' >"$work/ssh/authorized_keys"

# docker falso: a SQL chega pela stdin; o resto é pelo subcomando do compose. Grava tudo em CALLS
cat >"$work/bin/docker" <<'FAKE'
#!/bin/sh
args="$*"
echo "docker $args" >>"$CALLS"
case "$args" in
*"ps -q postgres"*) echo abc123; exit 0 ;;
*"ps --format"*) echo "Up 3 seconds"; exit 0 ;;
*"config -q"* | *"up -d --no-deps replica-proxy"*) exit 0 ;;
*"-e LINE="*) [ -n "${HBA_JA:-}" ] && echo ja || echo add; exit 0 ;;
esac
sql=$(cat)
echo "sql: $sql" >>"$CALLS"
case "$sql" in
"show wal_level") echo "${WAL_LEVEL:-replica}" ;;
"show max_wal_senders") echo 10 ;;
"show max_replication_slots") echo 10 ;;
*"current_setting('wal_keep_size')"*) echo "${CUR_WAL_KEEP:-0}" ;;
*"current_setting('max_slot_wal_keep_size')"*) echo "${CUR_SLOT_KEEP:--1}" ;;
*"pg_size_bytes('2GB')"*) echo 2048 ;;
*"pg_size_bytes('4GB')"*) echo 4096 ;;
*"pg_size_bytes(current_setting('wal_keep_size'))"*) echo "${CUR_WAL_KEEP:-0}" ;;
*"pg_size_bytes(current_setting('max_slot_wal_keep_size'))"*) exit 1 ;;
*"count(*) from pg_roles"*) echo "${ROLE_EXISTS:-0}" ;;
*pg_reload_conf*) echo t ;;
*pg_current_wal_lsn*) echo "0/ABC" ;;
*) echo "" ;;
esac
FAKE
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS="$work/calls.log" AUTHORIZED_KEYS="$work/ssh/authorized_keys" \
  RECEIPT_BIN="$work/galaxie-nas-receipt" NAS_BACKUPS_DIR="$work/backups"
cd "$work/stack" || exit 1

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
run() { : >"$CALLS"; bash "$here/preparar-replica.sh" "$@" >"$work/out.log" 2>&1; }

mkdir -p .deploy.lock
run && r=0 || r=$?
confere "deploy em curso (.deploy.lock): recusa sem tocar em nada" '[ "$r" = 1 ] && grep -q "deploy em curso" "$work/out.log" && ! grep -q REPLICATOR_PASSWORD .env'
rmdir .deploy.lock

run --tunnel-key "ssh-ed25519 AAAAtunel galaxie-nas-tunnel" && r=0 || r=$?
pw=$(sed -n 's/^REPLICATOR_PASSWORD=//p' .env)
confere "primeira execução passa" '[ "$r" = 0 ] && grep -q "^PASS" "$work/out.log"'
confere "REPLICATOR_PASSWORD gerada no .env (64 hex), o resto do .env fica, e a senha não sai na tela" \
  '[[ "$pw" =~ ^[0-9a-f]{64}$ ]] && grep -q "^OUTRA=mantida" .env && ! grep -q "$pw" "$work/out.log"'
confere "wal_keep_size e max_slot_wal_keep_size por ALTER SYSTEM e reload" \
  'grep -q "sql: alter system set wal_keep_size = '"'"'2GB'"'"'" "$CALLS" && grep -q "sql: alter system set max_slot_wal_keep_size = '"'"'4GB'"'"'" "$CALLS" && grep -q "pg_reload_conf" "$CALLS"'
confere "papel replicador criado com a senha pela stdin (não na linha de comando do docker)" \
  'grep -q "sql: create role replicador with replication login password '"'"'$pw'"'"'" "$CALLS" && ! grep -q "^docker .*$pw" "$CALLS"'
confere "pg_hba liberado para replication na rede da stack" 'grep -q "LINE=host replication replicador 172.30.50.0/24 scram-sha-256" "$CALLS"'
confere "replica-proxy sobe sem recriar o postgres" 'grep -q "up -d --no-deps replica-proxy" "$CALLS" && ! grep -q "up -d.*postgres" "$CALLS"'
confere "comando forçado instalado e idêntico a galaxie-nas-receipt.sh" '[ -x "$RECEIPT_BIN" ] && diff -q "$RECEIPT_BIN" "$here/galaxie-nas-receipt.sh"'
confere "chave de recibo trocada para o comando forçado, com a mesma chave" \
  'grep -qxF "command=\"$RECEIPT_BIN\",restrict ssh-ed25519 AAAArecibo galaxie-nas-receipt" "$AUTHORIZED_KEYS" && ! grep -q "touch /x" "$AUTHORIZED_KEYS"'
confere "chave do túnel só encaminha porta para o proxy" \
  'grep -qxF "command=\"/bin/false\",restrict,port-forwarding,permitopen=\"127.0.0.1:5432\" ssh-ed25519 AAAAtunel galaxie-nas-tunnel" "$AUTHORIZED_KEYS" && grep -q "^ssh-ed25519 AAAAdev dev$" "$AUTHORIZED_KEYS"'
confere "backup do authorized_keys" 'ls "$work/ssh/authorized_keys.bak-"* >/dev/null'
confere "lembra de copiar a senha para o Portainer" 'grep -q "grep ^REPLICATOR_PASSWORD= .env" "$work/out.log"'

export ROLE_EXISTS=1 CUR_WAL_KEEP=2048 HBA_JA=1
run && r=0 || r=$?
confere "segunda execução: idempotente (senha igual, wal_keep_size já era, pg_hba já libera, chaves iguais)" \
  '[ "$r" = 0 ] && [ "$(sed -n "s/^REPLICATOR_PASSWORD=//p" .env)" = "$pw" ] && grep -q "wal_keep_size=.*já era" "$work/out.log" && grep -q "já libera" "$work/out.log" && grep -q "sql: alter role replicador" "$CALLS" && [ "$(grep -c galaxie-nas-tunnel "$AUTHORIZED_KEYS")" = 1 ] && [ "$(grep -c galaxie-nas-receipt "$AUTHORIZED_KEYS")" = 1 ]'
unset ROLE_EXISTS CUR_WAL_KEEP HBA_JA

export WAL_LEVEL=minimal
run && r=0 || r=$?
confere "wal_level errado: para e diz o -c a acrescentar ao compose" '[ "$r" = 1 ] && grep -q "wal_level=replica" "$work/out.log"'
unset WAL_LEVEL

run --status && r=0 || r=$?
confere "--status imprime parâmetros, slots, LSN e recibos sem mudar nada" '[ "$r" = 0 ] && grep -q "LSN atual" "$work/out.log" && grep -q "recibo .nas_last_dump: não existe" "$work/out.log" && ! grep -q "alter " "$CALLS"'

# o comando forçado do recibo, como o sshd o chama (SSH_ORIGINAL_COMMAND)
recibo() { SSH_ORIGINAL_COMMAND="${1:-}" BACKUPS_DIR="$work/backups" sh "$RECEIPT_BIN" >"$work/out.log" 2>&1; }
recibo "" && r=0 || r=$?
confere "recibo sem comando (nas-pull.sh de hoje) toca .nas_last_pull" '[ "$r" = 0 ] && [ -f "$work/backups/.nas_last_pull" ] && grep -q "recibo pull ok" "$work/out.log"'
recibo "dump 2026-11-17T03:40:00Z 4500000000 galaxie_sports_20261117T033000Z.dump.age" && r=0 || r=$?
confere "recibo dump grava .nas_last_dump com os três campos" '[ "$r" = 0 ] && [ "$(cat "$work/backups/.nas_last_dump")" = "2026-11-17T03:40:00Z 4500000000 galaxie_sports_20261117T033000Z.dump.age" ] && grep -q "recibo dump ok" "$work/out.log"'
rm -f "$work/backups/.nas_last_dump"
recibo "dump ontem 10 x" && r=0 || r=$?
confere "recibo dump com data inválida é recusado" '[ "$r" = 1 ] && [ ! -f "$work/backups/.nas_last_dump" ]'
recibo "dump 2026-11-17T03:40:00Z 10 ../../etc/passwd" && r=0 || r=$?
confere "recibo dump com nome inválido é recusado" '[ "$r" = 1 ] && [ ! -f "$work/backups/.nas_last_dump" ]'
recibo "sh" && r=0 || r=$?
confere "qualquer outro comando é recusado" '[ "$r" = 1 ]'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: preparar-replica.sh e o comando forçado do recibo"
