#!/usr/bin/env bash
# Teste do replica-entrypoint.sh com pg_isready, psql, pg_basebackup e docker-entrypoint.sh falsos, sem root: a
# primeira subida (basebackup numa pasta temporária que vira PGDATA), o slot inativo que sobrou (apagado antes do -C),
# o slot ativo de outra réplica (para), o basebackup que falha (nada fica), a segunda subida (só o .pgpass) e o
# cluster promovido (não sobe).
#
#   bash infra/nas-replica/replica-entrypoint.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/vol"
printf '#!/bin/sh\nexit ${ISREADY_RC:-0}\n' >"$work/bin/pg_isready"
cat >"$work/bin/psql" <<'FAKE'
#!/bin/sh
sql=""
while [ $# -gt 0 ]; do case "$1" in -c) sql="$2"; shift 2 ;; *) shift ;; esac; done
echo "psql: $sql" >>"$CALLS"
case "$sql" in
*"select active from pg_replication_slots"*) printf '%s\n' "${SLOT_ACTIVE-}" ;;
*pg_drop_replication_slot*) [ -n "${DROP_FAILS:-}" ] && exit 1; echo "" ;;
esac
FAKE
# pg_basebackup falso: cria um cluster mínimo em -D (ou falha com BASEBACKUP_FAILS)
cat >"$work/bin/pg_basebackup" <<'FAKE'
#!/bin/sh
echo "pg_basebackup $*" >>"$CALLS"
[ -n "${BASEBACKUP_FAILS:-}" ] && exit 1
d=""
while [ $# -gt 0 ]; do case "$1" in -D) d="$2"; shift 2 ;; *) shift ;; esac; done
mkdir -p "$d" && echo 17 >"$d/PG_VERSION" && : >"$d/standby.signal"
FAKE
printf '#!/bin/sh\necho "docker-entrypoint.sh $*" >>"$CALLS"\n' >"$work/bin/docker-entrypoint.sh"
# rodando como root (contêiner, por exemplo): gosu (o da imagem postgres:17-alpine) e chown falsos, já que não há o
# usuário postgres aqui; o entrypoint só cai no su-exec se não houver gosu
printf '#!/bin/sh\nshift\nexec "$@"\n' >"$work/bin/gosu"
printf '#!/bin/sh\nexit 0\n' >"$work/bin/chown"
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH" CALLS="$work/calls.log" PGDATA="$work/vol/pgdata" REPLICATOR_PASSWORD=segredo123

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
sobe() { : >"$CALLS"; sh "$here/replica-entrypoint.sh" postgres -c hot_standby=on >"$work/out.log" 2>&1; }
limpa() { rm -rf "$work/vol"; mkdir -p "$work/vol"; unset SLOT_ACTIVE DROP_FAILS BASEBACKUP_FAILS; }

limpa
sobe && r=0 || r=$?
confere "primeira subida: basebackup com -R -C -S na pasta temporária, que vira PGDATA" \
  '[ "$r" = 0 ] && grep -q -- "-D $work/vol/basebackup.tmp -X stream -R -C -S nas_replica" "$CALLS" && [ -f "$PGDATA/standby.signal" ] && [ ! -e "$work/vol/basebackup.tmp" ]'
confere "basebackup com application_name e usuário, sem senha na linha de comando" 'grep -q "user=replicador application_name=nas_replica" "$CALLS" && ! grep -q segredo123 "$CALLS"'
# o modo só é conferido no Linux (o chmod do Git Bash do Windows não vale)
confere ".pgpass no volume, 600, com a senha" '{ [ "$(uname -s)" != Linux ] || [ "$(stat -c %a "$work/vol/.pgpass")" = 600 ]; } && grep -qx "tunnel:5432:\*:replicador:segredo123" "$work/vol/.pgpass"'
confere "sem slot sobrando, nada a apagar; depois o docker-entrypoint.sh com os -c do compose" '! grep -q pg_drop "$CALLS" && grep -q "docker-entrypoint.sh postgres -c hot_standby=on" "$CALLS"'

export REPLICATOR_PASSWORD=outra456
sobe && r=0 || r=$?
confere "segunda subida: sem basebackup, .pgpass regravado com a senha nova" '[ "$r" = 0 ] && ! grep -q pg_basebackup "$CALLS" && grep -q outra456 "$work/vol/.pgpass" && grep -q "docker-entrypoint.sh" "$CALLS"'
export REPLICATOR_PASSWORD=segredo123

rm -f "$PGDATA/standby.signal"
sobe && r=0 || r=$?
confere "cluster sem standby.signal (promovido): não sobe" '[ "$r" = 1 ] && ! grep -q "docker-entrypoint.sh" "$CALLS" && grep -q "não é mais um standby" "$work/out.log"'

limpa
export SLOT_ACTIVE=f
sobe && r=0 || r=$?
confere "slot inativo que sobrou: apagado antes do basebackup" '[ "$r" = 0 ] && [ "$(grep -n pg_drop_replication_slot "$CALLS" | cut -d: -f1)" -lt "$(grep -n pg_basebackup "$CALLS" | cut -d: -f1)" ]'

limpa
export SLOT_ACTIVE=t
sobe && r=0 || r=$?
confere "slot ativo (outra réplica): para sem basebackup" '[ "$r" = 1 ] && ! grep -q pg_basebackup "$CALLS" && grep -q "ATIVO" "$work/out.log"'

limpa
export SLOT_ACTIVE=f DROP_FAILS=1
sobe && r=0 || r=$?
confere "slot inativo que não dá para apagar: para com a instrução" '[ "$r" = 1 ] && grep -q "apague à mão" "$work/out.log"'

limpa
export BASEBACKUP_FAILS=1
sobe && r=0 || r=$?
confere "basebackup que falha: nada fica em PGDATA nem na temporária" '[ "$r" = 1 ] && [ ! -e "$PGDATA" ] && [ ! -e "$work/vol/basebackup.tmp" ]'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: replica-entrypoint.sh da réplica do NAS"
