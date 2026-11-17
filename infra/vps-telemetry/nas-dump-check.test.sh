#!/usr/bin/env bash
# Teste do nas-dump-check.sh (a prova de backup do deploy com DUMP_MODE=nas) com docker falso e uma pasta no lugar do
# volume de backups: recibo do NAS fresco passa; recibo velho com dump local fresco passa (com aviso); os dois velhos
# falham com as duas saídas; sem migration nova nem confere; tamanho implausível é recusado.
#
#   bash infra/vps-telemetry/nas-dump-check.test.sh
# shellcheck disable=SC2034 # r e pw são lidos nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/backups/pre-migrate" "$work/stack"
touch "$work/stack/compose.dados.yml"

# docker falso: `compose -f compose.dados.yml exec -T postgres sh -c '<psql ...>'` responde a contagem de migrations
# (APPLIED) e o tamanho do banco (DB_BYTES)
cat >"$work/bin/docker" <<'FAKE'
#!/bin/sh
cmd=""
for a in "$@"; do cmd="$a"; done
case "$cmd" in
*__drizzle_migrations*) echo "${APPLIED:-1}" ;;
*pg_database_size*) echo "${DB_BYTES:-20000000000}" ;;
*) exit 1 ;;
esac
FAKE
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" NAS_BACKUPS_DIR="$work/backups"
cd "$work/stack" || exit 1

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
check() { bash "$here/nas-dump-check.sh" "$@" >"$work/out.log" 2>&1; }
limpa() { rm -f "$work/backups/.nas_last_dump" "$work/backups/"*.dump "$work/backups/pre-migrate/"*.dump; unset APPLIED DB_BYTES NAS_DUMP_MAX_AGE_MIN; }
recibo() { # recibo <minutos atrás> <bytes>
  printf '%s %s galaxie_sports_20260101T033000Z.dump\n' "$(date -u -d "-$1 min" +%Y-%m-%dT%H:%M:%SZ)" "$2" >"$work/backups/.nas_last_dump"
  touch -d "-$1 min" "$work/backups/.nas_last_dump"
}
local_dump() { # local_dump <pasta> <minutos atrás>
  f="$1/galaxie_sports_$(date -u -d "-$2 min" +%Y%m%dT%H%M%SZ).dump"
  echo x >"$f"
  touch -d "-$2 min" "$f"
}

limpa
check 1 && r=0 || r=$?
confere "sem migration nova: sai 0 sem conferir recibo" '[ "$r" = 0 ] && grep -q "sem migration nova" "$work/out.log"'

limpa
recibo 10 4500000000
check 2 && r=0 || r=$?
confere "recibo do NAS fresco e plausível: passa com NAS_DUMP=" '[ "$r" = 0 ] && grep -q "^NAS_DUMP=galaxie_sports_20260101T033000Z.dump (NAS, há 10 min, 4291 MB" "$work/out.log"'

limpa
recibo 300 4500000000
check 2 && r=0 || r=$?
confere "recibo velho e nenhum dump local: falha com as duas saídas, sem tocar no banco" \
  '[ "$r" = 1 ] && grep -q "^FAIL  sem prova de backup recente" "$work/out.log" && grep -q "docker exec nas-replica-dumper-1 /dump.sh pre-migrate" "$work/out.log" && grep -q "DUMP_MODE=vps" "$work/out.log" && grep -q "nada foi tocado no banco" "$work/out.log"'

limpa
recibo 300 4500000000
local_dump "$work/backups" 30
check 2 && r=0 || r=$?
confere "recibo velho + dump local fresco: passa pela VPS, com aviso do recibo" '[ "$r" = 0 ] && grep -q "^WARN  recibo do NAS velho" "$work/out.log" && grep -q "^NAS_DUMP=galaxie_sports_.*(VPS, há 30 min" "$work/out.log"'

limpa
recibo 300 4500000000
local_dump "$work/backups/pre-migrate" 200
check 2 && r=0 || r=$?
confere "recibo velho + dump local velho: falha e cita o dump local" '[ "$r" = 1 ] && grep -q "dump local mais novo: galaxie_sports_.* há 200 min" "$work/out.log"'

limpa
recibo 300 4500000000
local_dump "$work/backups/pre-migrate" 200
export NAS_DUMP_MAX_AGE_MIN=600
check 2 && r=0 || r=$?
confere "NAS_DUMP_MAX_AGE_MIN maior aceita o recibo de 300 min" '[ "$r" = 0 ] && grep -q "^NAS_DUMP=.*(NAS, há 300 min" "$work/out.log"'

limpa
recibo 10 1000000
check 2 && r=0 || r=$?
confere "dump do NAS pequeno demais (abaixo de NAS_DUMP_MIN_MB) é recusado" '[ "$r" = 1 ] && grep -q "pequeno demais" "$work/out.log"'

limpa
recibo 10 400000000
export DB_BYTES=20000000000
check 2 && r=0 || r=$?
confere "dump do NAS com menos de 5% do banco é implausível" '[ "$r" = 1 ] && grep -q "implausível" "$work/out.log"'

limpa
export APPLIED=abc
recibo 10 4500000000
check 2 && r=0 || r=$?
confere "contagem de migrations ilegível: confere a prova mesmo assim" '[ "$r" = 0 ] && grep -q "^NAS_DUMP=" "$work/out.log"'

limpa
check x && r=0 || r=$?
confere "argumento inválido falha" '[ "$r" = 1 ]'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: nas-dump-check.sh (prova de backup do deploy com DUMP_MODE=nas)"
