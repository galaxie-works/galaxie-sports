# SLOs e orçamento de erro

O que prometemos sobre a produção, como medimos e o que fazemos quando a promessa está em risco. Desde o lote 8 da
auditoria de 28/10/2026.

A produção é uma VPS única com Docker Compose, sem réplica nem failover. Os alvos cabem nisso: um reinício de
contêiner, um deploy ou uma manutenção do provedor precisam caber no orçamento. Nenhum alvo é 99,9% ou mais.

- Regras: [`infra/observability/prometheus/slo.yml`](../infra/observability/prometheus/slo.yml), com teste simulado em
  `slo.test.yml` (CI: passo "Alertas — teste simulado (promtool)" do `docker.yml`).
- Painel: **Galaxie Sports · SLOs e orçamento de erro** no Grafana (`galaxie-slo`).
- Push recebido: [runbook de on-call](runbooks/on-call.md).

## Resumo

Janela de todos os SLOs: 28 dias corridos.

| SLO (`slo=`) | Promessa | Alvo | Orçamento em 28 dias | Alertas |
|---|---|---|---|---|
| `api-disponibilidade` | Requisições à API pública sem erro do servidor, com a API no ar | 99,5% | 0,5% das requisições; com a API fora, ~3 h 22 min | rápida = push (`api`); lenta = resumo |
| `api-latencia` | Rotas principais respondem em até 1 s (p99 ≤ 1 s) | 99% | 1% das requisições acima de 1 s | rápida = push (`api`); lenta = resumo |
| `ao-vivo` | Jogo do plano do ao vivo atualizado dentro de 2 intervalos do poller | 99% | 1% dos minutos com jogo em andamento | rápida e lenta = resumo (o push é do `LiveEventStale`) |
| `frescor-diario` | Sync diário com sucesso há no máximo 26 h | 99% | ~6 h 43 min | só orçamento (o atraso já alerta no `JobOverdue`) |
| `backup` | Dump com sucesso há no máximo 26 h e verificador sem falha | 99% | ~6 h 43 min | só orçamento (o push é do `BackupStale` e do `BackupCheckFailed`) |

Os alvos são o ponto de partida. Depois de 4 semanas de dados (ver [Retenção](#retenção-do-prometheus)), revisar com o
SLI real de cada um: alvo que nunca chega perto de gastar o orçamento sobe; alvo que estoura todo mês por motivo que
não vamos resolver desce, com o porquê anotado aqui.

## Como ler as regras

- `slo:sli_error:ratio_rate<janela>{slo}`: fração ruim na janela (5m, 30m, 1h, 2h, 6h, 1d, 3d).
- `slo:sli_error:ratio_28d{slo}`: fração ruim em 28 dias (grupo `galaxie-slo-budget`, a cada 5 min).
- `slo:objective:ratio{slo}`: o alvo.
- `slo:error_budget_remaining:ratio{slo}`: 1 − erro de 28 dias ÷ (1 − alvo). 1 = intacto, 0 = acabou, negativo =
  estourado.
- **Queima** = erro da janela ÷ (1 − alvo). Queima 1 gasta o orçamento em exatamente 28 dias.

As taxas de 5 min das requisições são gravadas uma vez (`slo:api_requests:rate5m` e afins), e as janelas maiores são
médias delas. Fica barato e ponderado pelas requisições. As janelas só ficam completas depois de 3 dias de regras no
ar, e o orçamento depois de 28.

## Os SLIs

### `api-disponibilidade`: disponibilidade da API pública

Fração ruim = respostas 5xx das rotas `/v1/*` + fração do tempo em que o Prometheus não raspa a API, com teto de 1.

```promql
# por janela W (o slo.yml usa as taxas de 5 min gravadas; equivalente):
clamp_max(
  (
    sum(rate(galaxie_http_request_duration_seconds_count{job="galaxie-api",route=~"/v1/.+",status_code=~"5.."}[W]))
    / sum(rate(galaxie_http_request_duration_seconds_count{job="galaxie-api",route=~"/v1/.+"}[W]))
    or vector(0)
  )
  + (1 - avg(avg_over_time(up{job="galaxie-api"}[W]))),
  1
)
```

- **Por que somar o `up`:** o histograma é medido dentro da API. Com a API fora, nenhuma requisição é registrada e o
  SLI pareceria perfeito. O tempo fora entra como erro, supondo o tráfego espalhado por igual.
- **Fora da conta:** rota desconhecida (`route="unmatched"`, os 404 de caminho inexistente), `/health*` e `/metrics`.
  4xx não é erro do servidor: chave inválida, 404 de recurso e 429 de limite contam como boas.
- **Ponto cego:** o Prometheus mora na mesma VPS. Com a VPS inteira fora, não há dado nenhum, e o intervalo não entra
  na conta. Quem vê isso é o monitor externo (Better Stack, a ligar pelo dono:
  [runbook de alertas](runbooks/alertas-e-monitoramento.md#monitor-externo-better-stack-plano-gratuito)).
- **Deploy conta:** a troca de contêiner num deploy derruba a raspagem por alguns segundos. É custo real para o
  cliente e deve caber no orçamento; se não couber, é sinal para o deploy sem downtime (lote 7).

### `api-latencia`: p99 das rotas principais

Fração ruim = requisições GET sem 5xx das rotas principais que levaram mais de 1 s.

```promql
1 - (
  sum(rate(galaxie_http_request_duration_seconds_bucket{job="galaxie-api",method="GET",route=~"<rotas>",status_code!~"5..",le="1"}[W]))
  / sum(rate(galaxie_http_request_duration_seconds_count{job="galaxie-api",method="GET",route=~"<rotas>",status_code!~"5.."}[W]))
)
```

`<rotas>` = `/v1/events|/v1/events/live|/v1/events/:id|/v1/events/:id/(timeline|stats|lineups)|/v1/competitions/:id/seasons/:season/standings|/v1/teams/:id/overview`:
as rotas que os widgets e a demo chamam em toda página de jogo, de ao vivo, de tabela e de time.

- **Por que 1 s e não 150 ms:** o NFR de p95 ≤ 150 ms com cache quente continua no alerta `ApiLatencyP95High`. O SLO
  é sobre o pior 1% (cache frio, consulta pesada, VPS ocupada), que o cliente sente como página travada. 1 s é um
  bucket que já existe no histograma (`HTTP_BUCKETS` em `packages/observability/src/metrics/registry.ts`).
- **Métrica que falta:** hoje não há como saber o p99 real antes de ligar. O lote 5 está criando o histograma de p99 por
  rota; quando entrar, o painel "p99 por rota principal" e este SLO passam a usá-lo. Se os buckets mudarem, o SLI
  precisa de um bucket em 1 s (ou mudar o alvo para um bucket que exista).
- 5xx fica fora daqui porque já conta na disponibilidade.

### `ao-vivo`: atraso do placar ao vivo

Fração ruim = minutos com jogo do plano do ao vivo em andamento (`coverage="poller"`) em que algum jogo está mais de
2 intervalos do poller sem atualização válida. É o mesmo limite do push `LiveEventStale`. Minuto sem jogo não conta.

```promql
# slo:ao_vivo:ok (1 bom, 0 ruim, sem série sem jogo)
(
  max(galaxie_live_event_max_staleness_seconds{coverage="poller"})
  <= bool on() 2 * max(galaxie_live_poll_interval_seconds)
)
and on() (sum(galaxie_live_events{coverage="poller"}) > 0)

# fração ruim na janela W
1 - avg_over_time(slo:ao_vivo:ok[W])
```

- **O que não mede:** o pedido era o atraso do evento na fonte até a nossa API. Isso não existe como métrica hoje.
  `galaxie_live_event_max_staleness_seconds` é o tempo desde a última atualização válida do jogo, não desde o gol.
  Ela diz se o poller está no ritmo, e não quanto o placar chega atrasado.
- **Hoje, na prática:** com `LIVE_POLL_INTERVAL_SECONDS=300` (padrão do `.env`), o limite é 10 min. O atraso real
  fonte→API fica entre o intervalo efetivo do Live Scheduler (`galaxie_live_scheduler_interval_seconds`) e esse
  limite, mais o tempo de cache da rota.
- **Métrica a criar** (combinar com o lote 5, que mexe no ao vivo): um histograma
  `galaxie_live_score_lag_seconds{sport}` gravado pelo poller quando o placar muda, com o tempo entre a resposta da
  fonte que trouxe a mudança e a resposta anterior (limite superior do atraso nosso). Somado ao cache da rota, dá um SLO
  "p95 do atraso ≤ X s" de verdade. Até lá, este SLO vale como piso.

### `frescor-diario`: frescor dos dados diários

Fração ruim = tempo em que o `sync-daily` (00:05 UTC: agenda D-1/D0/D+1 do futebol e das outras 11 APIs, lesões e
encerrados) está há mais de 26 h sem sucesso.

```promql
# slo:frescor_diario:ok
min(time() - galaxie_job_last_success_timestamp_seconds{job_name="sync-daily"} <= bool 26 * 3600)
# fração ruim na janela W
1 - avg_over_time(slo:frescor_diario:ok[W])
```

- Falha um dia e volta no outro: gasta ~2 h do orçamento (das 26 h às ~28 h). Dois dias seguidos sem sync: ~1 dia,
  bem mais que o orçamento.
- `galaxie_job_last_success_timestamp_seconds` é o **início** da última execução com sucesso: um sync de 2 h não
  atrasa a medida.
- Não cobre os outros jobs diários (grades, enriquecimento): esses têm o `JobOverdue`.

### `backup`: sucesso dos backups

Fração ruim = tempo sem dump do Postgres com sucesso nas últimas 26 h **ou** com o verificador (`backup-check`, a cada
6 h, que também confere o recibo da cópia no NAS quando `BACKUP_NAS_RECEIPT` está ligado) falhando.

```promql
# slo:backup:ok
min(
  (time() - galaxie_job_last_success_timestamp_seconds{job_name="pg-backup"} <= bool 26 * 3600)
  or (galaxie_job_consecutive_failures{job_name="backup-check"} == bool 0)
)
```

- O ensaio de restauração mensal não entra na fração: é um evento por mês. A promessa dele é binária: um ensaio com
  sucesso a cada 35 dias (`RestoreDrillStale`, `RestoreDrillFailed`).
- O RPO de 24 h e o RTO de 2 h ficam no [runbook de DR](runbooks/exercicio-dr.md).

## Alertas de queima (multi-janela)

Seguem o SRE Workbook (cap. 5): duas janelas por alerta. A longa mede quanto do orçamento foi; a curta (1/12 da longa)
confirma que ainda está acontecendo e faz o alerta resolver logo depois do conserto.

| Alerta | Condição (queima nas duas janelas) | Gasto do orçamento | Canal |
|---|---|---|---|
| `SloBurnRateFast` | ≥ 14,4 em 1 h e 5 min, **ou** ≥ 6 em 6 h e 30 min | 2% em 1 h ou 5% em 6 h | API: push, `sinal: api`. Ao vivo: resumo diário |
| `SloBurnRateSlow` | ≥ 3 em 1 d e 2 h, **ou** ≥ 1 em 3 d e 6 h | 10% em 1 d ou em 3 d | resumo diário |
| `ErrorBudgetExhausted` | orçamento de 28 dias ≤ 0 por 1 h | 100% | resumo diário; vale a política abaixo |

Na API, a queima rápida de 14,4 é 7,2% de 5xx (ou da hora fora) por uma hora; a lenta de 1 é 0,5% por três dias.

Os alertas de queima do ao vivo, do frescor e do backup não mandam push: esses sinais já têm push próprio e mais
rápido (`LiveEventStale`, `BackupStale`, `BackupCheckFailed`). Frescor e backup nem têm queima: com um job por dia, a
taxa por hora não diz nada que o alerta do job não diga.

## Retenção do Prometheus

O Prometheus guarda 15 dias por padrão (`PROMETHEUS_RETENTION` no compose da VPS). Com isso, o "28 dias" das regras
vê no máximo 15. Para a janela valer de verdade, é preciso `PROMETHEUS_RETENTION=35d` no `.env` da VPS e recriar o
Prometheus. **Pendente de OK do dono**, porque aumenta o disco do volume `promdata`. Antes, medir o tamanho atual
(`docker system df -v | grep promdata`) e projetar ×2,3.

Até lá, o painel e o `ErrorBudgetExhausted` mostram o orçamento dos dias disponíveis, mais severo que o de 28 dias.

## Política do orçamento de erro

Vale por SLO, olhando `slo:error_budget_remaining:ratio`, e o dono pode abrir exceção quando houver motivo.

| Orçamento restante | O que muda |
|---|---|
| Acima de 25% | Normal. Features e deploys seguem o ritmo de sempre. |
| Entre 0 e 25% | Cautela no componente: um deploy por vez, nenhuma migration arriscada, e mudanças que mexem no componente esperam por janela sem jogo grande. |
| Acabou (≤ 0) | **Congela features do componente.** Só entram correções de confiabilidade, de segurança e de dado errado. O próximo trabalho do componente é a causa do gasto: cada incidente que consumiu 20% ou mais do orçamento ganha postmortem em [`docs/postmortems/`](postmortems/README.md) com ações. |

- **Componente**, por SLO: `api-*` = API e o que ela lê (cache, banco); `ao-vivo` = ingestor do ao vivo e a cota LIVE;
  `frescor-diario` = agenda e sync; `backup` = serviço de backup e cópia no NAS.
- **Volta ao normal** quando o orçamento fica positivo de novo e a correção da causa principal está no ar. Sem esperar
  a janela inteira: o que conta é a causa ter sido tratada.
- **Gasto que não é nosso** (queda do provedor da VPS, fonte de dados fora) também gasta o orçamento: o cliente sentiu
  do mesmo jeito. A ação aí é de resiliência (cache servindo o último dado, aviso de estado), não de congelar código
  que não teve culpa. O postmortem diz qual dos dois foi.
- **Queima lenta** (`SloBurnRateSlow`) no resumo diário: abrir issue no projeto com o SLO e a janela, para não virar
  orçamento esgotado sem ninguém ver.
