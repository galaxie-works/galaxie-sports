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
kek="$(val SETTINGS_KEK)"

[[ "$fan" =~ ^[0-9a-f]{64}$ ]] && ok "vazio vira 64 hex" || ko "FAN_TOKEN_SECRET não foi gerado: '$fan'"
[[ "$auth" =~ ^[0-9a-f]{64}$ ]] && ok "valor de exemplo vira 64 hex" || ko "BETTER_AUTH_SECRET segue de exemplo"
[ "$(val STREAM_TOKEN_SECRET)" = ja-definido-0123456789abcdef0123456789abcdef ] && ok "valor existente fica" ||
  ko "STREAM_TOKEN_SECRET mudou"
[[ "$kek" =~ ^[0-9a-f]{64}$ ]] && ok "SETTINGS_KEK ausente vira 64 hex" || ko "SETTINGS_KEK não foi gerada: '$kek'"
[[ "$out" == *"WARN  SETTINGS_KEK nova"* ]] && ok "aviso de guardar a SETTINGS_KEK nova" || ko "sem aviso da SETTINGS_KEK nova"
[ "$(val METRICS_TOKEN)" = troque-por-um-segredo ] && ok "METRICS_TOKEN só avisa" || ko "METRICS_TOKEN mudou"
[[ "$out" == *"WARN  METRICS_TOKEN"* ]] && ok "aviso do METRICS_TOKEN" || ko "sem aviso do METRICS_TOKEN"
[ -z "$(val STRIPE_SECRET_KEY)" ] && ok "chave de fornecedor fica vazia" || ko "STRIPE_SECRET_KEY foi gerada"
[ "$(val API_DOMAIN)" = api.example.test ] && ok "o resto do .env fica" || ko "API_DOMAIN mudou"
[ "$(grep -c '^FAN_TOKEN_SECRET=' "$WORK/.env")" = 1 ] && ok "uma linha por chave" || ko "FAN_TOKEN_SECRET duplicado"
[[ "$out" != *"$fan"* && "$out" != *"$auth"* && "$out" != *"$kek"* ]] && ok "valor não aparece na saída" || ko "valor vazou na saída"
[ "$(stat -c %a "$WORK/.env")" = 600 ] && ok ".env com 600" || ko ".env com $(stat -c %a "$WORK/.env")"
ls "$WORK"/.env.segredos.* >/dev/null 2>&1 && ko "sobrou arquivo temporário" || ok "sem temporário"

out2="$(cd "$WORK" && bash "$HERE/ensure-secrets.sh")"
[ "$(val FAN_TOKEN_SECRET)" = "$fan" ] && [ "$(val BETTER_AUTH_SECRET)" = "$auth" ] && [ "$(val SETTINGS_KEK)" = "$kek" ] && ok "segunda rodada não troca" ||
  ko "segunda rodada trocou um segredo"
[[ "$out2" == *"todos definidos"* ]] && ok "segunda rodada: nada a gerar" || ko "segunda rodada: '$out2'"

# SETTINGS_KEK em rotação (nova,antiga) é valor em uso: nunca muda, e sem aviso de chave nova
printf 'FAN_TOKEN_SECRET=\nSETTINGS_KEK=nova-0123456789abcdef0123456789abcdef,antiga-0123456789abcdef0123456789ab\n' > "$WORK/kek.env"
out3="$(cd "$WORK" && bash "$HERE/ensure-secrets.sh" kek.env)"
[ "$(sed -n 's/^SETTINGS_KEK=//p' "$WORK/kek.env" | tail -n 1)" = nova-0123456789abcdef0123456789abcdef,antiga-0123456789abcdef0123456789ab ] &&
  ok "SETTINGS_KEK existente fica" || ko "SETTINGS_KEK existente mudou"
[[ "$out3" != *"SETTINGS_KEK nova"* ]] && ok "sem aviso quando a KEK já existe" || ko "aviso de KEK nova com KEK existente"

# SETTINGS_KEK presente e vazia, ou só com aspas: gera
printf 'SETTINGS_KEK=\n' > "$WORK/kek-vazia.env"
(cd "$WORK" && bash "$HERE/ensure-secrets.sh" kek-vazia.env >/dev/null)
[[ "$(sed -n 's/^SETTINGS_KEK=//p' "$WORK/kek-vazia.env" | tail -n 1)" =~ ^[0-9a-f]{64}$ ]] && ok "SETTINGS_KEK= vazia vira 64 hex" ||
  ko "SETTINGS_KEK= vazia não foi gerada"
printf 'SETTINGS_KEK=""\n' > "$WORK/kek-aspas.env"
(cd "$WORK" && bash "$HERE/ensure-secrets.sh" kek-aspas.env >/dev/null)
[[ "$(sed -n 's/^SETTINGS_KEK=//p' "$WORK/kek-aspas.env" | tail -n 1)" =~ ^[0-9a-f]{64}$ ]] && ok 'SETTINGS_KEK="" vira 64 hex' ||
  ko 'SETTINGS_KEK="" não foi gerada'

# chave repetida com valores diferentes (valor em uso em cima, vazia colada embaixo): para sem apagar a de cima
printf 'SETTINGS_KEK=em-uso-0123456789abcdef0123456789abcdef\nAPI_DOMAIN=x\nSETTINGS_KEK=\n' > "$WORK/dup.env"
before="$(cat "$WORK/dup.env")"
if out4="$(cd "$WORK" && bash "$HERE/ensure-secrets.sh" dup.env)"; then ko "duplicada passou"; else
  [[ "$out4" == *"aparece mais de uma vez"* ]] && ok "duplicada falha" || ko "duplicada falhou por outro motivo: '$out4'"
fi
[ "$(cat "$WORK/dup.env")" = "$before" ] && ok "duplicada: .env intocado" || ko "duplicada: .env mudou"
# exemplo esquecido em cima do valor real: vale a última (como no compose), nada a gerar
printf 'BETTER_AUTH_SECRET=troque-por-x\nBETTER_AUTH_SECRET=real\nFAN_TOKEN_SECRET=a\nSTREAM_TOKEN_SECRET=b\nSETTINGS_KEK=c\n' > "$WORK/exemplo-em-cima.env"
(cd "$WORK" && bash "$HERE/ensure-secrets.sh" exemplo-em-cima.env | grep -q "todos definidos") && ok "exemplo em cima do valor real passa" ||
  ko "exemplo em cima do valor real falhou"
# duas linhas vazias: gera uma só
printf 'SETTINGS_KEK=""\nSETTINGS_KEK=\n' > "$WORK/duas-vazias.env"
(cd "$WORK" && bash "$HERE/ensure-secrets.sh" duas-vazias.env >/dev/null) && [ "$(grep -c '^SETTINGS_KEK=' "$WORK/duas-vazias.env")" = 1 ] &&
  ok "duas linhas vazias viram uma gerada" || ko "duas linhas vazias"
# repetida com o mesmo valor não atrapalha
printf 'FAN_TOKEN_SECRET=\nSTREAM_TOKEN_SECRET=igual\nSTREAM_TOKEN_SECRET=igual\n' > "$WORK/dup-igual.env"
(cd "$WORK" && bash "$HERE/ensure-secrets.sh" dup-igual.env >/dev/null) && ok "repetida com o mesmo valor passa" ||
  ko "repetida com o mesmo valor falhou"

# forma que o compose aceita mas o script não troca com segurança: para sem mexer
printf 'export STREAM_TOKEN_SECRET=em-uso\nFAN_TOKEN_SECRET=\n' > "$WORK/export.env"
before="$(cat "$WORK/export.env")"
if (cd "$WORK" && bash "$HERE/ensure-secrets.sh" export.env >/dev/null); then ko "export passou"; else ok "export falha"; fi
[ "$(cat "$WORK/export.env")" = "$before" ] && ok "export: .env intocado" || ko "export: .env mudou"
printf 'BETTER_AUTH_SECRET = em-uso\n' > "$WORK/espaco.env"
if (cd "$WORK" && bash "$HERE/ensure-secrets.sh" espaco.env >/dev/null); then ko "espaços passou"; else ok "espaços falha"; fi
[ "$(cat "$WORK/espaco.env")" = "BETTER_AUTH_SECRET = em-uso" ] && ok "espaços: .env intocado" || ko "espaços: .env mudou"
printf 'STREAM_TOKEN_SECRET: em-uso\n' > "$WORK/dois-pontos.env"
if (cd "$WORK" && bash "$HERE/ensure-secrets.sh" dois-pontos.env >/dev/null); then ko "dois-pontos passou"; else ok "dois-pontos falha"; fi
# openssl quebrado: para sem gravar chave vazia
mkdir -p "$WORK/bin"
printf '#!/bin/sh\nexit 1\n' > "$WORK/bin/openssl"
chmod +x "$WORK/bin/openssl"
printf 'FAN_TOKEN_SECRET=\n' > "$WORK/openssl.env"
if (cd "$WORK" && PATH="$WORK/bin:$PATH" bash "$HERE/ensure-secrets.sh" openssl.env >/dev/null); then
  ko "openssl quebrado passou"
else
  ok "openssl quebrado falha"
fi
[ "$(cat "$WORK/openssl.env")" = "FAN_TOKEN_SECRET=" ] && ok "openssl quebrado: .env intocado" || ko "openssl quebrado: .env mudou"

if (cd "$WORK" && bash "$HERE/ensure-secrets.sh" nao-existe.env >/dev/null); then ko "arquivo ausente passou"; else ok "arquivo ausente falha"; fi

exit $fail
