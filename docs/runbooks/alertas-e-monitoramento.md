# Alertas e monitoramento: push, resumo diário e monitor externo

Como os alertas de produção chegam ao dono, o que cada um quer dizer e como ligar os canais. Desde o lote 1 da
auditoria de 28/10/2026.

## Visão geral

| Camada | Onde roda | O que vê | Canal |
|---|---|---|---|
| Prometheus + Grafana | Na própria VPS | Banco, jobs, ao vivo, IA, backup, disco, processo da API | Push (ntfy) na hora para o crítico; resumo diário por e-mail para o resto |
| Workflow de deploy | GitHub Actions | Deploy falho, cancelado ou travado (teto de 45 min) | Push (ntfy) pelo mesmo tópico |
| Monitor externo | Better Stack (fora da VPS) | Site, API, demo e assets vistos da internet; a VPS inteira fora do ar | App da Better Stack e e-mail |

O alertador mora na mesma VPS que vigia: se a VPS cair, ele cai junto. Por isso o monitor externo é parte do desenho,
não um extra.

## Os 5 sinais graves (push na hora)

Só alerta `severity: critical` vira push. Cada um tem o rótulo `sinal`, que aparece na notificação.

| Sinal | Alerta | Dispara quando |
|---|---|---|
| `api` | `ApiDown` | O Prometheus não raspa a API há 2 min |
| `api` (de fora) | Monitores da Better Stack | Site, API, demo ou assets sem resposta para a internet |
| `api` (SLO) | `SloBurnRateFast` com `slo` `api-disponibilidade` ou `api-latencia` | A API gasta o orçamento de erro rápido demais: 2% dele em 1 h ou 5% em 6 h ([docs/14](../14-slos-e-error-budget.md)) |
| `ao-vivo` | `LiveEventStale` | Jogo do plano do ao vivo (`coverage="poller"`) sem atualização há mais de 2 intervalos do poller, contados no máximo desde o apito. Jogo fora do catálogo ou de esporte sem ao vivo (`coverage="clock"`) não alerta: o relógio o põe em andamento pelo horário e a fonte só confirma na reconciliação ou na agenda D-1 |
| `ia` | `AiCreditExhausted` | A checagem horária do crédito voltou `fail`: conta sem crédito (402, cota/billing) ou chave recusada (401/403) |
| `ia` | `AiSpendNearDailyBudget` | Gasto do dia de orçamento em 80% ou mais do `AI_DAILY_USD_BUDGET` efetivo |
| `backup-disco` | `BackupStale`, `BackupCheckFailed`, `RestoreDrillFailed`, `DiskAlmostFull` | Backup atrasado, verificação ou ensaio falhando, disco acima de 85% |
| `deploy` | Passo "Aviso por push" do `deploy.yml` | Deploy falhou, foi cancelado ou estourou o teto de 45 min |
| (alertador cego) | `DatasourceError` do Grafana | O Grafana não consegue consultar o Prometheus |

O push repete a cada 3 h enquanto o alerta durar e avisa quando resolve. Todo crítico também entra no resumo diário.
O primeiro passo de cada sinal está no [runbook de on-call](on-call.md).

## Resumo diário (e-mail, 08:00 de Brasília)

O resto é `severity: warning` e sai num e-mail só, uma vez por dia, entre 08:00 e 08:15 de Brasília, com o que está
disparando naquela hora. O que disparou e resolveu de madrugada fica no histórico do Grafana, não no e-mail.

| Alerta | Quer dizer |
|---|---|
| `JobOverdue` | Job sem sucesso há mais de 2 intervalos da agenda efetiva (painel > env > padrão), com piso de 30 min |
| `SchedulerHeartbeatStale` | O scheduler do ingestor ou dos agentes não relata em `ops.runtime_env` há 10 min |
| `JobFailingRepeatedly` | Job com 3 falhas seguidas (saiu do push: o que importa nele já tem sinal próprio) |
| `ChangeFeedStalled` | Cache da demo ou webhooks atrasados mais de 10 min (saiu do push pelo mesmo motivo) |
| `AiCreditCheckStale` | A checagem de crédito não roda há 3 h (contêiner `agents` fora?) |
| `SloBurnRateSlow` | Um SLO gasta o orçamento devagar demais: 10% dele em 1 dia ou em 3 dias ([docs/14](../14-slos-e-error-budget.md)) |
| `SloBurnRateFast` com `slo="ao-vivo"` | Queima rápida do SLO do ao vivo (o push do ao vivo é o `LiveEventStale`) |
| `ErrorBudgetExhausted` | O orçamento de 28 dias de um SLO acabou: vale a política de congelar features do componente |
| `QuotaBelow20Percent`, `FootballRawStale`, `RestoreDrillStale`, `NodeExporterDown`, `MetricsCollectorDown`, `ApiLatencyP95High` | Como antes |

Sem SMTP configurado, o resumo sai no push com prioridade baixa. Sem push configurado, o crítico sai por e-mail na
hora.

## Ligar o push (ntfy)

O ntfy.sh é gratuito e não pede conta: quem conhece o nome do tópico lê e publica nele. O nome é a senha, então ele
precisa ser longo e aleatório, e não vai para o repositório.

1. Gere o nome do tópico na sua máquina:

   ```bash
   echo "galaxie-$(openssl rand -hex 16)"
   ```

2. No celular, instale o app **ntfy** (iOS ou Android), toque em **+** e assine esse tópico no servidor `ntfy.sh`.
   No Android, deixe as notificações de prioridade alta tocarem mesmo no "Não perturbe", se quiser.
3. No `.env` da VPS (`/docker/galaxie-sports/.env`), acrescente:

   ```dotenv
   ALERT_NTFY_URL=https://ntfy.sh/galaxie-<o que o passo 1 gerou>
   ```

4. Recrie o Grafana e confira o log:

   ```bash
   cd /docker/galaxie-sports && docker compose up -d grafana && docker compose logs grafana | grep alertas
   ```

   Esperado: `alertas por push ligados (ntfy): crítico na hora`.
5. No GitHub, em Settings → Environments → `producao` → Secrets, crie `ALERT_NTFY_URL` com a mesma URL. É o aviso de
   deploy travado.

`ALERT_NTFY_TOKEN` só é necessário com servidor ntfy próprio ou tópico reservado (plano pago do ntfy.sh). Com ele, o
Grafana e o workflow mandam `Authorization: Bearer <token>`.

### Testar

- **Push do Grafana:** abra o Grafana pelo túnel (`ssh -L 3000:<IP do contêiner grafana>:3000 root@<vps>`, depois
  `http://localhost:3000`), vá em Alerting → Contact points → `push-imediato` → Test. Chega um push de prioridade alta.
- **Direto no tópico**, sem o Grafana (confere o app e o tópico):

  ```bash
  curl -H "Title: teste Galaxie" -d "push de teste" "$ALERT_NTFY_URL"
  ```

- **Deploy:** o passo só roda quando o deploy falha. Para conferir o secret, rode o mesmo `curl` acima com a URL do
  secret.

## Ligar o resumo por e-mail

No `.env` da VPS:

```dotenv
ALERT_EMAIL_TO=voce@exemplo.com          # vários: separados por ;
ALERT_EMAIL_FROM=alertas@exemplo.com     # remetente aceito pelo SMTP
ALERT_SMTP_HOST=smtp.exemplo.com:587     # host:porta; STARTTLS quando o servidor oferece
ALERT_SMTP_USER=alertas@exemplo.com
ALERT_SMTP_PASSWORD=<senha de app do SMTP>
```

Depois `docker compose up -d grafana` (log: `alertas por e-mail ligados`) e Alerting → Contact points →
`email-operacao` → Test.

## Monitor externo (Better Stack, plano gratuito)

Quem cria a conta é o dono. O plano gratuito tem 10 monitores com checagem a cada 3 min e uma página de status.

1. Crie a conta em betterstack.com (Uptime) com o e-mail de operação.
2. Crie os monitores (Monitors → Create monitor), todos com checagem a cada 3 min:

   | Monitor | Tipo | URL | Confere |
   |---|---|---|---|
   | Site | URL is available | `https://sports.galaxie.works` | HTTP 2xx |
   | API viva | Keyword | `https://api.sports.galaxie.works/health` | palavra `ok` |
   | API pronta | URL is available | `https://api.sports.galaxie.works/health/ready` | HTTP 2xx (503 = sem Postgres) |
   | API com banco | URL is available | `https://api.sports.galaxie.works/health/db` | HTTP 2xx |
   | Assets | URL is available | uma imagem fixa do `assets.`, ex.: um logo de time que não muda | HTTP 2xx |
   | Demo | URL is available | a página de login da demo | HTTP 2xx |

   O `/health/ready` responde `{"status":"degraded"}` com 200 quando só o Valkey está fora: a API segue servindo
   (cache e limite em modo degradado). Para ser avisado disso também, troque o tipo do "API pronta" para Keyword sem a
   palavra `degraded`.
3. **Push do app:** instale o app da Better Stack no celular, entre com a mesma conta e permita notificações. Em
   cada monitor, em "On-call escalation", marque e-mail e push. Se o plano gratuito não oferecer push na sua conta,
   fica o e-mail: crie no celular uma regra de notificação para o remetente da Better Stack.
4. **Página de status:** Status pages → Create, com os monitores públicos (site, API viva, demo). Para usar
   `status.galaxie.works`, mande o CNAME que a Better Stack mostrar; o registro é criado na Hostinger.

## Saúde da API: vivacidade e prontidão

| Endpoint | Confere | Quem usa | Falha quer dizer |
|---|---|---|---|
| `/health` | O processo responde (sem dependências) | Healthcheck do Docker, que decide se o Traefik manda tráfego e se o contêiner é reiniciado | Processo travado |
| `/health/ready` | Postgres (`select 1`) e Valkey (`PING`), 1,5 s cada | Monitor externo, diagnóstico | 503 sem Postgres; 200 `degraded` sem Valkey |
| `/health/db` | Postgres | Monitor externo (como antes) | 503 sem Postgres |

A escolha: o healthcheck do Docker olha só a vivacidade. Se olhasse o Postgres ou o Valkey, um soluço do Valkey tiraria
a API do Traefik (contêiner `unhealthy` sai da rota) e uma queda do banco reiniciaria a API em laço sem resolver nada.
A falta de dependência aparece no monitor externo (`/health/ready`) e nos alertas, não na rota.

### Auto-reinício (sem autoheal, sem socket do Docker)

O Docker só marca `unhealthy`; fora do Swarm, ninguém reinicia. O healthcheck das imagens da API, da demo e do
ingestor/agentes roda `infra/healthcheck/selfheal.mjs`, que conta as falhas seguidas e, passado o limite, encerra o
processo principal (SIGTERM e, 20 s depois, SIGKILL). O contêiner sai e o `restart: unless-stopped` sobe outro.

Travas contra laço:

- só age num processo que já passou no healthcheck alguma vez: a migration e os jobs avulsos (`docker compose run ...
  node dist/cli/...`) usam a mesma imagem, nunca respondem ao healthcheck e não podem ser encerrados no meio;
- espera 6 falhas seguidas (API e demo: ~1,5 min; ingestor e agents: ~3 min) e o processo ter pelo menos 2 min de vida;
- no máximo 3 reinícios em 30 min; depois disso só fica `unhealthy` e o alerta da camada de cima avisa;
- `SELFHEAL=off` no ambiente do serviço desliga o encerramento (fica só a marcação).

O que ele fez fica em `/tmp/selfheal.log` dentro do contêiner e no `docker inspect` (Health.Log):

```bash
docker compose exec api cat /tmp/selfheal.log
```

## Métricas novas no `/metrics` da API

| Métrica | Fonte |
|---|---|
| `galaxie_service_last_report_timestamp_seconds{component}` | Último relato de cada serviço em `ops.runtime_env` |
| `galaxie_job_expected_interval_seconds{job_name,component}` | Maior intervalo da agenda efetiva do job (só jobs ligados) |
| `galaxie_ai_credit_check{status,provider}` | Última checagem do crédito (`ops.runtime_check`) |
| `galaxie_ai_credit_checked_timestamp_seconds` | Hora da última checagem |
| `galaxie_ai_spend_usd{budget_day}` | Gasto em US$ do dia de orçamento em `ops.llm_usage` (todos os agentes) |
| `galaxie_ai_daily_budget_usd` | Teto global efetivo (sem a série quando é `unlimited`) |

O rótulo é `component`, não `service`: o scrape do Prometheus já põe `service="api"` em toda série da API.
