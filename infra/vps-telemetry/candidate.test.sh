#!/usr/bin/env bash
# Teste do candidate.sh com docker falso (sem Docker de verdade): a lista que o deploy passa é conferida contra o
# `config --services` do compose.yml.new antes de subir qualquer coisa; a listagem só vale estável (duas leituras
# seguidas iguais, até 3); o `up` grava a lista em .candidates e o `smoke` e o `down` a reusam (incidente de 18/11/2026:
# o `up` listou dois candidatos, o `smoke` três).
#
#   bash infra/vps-telemetry/candidate.test.sh
# shellcheck disable=SC2034 # r é lido nas condições de `confere`, que o shellcheck não enxerga (eval)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/stack"
touch "$work/stack/compose.dados.yml"

# docker falso. `config --services` devolve as leituras de CONFIG_SEQ em ordem (separadas por |, nomes sem o sufixo
# -candidate; ERR = falha; a última se repete); o resto só fica registrado em calls.log
cat >"$work/bin/docker" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >>"$WORK/calls.log"
args=" $* "
case "$args" in
  *" config --services "*)
    n=$(($(cat "$WORK/reads" 2>/dev/null || echo 0) + 1))
    echo "$n" >"$WORK/reads"
    IFS='|' read -r -a seq <<<"$CONFIG_SEQ"
    i=$((n - 1))
    [ "$i" -lt "${#seq[@]}" ] || i=$((${#seq[@]} - 1))
    [ "${seq[$i]}" != ERR ] || { echo "erro de faz de conta" >&2; exit 1; }
    printf '%s
' agents api
    for s in ${seq[$i]}; do echo "$s-candidate"; done
    ;;
  *" config -q "*) echo "aviso de faz de conta do config" ;;
  *" config "*) echo "name: galaxie-sports" ;;
  *" ps -aq --filter "*) ;;
  *" ps -aq "*) echo "id-${*: -1}" ;;
  " inspect "*) echo healthy ;;
  *" exec -T "*" node - "*) cat >/dev/null ;;
esac
exit 0
FAKE
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" WORK="$work" CANDIDATE_CONFIG_PAUSE=0 CANDIDATE_TIMEOUT=5
cd "$work/stack" || exit 1
echo 'echo smoke' >smoke.mjs

fails=0
confere() {
  if (eval "$2") >/dev/null 2>&1; then echo "ok   $1"; else
    echo "FALHA $1"
    sed 's/^/      /' "$work/out.log"
    fails=$((fails + 1))
  fi
}
cand() { bash "$here/candidate.sh" "$@" >"$work/out.log" 2>&1; }
limpa() { rm -f "$work/calls.log" "$work/reads" .candidates; }
ups() { grep ' up -d ' "$work/calls.log" || true; }

# ── up com a lista do deploy ─────────────────────────────────────────────────────────────────────────────────
limpa
export CONFIG_SEQ="api site console"
cand up api site console && r=0 || r=$?
confere "lista passada e config completo: sobe os três" \
  '[ "$r" = 0 ] && grep -q "^candidato healthy: api-candidate site-candidate console-candidate$" "$work/out.log" && ups | grep -q "up -d --no-deps --force-recreate --quiet-pull api-candidate site-candidate console-candidate$"'
confere "o up grava a lista efetiva em .candidates" '[ "$(cat .candidates)" = "$(printf "api-candidate\nsite-candidate\nconsole-candidate")" ]'
confere "duas leituras iguais bastam" '[ "$(cat "$work/reads")" = 2 ]'

limpa
export CONFIG_SEQ="api site"
cand up api site console && r=0 || r=$?
confere "lista passada e config sem o console: FAIL antes do up" \
  '[ "$r" = 1 ] && grep -q "^FAIL  candidato: o compose.yml.new não lista console-candidate (config --services devolveu: agents api api-candidate site-candidate)$" "$work/out.log" && [ -z "$(ups)" ] && [ ! -e .candidates ]'
confere "a falha imprime o config -q para o log" 'grep -q "config -q" "$work/out.log" && grep -q "aviso de faz de conta do config" "$work/out.log"'

limpa
export CONFIG_SEQ="api site|api site console|api site console"
cand up api site console && r=0 || r=$?
confere "config instável (1ª leitura sem o console): lê de novo e segue quando estabiliza" \
  '[ "$r" = 0 ] && grep -q "^WARN  candidato: config --services mudou da leitura 1 para a 2" "$work/out.log" && ups | grep -q "api-candidate site-candidate console-candidate$" && [ "$(cat "$work/reads")" = 3 ]'

limpa
export CONFIG_SEQ="api site console|console api site"
cand up api site console && r=0 || r=$?
confere "mesmos nomes em outra ordem (o compose itera um mapa): conta como estável, sem aviso"   '[ "$r" = 0 ] && ! grep -q "mudou da leitura" "$work/out.log" && ups | grep -q "api-candidate site-candidate console-candidate$" && [ "$(cat "$work/reads")" = 2 ]'

limpa
export CONFIG_SEQ="ERR|api site console|api site console"
cand up api site console && r=0 || r=$?
confere "leitura com erro não conta: segue com as duas seguintes iguais" '[ "$r" = 0 ] && grep -q "falhou na leitura 1" "$work/out.log" && ups | grep -q "console-candidate$"'

limpa
export CONFIG_SEQ="api site|api site console|api console"
cand up api site console && r=0 || r=$?
confere "config que não estabiliza em 3 leituras: FAIL sem subir nada" \
  '[ "$r" = 1 ] && grep -q "^FAIL  candidato: config --services do compose.yml.new não estabilizou em 3 leituras" "$work/out.log" && [ -z "$(ups)" ]'

limpa
export CONFIG_SEQ="api site console"
cand up api site-candidate xpto && r=0 || r=$?
confere "nome desconhecido na lista: FAIL sem subir nada" '[ "$r" = 1 ] && grep -q "^FAIL  candidato: xpto-candidate não é um candidato conhecido" "$work/out.log" && [ -z "$(ups)" ]'

# ── sem lista (compatibilidade): descobre pela listagem estável ─────────────────────────────────────────────
limpa
export CONFIG_SEQ="api site|api site console|api site console"
cand up && r=0 || r=$?
confere "sem lista: a 1ª leitura incompleta não vale, sobem os três da listagem estável" \
  '[ "$r" = 0 ] && grep -q "^candidato healthy: api-candidate site-candidate console-candidate$" "$work/out.log"'

# ── smoke e down reusam a lista do up ───────────────────────────────────────────────────────────────────────
limpa
export CONFIG_SEQ="api site console"
printf 'api-candidate\nsite-candidate\n' >.candidates
cand smoke smoke.mjs api site console SMOKE_X=1 && r=0 || r=$?
confere "smoke lê a lista do .candidates (não lista de novo nem usa os argumentos)" \
  '[ "$r" = 0 ] && grep -q "^smoke no site-candidate$" "$work/out.log" && ! grep -q "console-candidate" "$work/out.log" && [ ! -e "$work/reads" ]'
confere "smoke passa VAR=valor ao contêiner" 'grep -q "exec -T -e SMOKE_PHASE=candidate -e SMOKE_X=1 site-candidate node -" "$work/calls.log"'

limpa
export CONFIG_SEQ="api site"
cand smoke smoke.mjs api site console && r=0 || r=$?
confere "smoke sem .candidates: usa a lista dos argumentos" \
  '[ "$r" = 0 ] && grep -q "^smoke no site-candidate$" "$work/out.log" && grep -q "^smoke no console-candidate$" "$work/out.log" && [ ! -e "$work/reads" ]'

limpa
export CONFIG_SEQ="api site console"
cand smoke smoke.mjs && r=0 || r=$?
confere "smoke sem .candidates nem argumentos: descobre pela listagem estável" \
  '[ "$r" = 0 ] && grep -q "^smoke no console-candidate$" "$work/out.log" && [ "$(cat "$work/reads")" = 2 ]'

limpa
export CONFIG_SEQ="api site console"
printf 'api-candidate\nsite-candidate\n' >.candidates
cand down api site console && r=0 || r=$?
confere "down usa o .candidates e o apaga no fim" \
  '[ "$r" = 0 ] && grep -q "rm -sf api-candidate site-candidate$" "$work/calls.log" && [ ! -e .candidates ]'

limpa
export CONFIG_SEQ="ERR"
cand down && r=0 || r=$?
confere "down sem lista e com config quebrado: avisa e tira pelo rótulo" \
  '[ "$r" = 0 ] && grep -q "^WARN  candidato: sem a lista dos candidatos" "$work/out.log" && grep -q "label=com.docker.compose.service=console-candidate" "$work/calls.log"'

# ── o roteiro do deploy: up com a lista, smoke e down sem recalcular ────────────────────────────────────────
limpa
export CONFIG_SEQ="api site console|api site console|api site"
cand up api site console && r=0 || r=$?
cand smoke smoke.mjs api site console && r2=0 || r2=$?
confere "listagem que muda depois do up não muda o smoke (usa o .candidates)" \
  '[ "$r" = 0 ] && [ "$r2" = 0 ] && grep -q "^smoke no console-candidate$" "$work/out.log" && [ "$(cat "$work/reads")" = 2 ]'

echo
if [ "$fails" -gt 0 ]; then
  echo "$fails falha(s)"
  exit 1
fi
echo "candidate.sh: tudo ok"
