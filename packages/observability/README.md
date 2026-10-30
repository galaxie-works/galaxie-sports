# @galaxie/observability

Logger JSON compartilhado (pino) e métricas Prometheus lidas do banco: cota por API, jobs, frescor dos dados, ao vivo e
change feed.

## Como usar

`LOG_LEVEL` controla o log. As métricas são servidas pela API em `/metrics` e coletadas pelo Prometheus de
[`infra/observability`](../../infra/README.md). Alertas e SLOs: [docs/14](../../docs/14-slos-e-error-budget.md) e
[runbooks/alertas-e-monitoramento](../../docs/runbooks/alertas-e-monitoramento.md).

## Depende de

`@galaxie/db`, `@galaxie/apisports-client`, `@galaxie/runtime-config`.

## Usado por

`apps/api`, `services/ingestor`.
