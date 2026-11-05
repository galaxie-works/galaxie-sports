# Unidades da stack

A produção é uma VPS, o Docker Compose em [três projetos](README.md#três-projetos) e sete **unidades** (épico #558): cada
uma sobe, cai e volta de versão sozinha, e o deploy de uma nunca recria outra. Esta página diz, para cada unidade, o que
roda, como conferir que está saudável (o smoke dela), como voltar uma versão e com quem ela conversa. É o índice
operacional; o mapa do código está em [docs/15](../../docs/15-organizacao-do-monorepo.md).

| Unidade | Serviços | Projeto Compose | Imagem e tag no `.env` | Quem publica |
|---|---|---|---|---|
| [Borda](#borda) | `traefik`, `maintenance` | `/docker/traefik` · apps | `traefik` (upstream) · `maintenance` (Caddy fixo) | à mão · deploy de apps |
| [Dados](#dados) | `postgres`, `valkey`, `s3` (+ `s3-init`), `backup` | `compose.dados.yml` | `backup`: `TAG_BACKUP` · o resto, upstream | só por runbook |
| [Observabilidade](#observabilidade) | `prometheus`, `grafana`, `node-exporter` | `compose.obs.yml` | `TAG_PROMETHEUS`, `TAG_GRAFANA` · `node-exporter`, upstream | `deploy.yml -f project=obs` |
| [API](#api) | `api` (+ `api-candidate`), `webhooks`, `migrate` | `compose.yml` | `TAG_API` | deploy de apps |
| [Web](#web) | `demo` (+ `demo-candidate`); site e console em breve | `compose.yml` | `TAG_DEMO` | deploy de apps |
| [Ao vivo](#ao-vivo) | `live` (em breve) | `compose.yml` | `TAG_INGESTOR` (hoje) | deploy de apps |
| [Processamento](#processamento) | `ingestor`, `agents`, `worker`, `lineup-render` | `compose.yml` | `TAG_INGESTOR` · `lineup-render`, tag fixa no compose | deploy de apps |

"Deploy de apps" é o automático: `deploy.yml` sobe sozinho quando o CI e as imagens da ponta da `main` terminam verdes, e
só troca o serviço cuja imagem mudou. A release `deploy-AAAA-MM-DD.N` traz a seção **Serviços publicados** (serviço, tag
anterior → nova, ou "sem troca") e é daí que sai a tag para voltar uma versão.

## Voltar uma versão (vale para todas)

A tag de cada imagem é o `in-<hash>` da entrada dela, uma variável por imagem no `.env` da VPS
(`/docker/galaxie-sports/.env`). Dois caminhos:

**1. Um SHA anterior inteiro**, pelo Actions: republica as imagens e o compose daquele commit e troca só o que difere.

```bash
gh workflow run deploy.yml -f sha=<sha anterior> -f force=1                    # unidades de apps
gh workflow run deploy.yml -f project=obs -f sha=<sha anterior> -f force=1     # Observabilidade
```

**2. Um serviço só**, pela tag: pegue a anterior nas notas da release (Serviços publicados) ou em
`grep '^TAG_' .env.bak-<sha7>`, troque a variável e suba só o serviço, sempre nomeado.

```bash
cd /docker/galaxie-sports
sed -i 's|^TAG_DEMO=.*|TAG_DEMO=in-<hash anterior>|' .env
PULL_POLICY=missing docker compose up -d --no-deps demo        # apps; dados e obs levam -f compose.dados.yml / compose.obs.yml
```

`api`, `webhooks` e `demo` voltam sem manutenção pelo [`rolling-swap.sh`](rolling-swap.sh). Imagem que a poda já tirou da
VPS (ficam a no ar e as 3 anteriores) pede `docker login ghcr.io` antes. **Migration aplicada não volta**: a versão
anterior roda sobre o schema novo; o deploy avisa quando isso acontece. Detalhe e casos de borda:
[Merge e deploy pelo GitHub](../../docs/runbooks/deploy-pelo-github.md#voltar-um-serviço-só).

## Quem conversa com quem

A regra do épico é que as unidades se falem **só pelo Postgres** (tabelas, change feed, fila) **e pelo Valkey** (cache,
rate limit e pub/sub do SSE), e que nenhuma chame outra por HTTP no caminho do Ao vivo. O que existe hoje, para não
esconder o desvio:

| Canal | Quem usa | Observação |
|---|---|---|
| Postgres (`compose.dados.yml`) | `api`, `webhooks`, `migrate`, `demo`, `ingestor`, `agents`, `worker`, `backup` | cada serviço com o papel e os tempos limite dele ([papéis do banco](../../docs/runbooks/papeis-do-banco.md)) |
| Valkey | `api`, `webhooks`, `migrate`, `ingestor`, `agents` | a `demo` não fala com ele; o `api-candidate` usa o prefixo `gs-candidate:` para não misturar com o que está no ar |
| S3 (`s3`) | `api`, `webhooks`, `migrate`, `demo`, `ingestor`, `agents`, `worker` (assets); `backup` (cópia dos dumps, opcional); leitura pública pelo Traefik | só objetos, sem listagem |
| HTTP, desvios conhecidos | `demo` → `api` (`GALAXIE_API_URL`); `ingestor` → `api` (`QUALITY_API_URL`, conferência de qualidade) | fora do caminho do Ao vivo; a demo só lê dado esportivo pela API |
| HTTP, só leitura | `prometheus` raspa `/metrics` de `api`, `webhooks`, `ingestor`, `agents`, `worker`; `traefik` roteia por labels para `api`, `demo`, `s3`, `maintenance` | nada disso chama de volta |
| WebSocket | `agents` → `lineup-render` | rede `render` própria, sem Postgres, Valkey nem S3 |

## Borda

**O que roda.** O Traefik v3 da VPS, que serve todas as stacks de `/docker` (`network_mode: host`, TLS por HTTP-01,
roteamento por labels), versionado em [`infra/traefik`](../traefik/README.md); e a `maintenance`, o Caddy fixo
(`caddy:2.11.7-alpine`) que devolve 503 de manutenção nos hosts da demo e da API, com a configuração inteira inline no
`compose.yml` ([Página de manutenção](README.md#página-de-manutenção)).

**Smoke.**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/health      # 200, certificado válido (sem -k)
cd /docker/traefik && docker compose ps                                    # Up
cd /docker/galaxie-sports && docker compose ps maintenance                 # healthy (responde 503 no 8080)
```

O `smoke.mjs` confere os dois 503 da `maintenance` em todo deploy de apps.

**Voltar.** Traefik: `cd /docker/traefik && cp docker-compose.yml.bak-<data> docker-compose.yml && docker compose up -d`.
O `up -d` reinicia a borda de **todas** as stacks da VPS por alguns segundos: só com o OK do Wagner e fora de jogo. A
`maintenance` não tem tag: ela volta com o `compose.yml` do SHA anterior (caminho 1 acima), e o deploy a recria quando o
conteúdo das configs muda.

**Conversa com.** Docker socket (labels dos contêineres) e as portas dos serviços da stack. Não toca no Postgres nem no
Valkey.

## Dados

**O que roda.** Postgres 17, Valkey, S3 (RustFS, com o `s3-init` que cria o bucket) e o `backup` diário do Postgres
(dump validado, retenção, ensaio de restauração), tudo em [`compose.dados.yml`](compose.dados.yml). Rede e volumes são
externos: `down` e `down -v` em qualquer projeto não os apagam. Dia a dia:
[Dados e observabilidade](../../docs/runbooks/stack-dados-e-observabilidade.md).

**Smoke.**

```bash
cd /docker/galaxie-sports
docker compose -f compose.dados.yml ps                      # postgres e valkey healthy (pg_isready, valkey-cli ping)
docker compose -f compose.dados.yml exec backup ls -la /backups    # o dump do dia
```

**Voltar.** Nada disto sai sozinho num merge. `backup`: `TAG_BACKUP=in-<hash anterior>` no `.env` e
`docker compose -f compose.dados.yml up -d --no-deps backup`. `postgres`, `valkey` e `s3` são imagens de terceiros fixadas no
`compose.dados.yml`: volte o `compose.dados.yml.bak-<data>` e suba só o serviço, com `config -q` antes. O `deploy.yml`
**não** vale aqui. Upgrade de versão maior do Postgres não volta por tag: é restauração de dump
([exercício de DR](../../docs/runbooks/exercicio-dr.md)), com a página de manutenção forçada ([`maintenance.sh`](maintenance.sh)).

**Conversa com.** É o centro: todo o resto fala com o Postgres e o Valkey daqui; o `backup` fala com o Postgres e o S3.

## Observabilidade

**O que roda.** Prometheus (alertas, SLOs e testes de regra), Grafana (painéis de cota e SLO, alertas que viram issues) e
o node-exporter, em [`compose.obs.yml`](compose.obs.yml). O Grafana não tem rota pública: acesso por túnel SSH.

**Smoke.**

```bash
cd /docker/galaxie-sports
docker compose -f compose.obs.yml ps                        # grafana healthy (/api/health), prometheus e node-exporter Up
ssh -L 3000:<IP do contêiner grafana>:3000 root@<vps>       # painel SLOs: "Versão no ar por serviço"
```

**Voltar.** `gh workflow run deploy.yml -f project=obs -f sha=<sha anterior> -f force=1` (grava `TAG_PROMETHEUS` e
`TAG_GRAFANA` e registra `DEPLOY_SHA_OBS`), ou, para um só: troque a tag no `.env` e
`docker compose -f compose.obs.yml up -d --no-deps grafana`. Sem banco, candidato, smoke nem notas de versão.

**Conversa com.** Só lê: raspa o `/metrics` da API, dos webhooks, do ingestor e dos agents e as métricas da máquina. Não
fala com o Postgres nem com o Valkey.

## API

**O que roda.** A API pública Fastify (`/v1`, `/mirror`, SSE, admin) como `api`; o worker de entrega de webhooks
(`webhooks`, mesma imagem, sem router, só `/health`, `/version` e `/metrics` na 8080); e o `migrate`, que roda uma vez a cada
deploy e aplica as migrations. O `api-candidate` (perfil `candidate`) sobe ao lado, sem router, só durante o deploy.

**Smoke.**

```bash
curl -sS https://$API_DOMAIN/health                          # 200
curl -sS https://$API_DOMAIN/version                         # image_hash da versão no ar
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/metrics     # 404 (não passa pelo Traefik)
ssh root@<vps> 'cd /docker/galaxie-sports && docker compose exec -T demo node -' < infra/vps-telemetry/smoke.mjs
```

O `smoke.mjs` confere cada funcionalidade **com dados** (não só 200) e roda duas vezes por deploy: no candidato, antes da
troca, e na versão trocada. Falha no candidato deixa a anterior no ar.

**Voltar.** `TAG_API` (vale para `api`, `webhooks`, `migrate` e `api-candidate`), pelo caminho 2, com troca lado a lado
(`rolling-swap.sh api`, depois `webhooks`); ou o caminho 1.

**Conversa com.** Postgres, Valkey e S3. É a única unidade que a Web e o `ingestor` chamam por HTTP (desvios acima).

## Web

**O que roda.** O Next.js `demo`: site, demo, portal do cliente, Builder de widgets, documentação e painel de operação.
Site e console viram serviços próprios nas próximas fases do épico; até lá continuam dentro da `demo`, com o mesmo `TAG_DEMO`.

**Smoke.**

```bash
curl -sS https://$DEMO_DOMAIN/api/version                    # image_hash da versão no ar
curl -sS -o /dev/null -w '%{http_code}\n' https://$DEMO_DOMAIN/    # 307 → /login (sem sessão)
```

Mais o `smoke.mjs` (acima), que roda dentro do contêiner da demo e confere o login protegido e o painel de Operação.

**Voltar.** `TAG_DEMO` (vale para `demo` e `demo-candidate`), pelo caminho 2, com `rolling-swap.sh demo` para trocar sem
manutenção; ou o caminho 1.

**Conversa com.** Postgres (papel e schema próprios: `demo_auth`, grades, widgets), S3 (assets) e a API por HTTP (`GALAXIE_API_URL`). Não usa o Valkey.

## Ao vivo

**O que roda.** Ainda é um modo do scheduler do ingestor (`live-run`), então hoje esta unidade **não tem serviço próprio**:
a coluna da tabela de cima aponta para `TAG_INGESTOR` porque é a imagem que o roda. O serviço `live` (#535, no épico #555: líder e reserva por
advisory lock, sem HTTP entre serviços) é o que vai dar a ela tag própria; a eleição já existe no código, desligada
(`LIVE_LEADER=off`, [README do ingestor](../../services/ingestor/README.md)). Quando existir, ganha tag e smoke próprios aqui.

**Smoke (hoje).** O mesmo do [Processamento](#processamento). Com jogo em campo, o alerta `LiveEventStale` (push) é o sinal
de que o placar parou; a meta do épico é um intervalo entre ticks abaixo de 60 s.

**Voltar.** Hoje, junto com o ingestor (`TAG_INGESTOR`). Recriar o ingestor corta o placar por alguns minutos: foi o motivo
do épico. Evite durante jogo até o `live` sair do ingestor.

**Conversa com.** Postgres (estado do ao vivo, change feed com NOTIFY) e Valkey (relay do SSE). Nenhuma chamada HTTP entre serviços.

## Processamento

**O que roda.** O `ingestor` (scheduler e CLIs de sync, normalização, assets e qualidade); os `agents` (a mesma imagem com
`SCHEDULER_PROFILE=agents`: onde assistir, cenário, resumo, curadoria, vídeos, grades; teto diário de tokens); o
`lineup-render`, o Chromium headless do perfil `render` (`docker compose --profile render up -d lineup-render`, só
durante a leitura das páginas e cai depois); e o `worker` das tarefas da fila (a mesma imagem, `dist/cli/worker.js`:
acervo, espelho de assets, carga histórica e backfills, cada tarefa num processo filho; drena no SIGTERM;
[tarefas › O worker](../../docs/runbooks/tarefas.md#o-worker)).

**Smoke.**

```bash
cd /docker/galaxie-sports
docker compose ps ingestor agents worker                      # Up (worker: healthy)
docker compose exec -T ingestor node -e "fetch('http://127.0.0.1:9464/version').then(r=>r.text()).then(console.log)"
docker compose logs --since 10m ingestor | tail                # jobs rodando, sem erro de cota nem de conexão
```

O mesmo `/version` e `/metrics` na 9464 vale para os `agents`; o `worker` responde na 8080 (`/health` diz `idle` e a
tarefa em andamento). Job parado vira o alerta `SchedulerHeartbeatStale` no Prometheus e issue
([alertas](../../docs/runbooks/alertas-e-monitoramento.md)).

**Voltar.** `TAG_INGESTOR` (vale para `ingestor`, `agents` e `worker`), pelo caminho 2:
`docker compose up -d --no-deps --scale ingestor=<escala atual> ingestor` e depois `agents`; o `worker` volta lado a lado,
drenando (`bash -s -- worker < rolling-swap.sh`). Evite trocar o ingestor no
meio de importação longa. O `lineup-render` não tem tag no `.env`: a versão do Playwright está no `compose.yml` (e em
`infra/lineup-render/versions.mjs`), então volta com o `compose.yml` do SHA anterior (caminho 1).

**Conversa com.** Postgres (papéis e tempos limite por perfil), Valkey, S3 (assets), a API (`QUALITY_API_URL`, só o
`ingestor`) e, por WebSocket e só os `agents`, o `lineup-render`.
