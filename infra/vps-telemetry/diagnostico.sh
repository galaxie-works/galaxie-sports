#!/usr/bin/env bash
# Diagnóstico de alerta, SÓ LEITURA. É o único comando que a chave de diagnóstico (VPS_DIAG_SSH_KEY, ambiente
# `producao` do GitHub) pode rodar na VPS: o authorized_keys força este script (command="…/diagnostico.sh",restrict).
# O deploy grava a versão do SHA publicado em /docker/galaxie-sports/diagnostico.sh. Quem chama é o workflow
# .github/workflows/diagnostico.yml, disparado quando um alerta abre ou reabre a issue (infra/ops/alerta-issue.sh).
#
# O pedido chega em SSH_ORIGINAL_COMMAND (ou nos argumentos, rodando à mão): o nome do alerta e rótulos opcionais,
# ex. "LiveEventStale sport=football" ou "JobFailingRepeatedly job=recap-run". Nada do pedido é executado: o nome
# escolhe um bloco de consultas fixas (case abaixo) e os valores só entram como texto já validado.
#
# Regras do script (não afrouxar):
# - SQL sempre em transação somente leitura (`set default_transaction_read_only = on`), com timeout;
# - nunca imprime o .env nem segredo: só o que as consultas e os logs mostram;
# - nada de docker compose up/restart/exec que escreva; o exec só roda psql de leitura e wget no Prometheus.
set -uo pipefail
cd /docker/galaxie-sports || exit 1

REQ="${SSH_ORIGINAL_COMMAND:-$*}"
# só letras, números, espaço, = - _ . : (sem aspas, $, ;, |, crase…)
if ! [[ "$REQ" =~ ^[A-Za-z0-9\ =_.:-]{0,200}$ ]]; then
  echo "pedido recusado: caracteres fora do permitido"
  exit 2
fi
read -r ALERT REST <<<"$REQ"
ALERT="${ALERT:-geral}"
label() { sed -n "s/.*\b$1=\([A-Za-z0-9_.:-]*\).*/\1/p" <<<" $REST"; }
JOB="$(label job)"
SPORT="$(label sport)"
[ -n "$SPORT" ] || SPORT="$(label esporte)"
SLO="$(label slo)"

# sem stdin (o exec do docker compose consumiria o resto); o sql() abaixo usa o stdin de propósito
dc() { docker compose "$@" </dev/null; }
# Postgres e Prometheus estão nos projetos `dados` e `obs`; antes da transição, neste
dados() { if [ -f compose.dados.yml ]; then dc -f compose.dados.yml "$@"; else dc "$@"; fi; }
obs() { if [ -f compose.obs.yml ]; then dc -f compose.obs.yml "$@"; else dc "$@"; fi; }
sql() {
  { echo "set default_transaction_read_only = on; set statement_timeout = '20s';"; cat; } |
    dados exec -T postgres sh -c 'psql -X -q -P pager=off -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' 2>&1 | head -80
}
# PromQL instantânea: imprime "rótulos = valor" por série
prom() {
  local q
  q="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1")"
  obs exec -T prometheus wget -qO- "http://localhost:9090/api/v1/query?query=$q" 2>/dev/null |
    python3 -c 'import json,sys
try:
  r=json.load(sys.stdin)["data"]["result"]
except Exception as e:
  print("  (sem resposta do Prometheus)"); sys.exit()
for s in r[:30]:
  m={k:v for k,v in s["metric"].items() if k not in ("__name__","instance","job","service")}
  print("  ", m or "", "=", s["value"][1][:10])
if not r: print("   (vazio)")'
}
logs() { dc logs --no-log-prefix --since "$2" "$1" 2>/dev/null; }
section() { printf '\n== %s\n' "$*"; }

echo "Diagnóstico de \"$ALERT\"${REST:+ ($REST)} em $(date -u +%FT%TZ) · versão $(sed -n 's/^\(DEPLOY_SHA\|IMAGE_TAG\)=//p' .env | head -n 1 | cut -c1-8)"

section "Alertas disparando agora (Prometheus)"
obs exec -T prometheus wget -qO- http://localhost:9090/api/v1/alerts 2>/dev/null |
  python3 -c 'import json,sys
a=[x for x in json.load(sys.stdin)["data"]["alerts"] if x["state"]=="firing"]
for x in a[:20]:
  l=x["labels"]; extra={k:v for k,v in l.items() if k not in ("alertname","severity")}
  print("  ", l.get("alertname"), l.get("severity",""), extra or "", "desde", x.get("activeAt","")[:16])
if not a: print("   nenhum")'

section "Contêineres e máquina"
dc ps --format '{{.Service}}: {{.Status}}' | sed 's/^/   /'
uptime | sed 's/^/   /'
df -h / | tail -1 | sed 's/^/   disco: /'

live_block() {
  section "Plano do ao vivo (últimas linhas do dia)"
  logs ingestor 30m | grep '"msg":"plano ao vivo do dia"' | tail -2 |
    python3 -c 'import json,sys
for l in sys.stdin:
  d=json.loads(l); print("  ", {k:d.get(k) for k in ("day","live_budget","daily_protected","included","relevant","window_minutes","interval_s","ticks_left")})'
  section "Ao vivo: jogos e atraso máx por cobertura"
  prom 'galaxie_live_events'
  prom 'galaxie_live_event_max_staleness_seconds'
  prom 'galaxie_live_poll_interval_seconds'
  section "Jogos em andamento sem atualização há mais de 10 min (todos os esportes; os de relógio fecham no pós-jogo)"
  sql <<'SQL'
select c.name as competicao, c.live_priority, e.status, e.starts_at::time(0) as inicio,
       (now() - e.updated_at)::interval(0) as sem_atualizar
from core.event e join core.competition c on c.id = e.competition_id
where e.status in ('live','break','starting') and e.starts_at > now() - interval '6 hours'
  and e.updated_at < now() - interval '10 minutes'
order by e.updated_at limit 15;
SQL
  section "Configuração do ao vivo e do pós-jogo (sobrescritas do painel)"
  sql <<'SQL'
select key, value, updated_at::timestamp(0) from ops.runtime_setting where key like 'LIVE_%' or key like 'POSTGAME_%' order by key;
SQL
}

slo_block() {
  section "SLO ${SLO:-todos}: erro por janela (meta: 1 - objetivo)"
  for w in 30m 6h 1d 3d; do
    printf '   %s:' "$w"; prom "slo:sli_error:ratio_rate$w${SLO:+{slo=\"$SLO\"\}}" | tr -d '\n'; echo
  done
  prom "slo:sli_error:ratio_28d${SLO:+{slo=\"$SLO\"\}}"
}

job_block() {
  section "Execuções recentes ${JOB:+do job $JOB }(ops.job_run, 24 h)"
  # o nome do job do scheduler usa hífen (recap-run) e o do job_run, dois-pontos (recap:run): as duas formas
  local j="${JOB:-}"
  sql <<SQL
select job, status, started_at::timestamp(0), (finished_at - started_at)::interval(0) as duracao,
       left(coalesce(error, stats->>'reason', ''), 160) as erro
from ops.job_run
where started_at > now() - interval '24 hours'
  and ('$j' = '' or job in ('$j', replace('$j', '-', ':')))
  and ('$j' <> '' or status not in ('ok', 'running'))
order by started_at desc limit 15;
SQL
  section "Log do ingestor e dos agentes: erros na última hora"
  for s in ingestor agents; do
    logs "$s" 60m | grep -E '"level":"(error|fatal)"' | grep -oE '"msg":"[^"]{0,120}"' | sort | uniq -c | sort -rn | head -6 | sed "s/^/   $s /"
  done
}

api_block() {
  section "API: p95 por rota (15 min) e tráfego"
  prom 'topk(8, histogram_quantile(0.95, sum by (le, route) (rate(galaxie_http_request_duration_seconds_bucket{route!~"/metrics|/health.*"}[15m]))))'
  prom 'topk(8, sum by (route) (rate(galaxie_http_request_duration_seconds_count{route!~"/metrics|/health.*"}[15m])))'
  section "Postgres: consultas ativas há mais de 2 s e locks esperando"
  sql <<'SQL'
select application_name, state, (now()-query_start)::interval(0) as dur, wait_event_type,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) as q
from pg_stat_activity where state = 'active' and now()-query_start > interval '2 seconds' and datname = current_database();
select count(*) as locks_esperando from pg_locks where not granted;
SQL
  section "Log da API: erros na última hora"
  logs api 60m | grep -E '"level":"(error|fatal)"' | grep -oE '"msg":"[^"]{0,120}"' | sort | uniq -c | sort -rn | head -8 | sed 's/^/   /'
}

ai_block() {
  section "IA: gasto e falhas de hoje (ops.llm_usage)"
  sql <<'SQL'
select agent, count(*) as chamadas, round(sum(cost_usd)::numeric, 3) as usd,
       count(*) filter (where error is not null) as com_erro, max(left(error, 80)) as um_erro
from ops.llm_usage where day_utc = current_date group by 1 order by 3 desc nulls last limit 12;
SQL
}

disk_block() {
  section "Disco: uso do Docker e maiores volumes"
  docker system df 2>/dev/null | sed 's/^/   /'
  du -xsh /var/lib/docker/volumes/galaxie-sports_* 2>/dev/null | sort -h | tail -6 | sed 's/^/   /'
  du -xsh /var/log /root /tmp 2>/dev/null | sed 's/^/   /'
}

backup_block() {
  section "Backup: dumps mais recentes e serviço"
  docker run --rm -v galaxie-sports_backups:/b:ro alpine:3 ls -lt /b 2>/dev/null | head -6 | sed 's/^/   /'
  logs backup 26h | grep -E '"level":"(error|warn)"|FAIL|falh' | tail -5 | cut -c1-200 | sed 's/^/   /'
}

quota_block() {
  section "Cota da api-sports hoje por API e prioridade (ops.quota_ledger)"
  sql <<'SQL'
select api, priority, count(*) as chamadas, count(*) filter (where outcome <> 'ok') as falhas
from ops.quota_ledger where day_utc = current_date group by 1, 2 order by 1, 3 desc;
SQL
}

# ProducaoAtrasada: por que o deploy não chegou aqui. A trava do deploy (mesma do deploy.sh e do deploy-gh.sh) e a imagem
# que cada serviço roda de fato
deploy_block() {
  section "Trava do deploy na VPS"
  if [ -d .deploy.lock ]; then
    echo "   trava ocupada há $(( ($(date +%s) - $(stat -c %Y .deploy.lock)) / 60 )) min (mais de 90 min = deploy morto, o próximo a toma); dono (id, SHA, hora):"
    sed 's/^/   /' .deploy.lock/owner 2>/dev/null | head -5
  else
    echo "   livre"
  fi
  section "Imagem de cada serviço no ar"
  dc ps --format '{{.Service}}: {{.Image}} ({{.Status}})' | sed 's/^/   /'
}

case "$ALERT" in
  ProducaoAtrasada) deploy_block ;;
  LiveEventStale | FootballRawStale) live_block; quota_block ;;
  SloBurnRateFast | SloBurnRateSlow | ErrorBudgetExhausted)
    slo_block
    case "$SLO" in
      ao-vivo) live_block ;;
      api-*) api_block ;;
      backup) backup_block ;;
      frescor-diario) job_block ;;
    esac
    ;;
  ApiDown | ApiLatencyP95High | ApiRouteLatencyP99High | SseProcessLimitReached | ChangeFeedStalled | ChangeFeedGapAbandoned)
    api_block
    ;;
  JobFailingRepeatedly | JobOverdue | SchedulerHeartbeatStale) job_block ;;
  AiCreditExhausted | AiCreditCheckStale | AiSpendNearDailyBudget) ai_block; job_block ;;
  DiskAlmostFull | DiskFillingUp | DatabaseGrowingFast) disk_block ;;
  BackupStale | BackupCheckFailed | RestoreDrillFailed | RestoreDrillStale) backup_block ;;
  QuotaBelow20Percent) quota_block ;;
  *) job_block; api_block ;;
esac
