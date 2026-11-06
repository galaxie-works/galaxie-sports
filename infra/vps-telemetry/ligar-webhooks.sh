#!/usr/bin/env bash
# Liga os webhooks para clientes na produção (issue #360).
#
#   cd /docker/galaxie-sports && bash ligar-webhooks.sh                          # liga e confere
#   cd /docker/galaxie-sports && bash ligar-webhooks.sh --teste <tenant> <url>   # idem + entrega de teste real
#
# O que faz, nesta ordem (pode rodar de novo quantas vezes quiser; o que já está feito é pulado):
#   1. KEK (WEBHOOK_SIGNING_SECRET): se o .env não tem, gera uma (openssl rand -base64 32), faz backup do .env
#      (.env.bak-webhooks-<data>) e grava a linha. A KEK aparece UMA vez na tela: guarde no cofre de senhas.
#   2. Troca lado a lado (rolling-swap.sh, em /tmp: copie infra/vps-telemetry/rolling-swap.sh para lá) a api e o
#      worker `webhooks` (e site e console, se o compose já passa a KEK a eles) para lerem a KEK, e
#      confere se o aviso "WEBHOOK_SIGNING_SECRET não definida" sumiu do log do worker.
#   3. `webhook seal-secrets`: cifra os segredos legados em texto puro, se houver. Sem falhas, liga
#      WEBHOOK_REJECT_PLAINTEXT_SECRETS=true e recria o worker de novo.
#   4. Confere o que chegou com o deploy do PR dos webhooks: métricas galaxie_webhook_* no Prometheus, os 4 alertas
#      carregados e a aba Webhooks no painel do cliente.
#   5. Com --teste: cadastra um webhook no tenant (tópicos score,status), põe uma entrega de teste (webhook.test) na
#      fila e espera o worker entregar. Use um receptor seu (ex.: uma URL do webhook.site). O segredo aparece na tela.
#
# NÃO mexe em: banco além dos webhooks, outros serviços, imagens, volumes. O resumo vai para /tmp/webhooks.txt (sem a
# KEK nem segredos).
set -uo pipefail
cd /docker/galaxie-sports || exit 1

TESTE_TENANT="" TESTE_URL=""
if [ "${1:-}" = --teste ]; then
  TESTE_TENANT="${2:-}" TESTE_URL="${3:-}"
  if [ -z "$TESTE_TENANT" ] || [ -z "$TESTE_URL" ]; then
    echo "uso: bash ligar-webhooks.sh --teste <slug do tenant> <https://url-de-teste>"; exit 1
  fi
fi

LOG=/tmp/webhooks.txt
: > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }
h() { say; say "=== $*"; }
ok() { say "  OK    $*"; }
warn() { say "  AVISO $*"; }
fail() { say "  FALHA $*"; }
wh() { docker compose run --rm --no-deps -T webhooks node dist/cli/webhook.js "$@"; }
psql_q() { docker exec -i galaxie-sports-dados-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -A -t -q' ; }
envval() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }
setenv() { # setenv CHAVE valor: troca a linha ou acrescenta no fim
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '\n%s=%s\n' "$1" "$2" >> .env; fi
}
backup_env() {
  [ -n "${BACKUP_DONE:-}" ] && return
  cp -p .env ".env.bak-webhooks-$(date +%Y%m%d-%H%M%S)" && BACKUP_DONE=1 && ok "backup do .env feito"
}

h "agora: $(date -u +%FT%TZ)  versão no ar: $(envval IMAGE_TAG | cut -c1-8)"

# ── 1. KEK ───────────────────────────────────────────────────────────────────────────────────────────────────
h "1. chave de cifra (WEBHOOK_SIGNING_SECRET)"
kek="$(envval WEBHOOK_SIGNING_SECRET)"
if [ -n "$kek" ]; then
  first="${kek%%,*}"
  if [ "${#first}" -ge 32 ]; then ok "já está no .env (${#first} caracteres)"
  else fail "a KEK do .env tem só ${#first} caracteres (mínimo 32). Corrija à mão e rode de novo."; exit 1; fi
else
  backup_env
  kek="$(openssl rand -base64 32)"
  setenv WEBHOOK_SIGNING_SECRET "$kek"
  ok "KEK nova gravada no .env"
  echo
  echo "  ┌──────────────────────────────────────────────────────────────────────────────┐"
  echo "  │ GUARDE NO COFRE DE SENHAS AGORA (não vai para o log nem aparece de novo):    │"
  echo "  │   WEBHOOK_SIGNING_SECRET=$kek"
  echo "  │ Sem ela, os segredos dos clientes não abrem se o .env se perder.             │"
  echo "  └──────────────────────────────────────────────────────────────────────────────┘"
  echo
  read -r -p "  Guardou? Tecle Enter para seguir. " _ </dev/tty || true
fi
unset kek first

# ── 2. worker e demo ─────────────────────────────────────────────────────────────────────────────────────────
h "2. worker de webhooks (e demo) lendo a KEK"
painel=""
if docker compose config 2>/dev/null | awk '/^  site:/{d=1} d&&/^  [a-z]/&&!/^  site:/{d=0} d' | grep -q WEBHOOK_SIGNING_SECRET; then
  painel=1
fi
svcs="api webhooks"; [ -n "$painel" ] && svcs="api webhooks site console"
[ -f /tmp/rolling-swap.sh ] || { echo "falta /tmp/rolling-swap.sh: copie infra/vps-telemetry/rolling-swap.sh da repo para /tmp"; exit 1; }
if bash /tmp/rolling-swap.sh $svcs >/tmp/rolling-swap-webhooks.log 2>&1; then ok "trocados lado a lado: $svcs"
else
  # sem a troca, o worker no ar pode não ter a KEK: cifrar agora deixaria as entregas falhando até a DLQ
  fail "rolling-swap de $svcs (veja /tmp/rolling-swap-webhooks.log). Parei antes de cifrar os segredos."; exit 1
fi
sleep 8
if [ "$(docker compose exec -T webhooks sh -c 'printf %s "${WEBHOOK_SIGNING_SECRET:-}" | wc -c')" -ge 32 ] 2>/dev/null; then
  ok "o worker enxerga a KEK"
else
  fail "o worker NÃO enxerga a KEK: confira se o compose.yml no ar repassa WEBHOOK_SIGNING_SECRET ao serviço webhooks. Parei antes de cifrar os segredos."
  exit 1
fi
if docker compose logs --since 10m webhooks 2>&1 | grep -q 'não definida'; then
  fail "o log ainda avisa que a KEK não está definida. Parei antes de cifrar os segredos."; exit 1
else ok "sem o aviso de KEK ausente no log"; fi
docker compose logs --since 10m webhooks 2>&1 | grep -q 'worker iniciado' && ok "worker iniciado" || warn "não vi 'worker iniciado' no log dos últimos 10 min"
if [ -n "$painel" ]; then ok "demo com a KEK: o cadastro em /cliente/webhooks fica liberado"
else warn "a versão no ar ainda não tem o painel de webhooks (chega com o deploy do PR). Rode este script de novo depois."; fi

# ── 3. segredos legados ──────────────────────────────────────────────────────────────────────────────────────
h "3. segredos dos endpoints"
wh list 2>&1 | sed 's/^/  /' | tee -a "$LOG"
seal="$(wh seal-secrets 2>&1)"; rc=$?
echo "$seal" | sed 's/^/  /' | tee -a "$LOG"
if [ $rc -ne 0 ]; then
  fail "seal-secrets falhou para algum endpoint: veja acima (docs/runbooks/webhooks.md)"
elif [ "$(envval WEBHOOK_REJECT_PLAINTEXT_SECRETS)" = true ]; then
  ok "WEBHOOK_REJECT_PLAINTEXT_SECRETS já ligado"
else
  backup_env
  setenv WEBHOOK_REJECT_PLAINTEXT_SECRETS true
  docker compose up -d --no-deps --force-recreate webhooks >/dev/null 2>&1
  ok "WEBHOOK_REJECT_PLAINTEXT_SECRETS=true ligado e worker recriado"
fi
legado="$(echo "select count(*) from api.webhook_endpoint where secret not like 'enc:v1:%';" | psql_q | tr -d ' ')"
[ "${legado:-0}" = 0 ] && ok "nenhum segredo em texto puro no banco" || warn "$legado segredo(s) ainda em texto puro"

# ── 4. métricas, alertas e painel (chegam com o deploy do PR) ───────────────────────────────────────────────
h "4. métricas e alertas"
prom() { docker exec galaxie-sports-obs-prometheus-1 wget -qO- "http://127.0.0.1:9090/api/v1/$1" 2>/dev/null; }
if prom 'query?query=galaxie_webhook_overdue_seconds' | grep -q '"result":\[{'; then
  ok "galaxie_webhook_overdue_seconds no Prometheus: $(prom 'query?query=galaxie_webhook_overdue_seconds' | grep -o '"value":\[[^]]*\]' | head -1)"
else
  warn "métricas galaxie_webhook_* ainda não aparecem (chegam com o deploy do PR; o scrape leva até 1 min)"
fi
n="$(prom 'rules?type=alert' | grep -oE 'Webhook(WorkerDown|DeadLetters|EndpointFailing|DeliverySlow)' | sort -u | wc -l)"
[ "$n" = 4 ] && ok "os 4 alertas de webhook carregados no Prometheus" || warn "$n de 4 alertas de webhook carregados (o resto chega com o deploy do PR)"

# ── 5. teste real (opcional) ─────────────────────────────────────────────────────────────────────────────────
if [ -n "$TESTE_TENANT" ]; then
  h "5. entrega de teste para $TESTE_URL (tenant $TESTE_TENANT)"
  out="$(wh create --tenant "$TESTE_TENANT" --url "$TESTE_URL" --topics score,status --description 'teste do ligar-webhooks.sh' 2>&1)"
  id="$(echo "$out" | grep -oE 'Webhook [0-9a-f-]{36}' | cut -d' ' -f2)"
  if [ -z "$id" ]; then fail "cadastro recusado:"; echo "$out" | sed 's/^/    /' | tee -a "$LOG"
  else
    ok "webhook $id cadastrado"
    echo "$out" | grep -A2 'Segredo' | sed 's/^/    /'   # só na tela, não no log
    echo "insert into api.webhook_delivery (endpoint_id, change_id, topic, payload)
          values ('$id', -(extract(epoch from now()) * 1000)::bigint, 'webhook.test',
                  jsonb_build_object('id', 'teste', 'topic', 'webhook.test', 'test', true, 'event_id', null,
                    'sport', null, 'competition_id', null, 'changed', '[]'::jsonb,
                    'data', jsonb_build_object('message', 'Entrega de teste do Galaxie Sports'),
                    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')));" | psql_q
    st=""
    for _ in $(seq 1 20); do
      sleep 2
      st="$(echo "select status || ' ' || attempts || ' ' || coalesce(response_code::text, '-') || ' ' || coalesce(last_error, '')
                  from api.webhook_delivery where endpoint_id = '$id' order by id desc limit 1;" | psql_q)"
      case "$st" in delivered*|dead*) break ;; pending\ [1-9]*) break ;; esac
    done
    case "$st" in
      delivered*) ok "entregue: $st (confira no receptor o header x-galaxie-event: webhook.test)" ;;
      *) fail "não entregou em 40 s: ${st:-sem entrega}. Veja docker compose logs webhooks" ;;
    esac
    say "  Para tirar o webhook de teste: docker compose run --rm --no-deps -T webhooks node dist/cli/webhook.js disable --id $id"
  fi
fi

h "resumo salvo em $LOG"
