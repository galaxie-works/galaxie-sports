#!/usr/bin/env bash
# Teste do nas-dump-check.sh (a prova de backup do deploy com DUMP_MODE=nas) com docker falso e uma pasta no lugar do
# volume de backups, nos três caminhos: recibo recente dispensa o pedido; sem recibo, o pedido fica na VPS e o NAS
# (simulado) atende dentro do prazo; prazo estourado falha com a mensagem e retira o pedido. Mais: dump local fresco
# dispensa, sem migration nova nem confere, tamanho implausível é recusado.
#
#   bash infra/vps-telemetry/nas-dump-check.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
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
# espera curta nos testes (segundos em vez de minutos; folga para uma máquina lenta)
export PATH="$work/bin:$PATH" NAS_BACKUPS_DIR="$work/backups" NAS_DUMP_WAIT_S=15 NAS_DUMP_POLL_S=1
cd "$work/stack" || exit 1

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else echo "FALHA $1"; fails=$((fails + 1)); fi
}
check() { bash "$here/nas-dump-check.sh" "$@" >"$work/out.log" 2>&1; }
limpa() { rm -f "$work/backups/.nas_last_dump" "$work/backups/.nas_dump_request" "$work/backups/"*.dump "$work/backups/pre-migrate/"*.dump; unset APPLIED DB_BYTES NAS_DUMP_MAX_AGE_MIN; }
recibo() { # recibo <minutos atrás> <bytes> [arquivo]
  printf '%s %s %s\n' "$(date -u -d "-$1 min" +%Y-%m-%dT%H:%M:%SZ)" "$2" "${3:-galaxie_sports_20260101T033000Z.dump}" >"$work/backups/.nas_last_dump"
  touch -d "-$1 min" "$work/backups/.nas_last_dump"
}
local_dump() { # local_dump <pasta> <minutos atrás>
  f="$1/galaxie_sports_$(date -u -d "-$2 min" +%Y%m%dT%H%M%SZ).dump"
  echo x >"$f"
  touch -d "-$2 min" "$f"
}

limpa
check 1 && r=0 || r=$?
confere "sem migration nova: sai 0 sem conferir recibo nem deixar pedido" '[ "$r" = 0 ] && grep -q "sem migration nova" "$work/out.log" && [ ! -f "$work/backups/.nas_dump_request" ]'

limpa
recibo 10 4500000000
check 2 gha-1 && r=0 || r=$?
confere "recibo do NAS recente e plausível: passa com NAS_DUMP=, sem pedido" '[ "$r" = 0 ] && grep -q "^NAS_DUMP=galaxie_sports_20260101T033000Z.dump (NAS, há 10 min, 4291 MB" "$work/out.log" && [ ! -f "$work/backups/.nas_dump_request" ]'

limpa
recibo 300 4500000000
local_dump "$work/backups" 30
check 2 gha-1 && r=0 || r=$?
confere "recibo velho + dump local fresco: passa pela VPS, com aviso, sem pedido" '[ "$r" = 0 ] && grep -q "^WARN  recibo do NAS velho" "$work/out.log" && grep -q "^NAS_DUMP=galaxie_sports_.*(VPS, há 30 min" "$work/out.log" && [ ! -f "$work/backups/.nas_dump_request" ]'

# o NAS de faz de conta: 2 s depois do pedido, "faz o dump" e toca um recibo novo (e apaga o pedido, como o comando forçado)
limpa
recibo 300 4500000000
local_dump "$work/backups/pre-migrate" 200
(
  for _ in $(seq 1 20); do [ -f "$work/backups/.nas_dump_request" ] && break; sleep 0.5; done
  read -r _ rotulo <"$work/backups/.nas_dump_request"
  sleep 2
  printf '%s 4600000000 galaxie_sports_pre-migrate_20260101T040000Z_%s.dump\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rotulo" >"$work/backups/.nas_last_dump"
  rm -f "$work/backups/.nas_dump_request"
) &
check 2 gha-77-abc1234-def5678 && r=0 || r=$?
wait
confere "recibo velho e dump local velho: deixa o pedido com o rótulo do deploy e espera" 'grep -q "Pedido de dump deixado para o NAS (rótulo gha-77-abc1234-def5678)" "$work/out.log"'
confere "o NAS atende dentro do prazo: a prova é o dump novo em pre-migrate/, sem pedido sobrando" \
  '[ "$r" = 0 ] && grep -q "^NAS_DUMP=galaxie_sports_pre-migrate_20260101T040000Z_gha-77-abc1234-def5678.dump (NAS, há 0 min, 4386 MB" "$work/out.log" && [ ! -f "$work/backups/.nas_dump_request" ]'

limpa
recibo 300 4500000000
check 2 gha-2 && r=0 || r=$?
confere "prazo estourado: falha com as saídas (NAS, DUMP_MODE=vps), sem tocar no banco, e retira o pedido" \
  '[ "$r" = 1 ] && grep -q "^FAIL  o NAS não atendeu o pedido de dump em" "$work/out.log" && grep -q "last_dump.txt" "$work/out.log" && grep -q "DUMP_MODE=vps" "$work/out.log" && grep -q "nada foi tocado no banco" "$work/out.log" && [ ! -f "$work/backups/.nas_dump_request" ]'

# recibo anterior ao pedido (o NAS tocou um dump velho de novo? não) não vale: só um gravado depois do pedido
limpa
check 2 gha-3 && r=0 || r=$?
confere "sem recibo nenhum e sem resposta: falha citando que não há recibo" '[ "$r" = 1 ] && grep -q "sem recibo do NAS" "$work/out.log"'

limpa
recibo 300 4500000000
local_dump "$work/backups/pre-migrate" 200
export NAS_DUMP_MAX_AGE_MIN=600
check 2 && r=0 || r=$?
confere "NAS_DUMP_MAX_AGE_MIN maior aceita o recibo de 300 min sem pedido" '[ "$r" = 0 ] && grep -q "^NAS_DUMP=.*(NAS, há 300 min" "$work/out.log" && [ ! -f "$work/backups/.nas_dump_request" ]'

limpa
recibo 10 1000000
check 2 && r=0 || r=$?
confere "dump do NAS pequeno demais (abaixo de NAS_DUMP_MIN_MB) não vale e o pedido vai para o NAS" '[ "$r" = 1 ] && grep -q "pequeno demais" "$work/out.log"'

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
check 2 "a b" && r=0 || r=$?
confere "rótulo inválido falha" '[ "$r" = 1 ]'

if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)" >&2
  exit 1
fi
echo "OK: nas-dump-check.sh (prova de backup do deploy com DUMP_MODE=nas: recibo, dump local, pedido ao NAS)"
