# Testes de carga (k6)

Cenários para picos de audiência concentrados (clássicos, finais, Pan) — issue #85. Os scripts rodam com o
[k6](https://grafana.com/docs/k6/) local ou pela imagem `grafana/k6` (profile `load` do `infra/docker-compose.yml`).

| Script | O que simula | Meta (perfil `load`/`peak`) |
|---|---|---|
| [`live-burst.js`](live-burst.js) | Rajada em `GET /v1/events/live` (70% a mesma lista, 30% filtrada por esporte) | **10.000 req/s**, p95 ≤ 150 ms, p99 ≤ 400 ms, ≥ 95% do cache, 0% de erro |
| [`catalog-browse.js`](catalog-browse.js) | Navegação de catálogo: esportes, países, competições (cursor), detalhe e tabela, em 5 locales | 2.000 req/s, p95 ≤ 300 ms (p95 do cache ≤ 150 ms) |
| [`cache-hit-vs-miss.js`](cache-hit-vs-miss.js) | Mesmo endpoint servido do Valkey (HIT) × montado no Postgres (MISS, `cb=` único) | HIT p95 ≤ 150 ms · MISS p95 ≤ 400 ms |
| SSE (`/v1/stream`) | Rampa de conexões SSE | **Pulado**: o endpoint ainda não existe (issue #35) e o k6 não fala SSE sem extensão (`xk6-sse`). Quando existir, criar `sse-ramp.js` com `xk6-sse` (meta sugerida: 50k conexões por instância, entrega ≤ 1 s) |

Limiares comuns (todos os scripts): `http_req_failed < 1%`, nenhum **429** (`rate_limited == 0`), `checks > 99%`. As
métricas `cached_req_duration` / `uncached_req_duration` / `cache_hit_rate` separam respostas por
`x-galaxie-cache: HIT|MISS`.

## Perfis

| `PROFILE` | Executor | Uso |
|---|---|---|
| `smoke` (padrão) | `constant-vus`, `VUS` (5) por `DURATION` (30 s) | Provar que o script funciona. **Não é benchmark** |
| `load` | `constant-arrival-rate` em `RATE` req/s por `DURATION` (5 min) | Capacidade sustentada |
| `peak` | `ramping-arrival-rate`: sobe a `RATE` em 30 s, segura `DURATION`, desce | Gol em clássico / final |

Outras variáveis: `BASE_URL` (padrão `http://localhost:8080`), `API_KEY`, `MAX_VUS`, `LIVE_PATH`, `SPORTS`,
`CACHE_PATH`.

## Preparação

1. **Ambiente descartável** — nunca rode carga contra staging/produção sem combinar, nem contra o banco compartilhado
   de desenvolvimento: o `cache-hit-vs-miss` grava uma entrada no Valkey por requisição MISS. Use um banco restaurado
   de um dump ([exercício de DR](../../docs/runbooks/exercicio-dr.md)) e um índice próprio do Valkey
   (`REDIS_URL=redis://localhost:6379/7`).
2. **Tenant de carga** com rate limit alto (o limite é por tenant × rota, por minuto):
   ```bash
   # via API administrativa (ADMIN_KEY_HASHES configurada; ver docs/05 §1.2)
   curl -X POST http://localhost:8080/internal/admin/tenants -H "x-galaxie-admin-key: $GALAXIE_ADMIN_KEY" \
     -H 'content-type: application/json' \
     -d '{"slug":"carga-local","name":"Tenant de carga","plan":"enterprise","rateLimitPerMinute":1000000000,"key":{"label":"k6","env":"test"}}'
   # ou pelo CLI
   pnpm --filter @galaxie/api tenant:create --slug carga-local --plan enterprise --rate-limit 1000000000 --label k6
   ```
3. **API** a partir do build do repositório: `pnpm build && pnpm --filter @galaxie/api start` (ou `node dist/main.js`
   com `DATABASE_URL`, `REDIS_URL` e `API_PORT`). Para medir capacidade, rode como em produção (vários processos/réplicas
   atrás do proxy) — uma única instância Node mede o teto de **uma** instância.

## Rodando

Com Docker (a API no host é alcançada por `host.docker.internal`; resultados em `tests/load/results/`, fora do Git):

```bash
export LOAD_API_KEY=gs_test_...            # chave do tenant de carga
export LOAD_BASE_URL=http://host.docker.internal:8080
docker compose -f infra/docker-compose.yml --profile load run --rm k6 \
  run --summary-export /results/catalog-browse.json /scripts/catalog-browse.js

# outro perfil/parâmetros: -e PROFILE=peak -e RATE=10000 -e DURATION=2m -e MAX_VUS=2000
docker compose -f infra/docker-compose.yml --profile load run --rm -e PROFILE=peak -e RATE=10000 k6 \
  run /scripts/live-burst.js
```

Com o k6 instalado: `BASE_URL=http://localhost:8080 API_KEY=gs_test_... k6 run tests/load/live-burst.js`.

Enquanto `/v1/events/live` não existir, o `live-burst.js` aborta no setup com uma mensagem clara. Para exercitar o
script, aponte `LIVE_PATH` para outra rota cacheada (`-e LIVE_PATH=/v1/competitions?country=BR`) e registre isso no
relatório.

Para carga de verdade (10k req/s), o gerador precisa de máquina própria (rede e CPU): rode o k6 fora do host da API, ou
use k6 distribuído; anote a máquina geradora no relatório.

## Relatório

Copie [`REPORT_TEMPLATE.md`](REPORT_TEMPLATE.md) para `reports/<data>-<ambiente>.md` e preencha. O primeiro smoke
local (prova de funcionamento, não benchmark), com os gargalos e as ações já identificados, está registrado no PR que
introduziu estes scripts (issue #85).

### Gargalos conhecidos (análise do código + smoke local)

| # | Gargalo | Ação sugerida |
|---|---|---|
| 1 | Uma instância Node por container; o smoke local (gerador na mesma máquina) passou de ~1.000 req/s com p95 de 13–17 ms em HIT — 10k req/s exigem várias réplicas | Medir req/s por instância em staging (`PROFILE=load`) e dimensionar réplicas atrás do proxy; avaliar `node --cluster`/vários processos por container |
| 2 | Cada requisição autenticada faz 2 round-trips ao Valkey (rate limit `MULTI` + leitura do cache) | Micro-cache em memória (1–2 s) para `/v1/events/live`; agrupar rate limit + cache num script Lua/pipeline |
| 3 | Sem coalescência de MISS: quando a entrada de 10 s do ao vivo expira, todas as requisições simultâneas vão ao Postgres (MISS p95 ~70 ms já com 10 VUs) | *Singleflight* por chave de cache + servir *stale* enquanto revalida |
| 4 | `Vary: x-galaxie-key` impede a CDN de compartilhar a resposta entre tenants | Autenticação na borda (validação de chave no edge) ou cache por tenant na CDN para as rotas quentes |
| 5 | Resposta de lista grande (~18 KB por `/v1/competitions?country=BR`) sem compressão na API | Compressão no proxy (o Caddy já faz zstd/gzip); conferir no teste de staging |
