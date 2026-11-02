# @galaxie/ingestor

Tudo o que traz dado para dentro do banco: o espelho da api-sports (raw), a normalização para o modelo canônico (core),
o ao vivo, os assets e as fontes abertas (Wikidata, Wikimedia Commons, F1DB, hipismo). Roda como um **scheduler** de
longa duração que dispara os CLIs deste pacote em horários fixos.

Estratégia de cota e jobs: [docs/03](../../docs/03-ingestao-e-economia-de-chamadas.md) · Ao vivo:
[docs/07 §2.1](../../docs/07-ia-tempo-real-e-enriquecimento.md#21-live-scheduler-o-agendamento-inteligente).

## Como rodar

```bash
pnpm infra:up && pnpm build && pnpm db:migrate      # na raiz
pnpm --filter @galaxie/ingestor quota                # cota do dia (não gasta cota)
pnpm --filter @galaxie/ingestor sync:daily --plan    # mostra o que gastaria, sem chamar
pnpm --filter @galaxie/ingestor scheduler            # o agendador, como na VPS
```

Sem `APISPORTS_KEY`, o cliente entra em modo offline e só lê o raw (bom para dev com `pnpm snapshot:restore`).
Os jobs de cota aceitam `--plan`, `--max-chamadas N`, `--sem-live` e `--forcar`, e retomam de onde pararam.

## CLIs por área

A lista completa, com o que cada um faz, está na tabela "Como rodar" do [README da raiz](../../README.md#como-rodar).

| Área | Comandos |
|---|---|
| Cota e raw | `quota`, `raw:import`, `raw:compactar-historico`, `snapshot:export`, `snapshot:import`, `data:retention`, `change-feed:prune` |
| Bootstrap e sync (api-sports) | `bootstrap:catalog`, `bootstrap:seasons`, `bootstrap:details`, `bootstrap:people`, `bootstrap:perfis`, `bootstrap:sports`, `sync:daily`, `mma`, `fixture-people` |
| Normalização raw → core | `normalize:football`, `normalize:sports`, `names:derive`, `standings:recompute`, `standings:limpar-grupo-vazio`, `pessoas:separar-tecnicos` |
| Evento e ao vivo | `events:clock`, `events:importance`, `live:run`, `live:reconcile`, `live:simulate`, `postgame:close`, `provisional:sync` |
| Assets e imagens | `assets:mirror`, `assets:palette`, `assets:acervo`, `assets:commons*`, `assets:competition-logos`, `assets:official-logos`, `assets:platform-logos`, `assets:fotos-wikidata` |
| Fontes abertas | `multisport:seed`, `multisport:wikidata`, `multisport:qa`, `titulos:wikidata`, `pessoas:wikidata-por-time`, `canais:wikidata`, `f1db:import`, `f1:biografia`, `equestrian:import`, `geo:seed` |
| Qualidade | `quality:run` (confere a API publicada; `QUALITY_API_URL` + `QUALITY_API_KEY`) |
| Agendador | `scheduler` |

## Scheduler e o perfil `agents`

`src/scheduler/schedule.ts` define os jobs. `SCHEDULER_PROFILE=ingestor` (padrão) roda ingestão, normalização, ao vivo e
manutenção. `SCHEDULER_PROFILE=agents` roda só os agentes de IA, executando os CLIs de
[`services/ai-agents`](../ai-agents/README.md) pelo caminho `../ai-agents`. Por isso a imagem do ingestor empacota os
dois pacotes, e a VPS sobe a mesma imagem duas vezes (`ingestor` e `agents`). Essa dependência não aparece no
`package.json` (ver [docs/15 §5, F4](../../docs/15-organizacao-do-monorepo.md#5-fronteiras-confusas-hoje)).

## Ao vivo: líder e reserva

Hoje o `live-run` nasce pelo cron e tem a trava por job do scheduler. Com `LIVE_LEADER=on` (padrão `off`; quem liga é o
serviço `live`, #535) ele vira duas cópias no ar: uma líder e uma reserva.

- **Eleição**: a trava é `live:leader`, um advisory lock de sessão numa conexão só dela (`jobLockContender`). Quem tem a
  trava faz os ticks e chama a api-sports. Quem não tem não chama nada e tenta a trava a cada `LIVE_LEADER_RETRY_MS`
  (padrão 1000). Com a variável ligada, o processo não sai ocioso: a líder dorme com a trava na mão.
- **Líder morreu** (`docker kill`, queda da máquina): o Postgres fecha a sessão, a trava some e a reserva assume na
  tentativa seguinte.
- **Conexão da trava caiu com a líder viva** (`onLost`): a cópia corta o tick e volta para a espera. Antes de gravar, a
  resposta é descartada. Depois de gravar, nenhuma chamada nova sai, mas o que já mudou no core é publicado, porque a
  próxima líder compara com o core já gravado e nunca publicaria aquele gol.
- **SIGTERM na líder**: termina o tick em andamento, grava o estado (`saveLiveState`) e o `ops.job_run`, e só então solta
  a trava.
- **Nada se repete na troca**: candidatos, retratos do diff e orçamento do dia (`planLiveDay`, `ticksLeft`) já vêm do
  Postgres. O que só existia na memória e muda a decisão de chamar (último tick, backoff, intervalo visto, tentativas de
  confirmar o resultado) é o bastão, em `ops.sync_cursor` (endpoint `live:scheduler`, chave `handoff`), gravado a cada
  tick. Se a líder morre com a chamada no ar, a nova pode repeti-la; a resposta de até 10 s no raw evita gastar cota.
- **Fora da eleição**: `live-reconcile` e `events-clock` continuam como cron, cada um com a trava por job.

Para ver quem é a líder:

```sql
select a.application_name, a.backend_start, l.pid is not null as lider
  from pg_stat_activity a
  left join pg_locks l on l.pid = a.pid and l.locktype = 'advisory' and l.granted
 where a.application_name like 'galaxie-live-leader:%';
```

Nos logs, `live_leader` (0 ou 1, com `instance`) sai a cada troca e `live_tick_interval_seconds` a cada tick, medido
desde o último tick de qualquer cópia. O ingestor não expõe `/metrics` por processo: as métricas ficam para a #538.

## Depende de

- **Pacotes**: `apisports-client` (única saída para a api-sports), `db`, `providers`, `rules`, `knowledge`,
  `where-to-watch`, `geo`, `contracts`, `runtime-config`, `ai-ledger`, `net-guard`, `observability`.
- **Serviços**: Postgres, S3 (assets) e a api-sports (`APISPORTS_KEY`, `APISPORTS_PLAN_*`).
- **Arquivos**: `config/competitions`, `config/rules`, `config/geo`, `config/fixtures`, `config/assets`, `data/knowledge`
  (a imagem recria o layout em `/srv`; ver [config/README.md](../../config/README.md)).

## Deploy

Imagem `galaxie-sports-ingestor` (`Dockerfile`, build a partir da raiz). Na VPS: serviços `ingestor` e `agents`.
