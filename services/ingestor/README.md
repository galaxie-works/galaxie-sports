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
| Agendador e fila | `scheduler`, `gs tarefa` (CLI da fila) e o worker (`node dist/cli/worker.js`, o serviço `worker` da stack) |

## Worker da fila

`src/cli/worker.ts` é o serviço `worker` da stack: toma as tarefas de `ops.job_request` dos tipos em `TASK_HANDLERS`
(`src/tasks/run.ts`), roda cada uma num processo filho com heap fixo (`src/worker/child.ts`), renova a concessão e drena
no SIGTERM. O laço, as vagas e a drenagem estão em `src/worker/`; operação e variáveis em
[docs/runbooks/tarefas.md](../../docs/runbooks/tarefas.md#o-worker).

## Scheduler

`src/scheduler/schedule.ts` define os jobs (ingestão, normalização, ao vivo e manutenção) e `src/cli/scheduler.ts` os entrega ao
motor [`@galaxie/scheduler`](../../packages/scheduler/README.md), o mesmo dos agentes de IA.

`SCHEDULER_PROFILE` escolhe quais jobs (`jobsForProfile`):

| Perfil | Jobs | Onde |
| --- | --- | --- |
| `ingestor` (padrão) | todos; com `SCHEDULER_LIVE=external`, menos a faixa do ao vivo (`live: true`) | serviço `ingestor` (na VPS, `external`) |
| `live` | só `live-run`, `live-reconcile` e `events-clock` | serviço `live` (#535) |

`SCHEDULER_LIVE` (padrão `internal`) existe para o dev e a volta de versão continuarem com um contêiner só: no NAS o ao vivo
roda no ingestor, como antes. No perfil `live`:

- o `live-run` roda com `--continuo` e `LIVE_LEADER=on` (o perfil liga; `LIVE_LEADER=off` explícito recusa a partida) e
  fica no ar: sem cron, o scheduler o sobe na partida e de novo quando ele sai (`keepAlive`, 1 s, dobrando a cada saída
  rápida até 60 s). Ele não usa a trava por job do scheduler, que deixaria a reserva sempre de fora; usa uma trava por
  cópia (`live-run@<contêiner>`), que só serve para a outra cópia saber, na partida, se a execução `running` é órfã;
- `live-reconcile` e `events-clock` seguem no cron, com a trava por job;
- os processos usam o perfil de tempos `live` do banco (`contextFromEnv` lê o `SCHEDULER_PROFILE`), e o scheduler relata
  ao painel como `live`.

Para rodar o perfil à mão: `SCHEDULER_PROFILE=live pnpm --filter @galaxie/ingestor scheduler` (com `--list`, só a agenda).

Os agentes têm entrada própria em [`services/ai-agents`](../ai-agents/README.md) (`dist/cli/agents-scheduler.js`): este
scheduler não conhece o pacote deles, e `SCHEDULER_PROFILE=agents` aqui falha com a indicação da entrada certa. A imagem do
ingestor traz os dois pacotes (a VPS sobe a mesma imagem duas vezes, `ingestor` e `agents`), e o `CMD` do `Dockerfile` escolhe
a entrada pelo `SCHEDULER_PROFILE`.

## Ao vivo: líder e reserva

No ingestor (`SCHEDULER_LIVE=internal`) o `live-run` nasce pelo cron e tem a trava por job do scheduler. No serviço `live`
(perfil `live`, #535) ele fica no ar com `LIVE_LEADER=on` (padrão `off` fora dele), e cada cópia do serviço é uma
candidata: uma líder e, com duas cópias, uma reserva.

- **Eleição**: a trava é `live:leader`, um advisory lock de sessão numa conexão só dela (`jobLockContender`). Quem tem a
  trava faz os ticks e chama a api-sports. Quem não tem não chama nada e tenta a trava a cada `LIVE_LEADER_RETRY_MS`
  (padrão 1000). Com a variável ligada, o processo não sai ocioso: a líder dorme com a trava na mão.
- **Líder morreu** (`docker kill`, queda da máquina): o Postgres fecha a sessão, a trava some e a reserva assume na
  tentativa seguinte.
- **Conexão da trava caiu com a líder viva** (`onLost`): a cópia descarta o tick e volta para a espera.
- **A cerca que vale é a do banco**: o aviso da trava pode atrasar, e a reserva já pode ter assumido nesse meio-tempo.
  Cada mandato pega uma época nova ao receber a trava (`ops.sync_cursor`, endpoint `live:leader_epoch`). Primeiro saem as
  chamadas ao fornecedor. Depois, retrato, gravação e publicação do tick rodam numa transação só, que trava a linha da
  época e desiste se ela mudou. A nova líder só recebe a época depois do commit da antiga: ou lê o que a antiga gravou
  (e o diff não repete o gol), ou a antiga não grava nada. O bastão passa pela mesma conferência.
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
desde o último tick de qualquer cópia. As mesmas medidas saem no `/metrics` do scheduler (porta 9464), lidas do Postgres
a cada coleta: o `live-run` é um processo filho sem servidor, então grava o ritmo em `ops.sync_cursor` (endpoint
`live:scheduler`, chave `tick`, com a mesma cerca de época do bastão) e o scheduler o expõe, de qualquer cópia:

| Métrica | O que é |
|---|---|
| `live_last_tick_age_seconds{sport}` | Idade do último tick de qualquer cópia (s); depois de uma pausa de propósito, conta desde o fim dela |
| `live_tick_interval_seconds{sport}` | Último intervalo entre ticks (s), atravessando a troca de líder ou de versão |
| `live_tick_interval_max_seconds{sport}` | Maior intervalo dos últimos 5 min (s) |
| `live_tick_planned_interval_seconds{sport}` | Intervalo que o plano pede entre ticks (s) |
| `live_tick_paused{sport}` | 1 na pausa de propósito (meio-tempo, orçamento do dia, espera depois de erro da fonte) |
| `live_window_open{sport}` | 1 quando o plano do dia tem janela aberta agora |
| `live_leader{instance}` | 1 na cópia com a trava `live:leader`, 0 nas reservas (só com `LIVE_LEADER=on`) |

O alerta `LiveTickGap` e o SLO `ao-vivo` usam essas séries (`docs/14-slos-e-error-budget.md`). No painel (Ajustes →
Operação), o serviço `Ao vivo` mostra a líder do mandato atual e o último tick.

## Depende de

- **Pacotes**: `apisports-client` (única saída para a api-sports), `db`, `providers`, `rules`, `knowledge`,
  `where-to-watch`, `geo`, `contracts`, `runtime-config`, `ai-ledger`, `net-guard`, `observability`.
- **Serviços**: Postgres, S3 (assets) e a api-sports (`APISPORTS_KEY`, `APISPORTS_PLAN_*`).
- **Arquivos**: `config/competitions`, `config/rules`, `config/geo`, `config/fixtures`, `config/assets`, `data/knowledge`
  (a imagem recria o layout em `/srv`; ver [config/README.md](../../config/README.md)).

## Deploy

Imagem `galaxie-sports-ingestor` (`Dockerfile`, build a partir da raiz). Na VPS: serviços `live`, `ingestor` e `agents`
(`infra/vps-telemetry/README.md` › Ao vivo).
