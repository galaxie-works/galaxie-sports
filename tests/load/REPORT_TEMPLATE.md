# Relatório de carga — <data> — <ambiente>

> Tipo: **smoke** (prova de funcionamento) | **load** (capacidade sustentada) | **peak** (pico). Só relatórios
> `load`/`peak` num ambiente equivalente a produção servem como benchmark.

## Contexto

| Item | Valor |
|---|---|
| Commit / branch | `<sha>` |
| Ambiente da API | <máquina, CPU, memória, nº de instâncias/réplicas, Node, proxy/CDN na frente?> |
| Banco / Valkey | <Postgres (versão, tamanho, dados), Valkey (local/remoto)> |
| Gerador de carga | <máquina, k6 (versão), local/distribuído, rede até a API> |
| Tenant | <slug, plano, rate limit> |
| Comando | `<k6 run ...>` com `PROFILE`, `RATE`, `DURATION`, `VUS`/`MAX_VUS` |

## Resultados

| Cenário | Req/s alcançado | p50 | p95 | p99 | Erros | 429 | Cache HIT | Limiares |
|---|---|---|---|---|---|---|---|---|
| live-burst | | | | | | | | ✓/✗ |
| catalog-browse | | | | | | | | ✓/✗ |
| cache-hit-vs-miss (HIT) | | | | | | | | ✓/✗ |
| cache-hit-vs-miss (MISS) | | | | | | | | ✓/✗ |
| SSE | | | | | | | | |

Recursos durante o teste (pico): CPU da API <%>, memória <MB>, conexões no Postgres <n>, CPU/ops do Valkey <n>,
event loop lag <ms>, `galaxie_http_request_duration_seconds` no Grafana <link/print>.

## Gargalos observados

1. <componente> — <evidência (métrica, log, perfil)> — <impacto>

## Ações

| # | Ação | Responsável | Issue | Prioridade |
|---|---|---|---|---|
| 1 | | | | |

## Conclusão

<A meta foi atingida? Com quantas instâncias? O que precisa mudar antes do próximo pico (clássico/final/Pan)?>
