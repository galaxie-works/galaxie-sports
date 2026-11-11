#!/usr/bin/env bash
# Teste do ensure-secrets.sh: gera só o que falta, nunca troca o que existe, não mostra valor e o .env fica 600.
#
#   bash infra/vps-telemetry/ensure-secrets.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail=0
ok() { echo "ok    $1"; }
ko() {
  echo "FAIL  $1"
  fail=1
}
val() { sed -n "s/^$1=//p" "$WORK/.env" | tail -n 1; }

cat > "$WORK/.env" <<'ENV'
API_DOMAIN=api.example.test
FAN_TOKEN_SECRET=
STREAM_TOKEN_SECRET=ja-definido-0123456789abcdef0123456789abcdef
BETTER_AUTH_SECRET=troque-por-openssl-rand-hex-32
METRICS_TOKEN=troque-por-um-segredo
STRIPE_SECRET_KEY=
ENV
chmod 644 "$WORK/.env"

out="$(cd "$WORK" && bash "$HERE/ensure-secrets.sh")"
fan="$(val FAN_TOKEN_SECRET)"
auth="$(val BETTER_AUTH_SECRET)"

[[ "$fan" =~ ^[0-9a-f]{64}$ ]] && ok "vazio vira 64 hex" || ko "FAN_TOKEN_SECRET não foi gerado: '$fan'"
[[ "$auth" =~ ^[0-9a-f]{64}$ ]] && ok "valor de exemplo vira 64 hex" || ko "BETTER_AUTH_SECRET segue de exemplo"
[ "$(val STREAM_TOKEN_SECRET)" = ja-definido-0123456789abcdef0123456789abcdef ] && ok "valor existente fica" ||
  ko "STREAM_TOKEN_SECRET mudou"
[ "$(val METRICS_TOKEN)" = troque-por-um-segredo ] && ok "METRICS_TOKEN só avisa" || ko "METRICS_TOKEN mudou"
[[ "$out" == *"WARN  METRICS_TOKEN"* ]] && ok "aviso do METRICS_TOKEN" || ko "sem aviso do METRICS_TOKEN"
[ -z "$(val STRIPE_SECRET_KEY)" ] && ok "chave de fornecedor fica vazia" || ko "STRIPE_SECRET_KEY foi gerada"
[ "$(val API_DOMAIN)" = api.example.test ] && ok "o resto do .env fica" || ko "API_DOMAIN mudou"
[ "$(grep -c '^FAN_TOKEN_SECRET=' "$WORK/.env")" = 1 ] && ok "uma linha por chave" || ko "FAN_TOKEN_SECRET duplicado"
[[ "$out" != *"$fan"* && "$out" != *"$auth"* ]] && ok "valor não aparece na saída" || ko "valor vazou na saída"
[ "$(stat -c %a "$WORK/.env")" = 600 ] && ok ".env com 600" || ko ".env com $(stat -c %a "$WORK/.env")"
ls "$WORK"/.env.segredos.* >/dev/null 2>&1 && ko "sobrou arquivo temporário" || ok "sem temporário"

out2="$(cd "$WORK" && bash "$HERE/ensure-secrets.sh")"
[ "$(val FAN_TOKEN_SECRET)" = "$fan" ] && [ "$(val BETTER_AUTH_SECRET)" = "$auth" ] && ok "segunda rodada não troca" ||
  ko "segunda rodada trocou um segredo"
[[ "$out2" == *"todos definidos"* ]] && ok "segunda rodada: nada a gerar" || ko "segunda rodada: '$out2'"

# forma que o compose aceita mas o script não troca com segurança: para sem mexer
printf 'export STREAM_TOKEN_SECRET=em-uso\nFAN_TOKEN_SECRET=\n' > "$WORK/export.env"
before="$(cat "$WORK/export.env")"
if (cd "$WORK" && bash "$HERE/ensure-secrets.sh" export.env >/dev/null); then ko "export passou"; else ok "export falha"; fi
[ "$(cat "$WORK/export.env")" = "$before" ] && ok "export: .env intocado" || ko "export: .env mudou"
printf 'BETTER_AUTH_SECRET = em-uso\n' > "$WORK/espaco.env"
if (cd "$WORK" && bash "$HERE/ensure-secrets.sh" espaco.env >/dev/null); then ko "espaços passou"; else ok "espaços falha"; fi

if (cd "$WORK" && bash "$HERE/ensure-secrets.sh" nao-existe.env >/dev/null); then ko "arquivo ausente passou"; else ok "arquivo ausente falha"; fi

exit $fail
