# Ambiente de dev (NAS): o que fica ligado e como ligar o resto

A infra de **desenvolvimento** roda no NAS da LAN (`192.168.1.34`), na stack `galaxie-sports-dev` do Portainer do NAS.
O compose é [infra/nas-dev/compose.yml](../../infra/nas-dev/compose.yml) (fonte de verdade; o arquivo do Portainer é uma
cópia dele) e as variáveis estão em [infra/nas-dev/env.example](../../infra/nas-dev/env.example). Postgres 17 em `:5433`,
Valkey em `:6379` e RustFS (S3) em `:9000`/`:9001` ficam sempre no ar.

> **Aviso: a cota é compartilhada com a produção.** O dev usa a **mesma conta da api-sports**, a **mesma chave do
> YouTube** (100 buscas por dia) e o **mesmo crédito de IA** da produção. Um worker ligado por engano no dev gasta a
> cota que o ao vivo da produção precisa. Por isso a stack nasce com tudo que gasta cota **desligado**, e quem precisa
> testar liga só o que precisa, por pouco tempo. Chave gratuita da api-sports para o dev foi descartada: 100 chamadas
> por dia não cobrem nem o sync diário; o acordo é a conta compartilhada com reserva (PR #401).

## O que fica ligado

| Serviço | Estado no dev | Como ligar |
|---|---|---|
| Postgres, Valkey, RustFS | Sempre ligados (o `s3-init` cria o bucket de assets, com leitura pública, e encerra) | — |
| `ingestor` (scheduler, ao vivo) | **Não sobe**: está no perfil `workers` do compose | `COMPOSE_PROFILES=workers` no ambiente da stack |
| `agents` (agentes de IA) | **Não sobe**: perfil `workers` | idem |
| Cada job do ingestor e dos agentes | `SCHEDULE_<JOB>=off` (inclusive `live-run`, `live-reconcile` e `events-clock`) | `SCHEDULE_<JOB>=<cron de 5 campos, UTC>`, ou "Rodar agora" no painel |
| IA (OpenAI, Anthropic, Gemini) | `AI_STATUS=off`, sem chave | `AI_STATUS=on` **e** a chave do provedor |
| YouTube | `YOUTUBE_SEARCH=off`, sem chave | `YOUTUBE_SEARCH=on` **e** `YOUTUBE_API_KEY` |
| api-sports | Sem `APISPORTS_KEY` (modo offline) | `APISPORTS_KEY` (ver abaixo) |

Subir a stack do zero não faz nenhuma chamada à api-sports, ao YouTube nem a um LLM nas primeiras 24 h: com os workers
fora do ar nada roda e, mesmo com o perfil `workers` ligado, nenhum job está agendado. O teste
`services/ingestor/src/scheduler/nas-dev-compose.test.ts` trava essas regras (todo job do código tem sua variável
`SCHEDULE_*` em `off`, `AI_STATUS=off`, `YOUTUBE_SEARCH=off`, chaves vazias, sem `APP_ENV`); um job novo sem a variável
na stack faz o CI falhar.

### Sem `APISPORTS_KEY`: o que acontece

O ingestor entra em **modo offline** (`services/ingestor/src/context.ts`): o cliente serve a resposta mais recente do
`raw` espelhado, de qualquer idade, e **nunca chama o fornecedor**. O que não está no `raw` não vira chamada: conta como
"bloqueado" no relatório do job e não escreve nada em `ops.quota_ledger`. Os jobs que só leem o banco (normalizações,
relógio dos eventos, importância, retenção, qualidade) funcionam normalmente. Os que **só fazem sentido com a chave**
falham de propósito com uma mensagem clara: `quota-status` ("Defina APISPORTS_KEY"), `live-run` e `live-reconcile`
("Sem APISPORTS_KEY ..."). Para restaurar dados no dev use `snapshot:import` (também sem chave).

Com a chave, valem as travas do **Quota Governor**. Como o ambiente não tem `APP_ENV` (a produção usa `staging`; nunca
copie essa variável para o dev), o dev é tratado como dev: a reserva é de **pelo menos 70 %** da conta do dia, para tudo,
inclusive o ao vivo, ou seja, o dev para quando a conta chega a 30 %. O Governor vê o contador real da conta pelo
cabeçalho `x-ratelimit-requests-remaining` de cada resposta, e um 429 pausa a API por 30 s em todo o banco. Além disso o
compose limita `APISPORTS_PER_MINUTE=10` e `POSTGAME_MAX_CALLS_DAY=10`.

## Orçamento por serviço que gasta cota

Todo serviço que gasta cota declara o orçamento no ambiente da stack; esgotar o de um só para ele, não os outros. Os
valores de produção são os da VPS ([infra/vps-telemetry/env.example](../../infra/vps-telemetry/env.example)) e os padrões
do código.

| Serviço / agente | Cota que gasta | Variável de orçamento | Dev (stack do NAS) | Produção |
|---|---|---|---|---|
| Ingestor, api-sports (uma cota por API/esporte) | chamadas do dia da API | `APISPORTS_PLAN` e `APISPORTS_PLAN_<ESPORTE>` (limite diário do plano) | plano real, só com a chave | plano contratado de cada API |
| Governor, reserva | fatia do dia que só o ao vivo usa | `QUOTA_LIVE_RESERVE_PERCENT` | fixo pelo código: ≥ 70 %, vale para tudo | 25 % |
| Governor, ritmo | chamadas por minuto | `APISPORTS_PER_MINUTE` | 10 | o do plano |
| Fechamento pós-jogo | chamadas por esporte e dia | `POSTGAME_MAX_CALLS_DAY` | 10 | 40 |
| Ao vivo (`live-run`, `live-reconcile`) | chamadas LIVE | `SCHEDULE_LIVE_RUN`, `SCHEDULE_LIVE_RECONCILE`, `LIVE_*` | `off`; sem chave nem roda | `*/5` e `*/10` |
| YouTube, busca (`related-run`) | consultas `search.list` por dia | `YOUTUBE_SEARCH_DAILY_QUOTA` | 5 (e `YOUTUBE_SEARCH=off`) | 100 |
| YouTube, geral (uploads, vídeos, canais) | unidades por dia | `YOUTUBE_DAILY_QUOTA` | 200 (e `YOUTUBE_SEARCH=off`) | 10 000 |
| IA, soma de todos os agentes | tokens por dia | `AI_DAILY_TOKEN_BUDGET` | 100 000 | 1 000 000 |
| IA, soma de todos os agentes | US$ por dia (tokens + buscas na web) | `AI_DAILY_USD_BUDGET` | 0,5 (o mínimo aceito) | 10 |
| IA, por agente (`lineups`, `wtw`, `context`, `related`, `f1profile`, `f1bio`, `curator`, `review`, `channels`, `live`, `assets`) | US$ por dia de cada um | `AI_AGENT_USD_BUDGETS` | 0,05 a 0,1 por agente | 0,5 a 3 por agente (`lineups=2,wtw=3,context=1.5,...`) |
| IA, agente novo | US$ por dia do agente fora da lista | `AI_AGENT_DEFAULT_USD_BUDGET` | 0,05 | 0,5 |
| Onde Assistir, por mercado | US$ por dia de cada mercado | `WTW_DAILY_USD_PER_MARKET` | 0,1 | 1 |
| IA, busca na web | buscas por chamada | `AI_MAX_SEARCHES_PER_CALL` | 2 | 5 |
| IA, ligar/desligar | — | `AI_STATUS` (global), `AI_AGENT_STATUS` (por agente) | `off` | `on` |

Não gastam cota paga: `assets-mirror`, `assets-palette`, `lineups-pages` e as normalizações (leem sites públicos ou o
banco). Esgotado o teto de IA de um agente, ele segue com o texto determinístico; esgotado o balde do YouTube, o jogo
para com erro em vez de estourar.

Um aviso sobre o YouTube: o ledger do dev (`enrich.related_run`) é do banco de dev, e a produção não o enxerga. Os 100
do Google valem para as duas pontas juntas; é por isso que o dev não deve passar de poucas buscas e fica desligado.

## Ligar um teste pontual

1. No Portainer do NAS (`https://192.168.1.34:19943`), **Stacks › galaxie-sports-dev › Editor**, em *Environment
   variables*, acrescente o que o teste precisa. Exemplos:
   - Rodar só a normalização: `COMPOSE_PROFILES=workers` e `SCHEDULE_NORMALIZE_SPORTS=15 * * * *` (não gasta cota).
   - Resumo pós-jogo com IA: `COMPOSE_PROFILES=workers`, `AI_STATUS=on`, `OPENAI_API_KEY=...` e `SCHEDULE_RECAP_RUN=*/5 * * * *`
     (o teto de US$ 0,5 por dia continua valendo).
   - Uma consulta ao YouTube: `YOUTUBE_SEARCH=on`, `YOUTUBE_API_KEY=...` e o job `related-run`.
   - api-sports: `APISPORTS_KEY=...`, `APISPORTS_PLAN=...` (e `APISPORTS_PLAN_FOOTBALL`) e o job desejado. Prefira
     um job de agenda curta (`SCHEDULE_SYNC_DAILY`) a um cron frequente.
2. **Update the stack** (sem *Re-pull image* se a imagem não mudou). Os contêineres do Postgres, do Valkey e do RustFS não
   são recriados quando a configuração deles não muda.
3. Quando terminar, **desfaça**: apague a variável (ou volte para `off`) e atualize a stack de novo. Esquecer um job ligado
   é exatamente o que este ambiente quer evitar.

Para uma execução única, sem agendar nada, rode o job pelo painel (**Ajustes › Operação › Rodar agora**, só os jobs
marcados como seguros) ou, no contêiner, `node dist/cli/scheduler.js --run <job>`. Atenção: o "Rodar agora" roda mesmo
um job desligado na agenda. Sem chave o dano é nenhum (modo offline, IA e YouTube desligados), mas com a chave
preenchida ele gasta cota de verdade.

As imagens do ingestor e dos agentes são do GHCR e **privadas**: o Portainer do NAS precisa de um registro `ghcr.io`
(*Registries*, token `read:packages`) antes de ligar o perfil `workers`. Elas não migram o banco: o Postgres de dev é
migrado pela máquina de dev (`pnpm db:migrate`), na mesma versão da imagem (`IMAGE_TAG`, padrão `staging`).

### Fora da stack: a máquina de dev

A stack do NAS desligada **não protege** o que roda na máquina de dev: o `.env` da máquina costuma ter `APISPORTS_KEY`,
`YOUTUBE_API_KEY` e chaves de LLM, e qualquer `pnpm ... run`/`scheduler` local gasta a cota compartilhada. Para um teste
local sem custo, use `YOUTUBE_SEARCH=off`, `AI_STATUS=off` e deixe `APISPORTS_KEY` vazia no `.env` (ou rode com
`--plan`, que não chama nada).

### O painel manda mais que o ambiente

O painel de **Ajustes › Operação** grava em `ops.runtime_setting` e vale mais que o ambiente do contêiner
(banco > env > padrão). Se alguém ligar um job ou a IA pelo painel de dev, o `off` do compose perde. Conferência, e o
resultado no dia 02/11/2026 (nenhuma sobrescrita no banco de dev):

```sql
select key, updated_at from ops.runtime_setting order by key;
```

## Aplicar a stack pelo Portainer

O Portainer do NAS responde em `https://192.168.1.34:19943/api` (certificado próprio) com o cabeçalho `X-API-Key`
(token `ptr_...`, que fica fora do repositório). Pela API, no endpoint `1`:

1. **Backup antes de mexer** (fora do git; o env tem as senhas): `GET /api/stacks/10/file` e `GET /api/stacks/10`
   (campo `Env`). Guarde os dois em `.claude/handover/`.
2. **Edite o repositório** (`infra/nas-dev/compose.yml`, `env.example`) e abra o PR. O compose sem segredos é o que vai
   para o Portainer.
3. **Reaplique**: `PUT /api/stacks/10?endpointId=1` com o corpo
   `{"StackFileContent": "<compose>", "Env": [{"name": "...", "value": "..."}], "Prune": false, "PullImage": false}`.
   O `Env` **substitui** a lista inteira: leia o atual, some o que mudou e envie tudo (inclusive as senhas, que o
   Postgres e o RustFS usam). `Prune: false` não apaga o que sair do arquivo.
4. **Confira**: `GET /api/endpoints/1/docker/containers/json` (só Postgres, Valkey e RustFS rodando; o `STATUS` deles deve
   seguir "Up" com o tempo de antes, sem recriação) e a consulta abaixo no Postgres de dev.

Também dá para colar o arquivo na tela **Stacks › galaxie-sports-dev › Editor** e usar *Update the stack*.

### Conferir que nada gastou cota

Contra o Postgres de dev (`DATABASE_URL` do `.env`), sem linhas novas desde a aplicação da stack:

```sql
-- api-sports: chamadas que saíram para o fornecedor
select count(*), max(sent_at) from ops.quota_ledger where sent_at > now() - interval '24 hours';
-- LLM: chamadas e custo
select count(*), max(created_at), coalesce(sum(cost_usd), 0) from ops.llm_usage where created_at > now() - interval '24 hours';
-- YouTube: consultas e unidades
select coalesce(sum(searches), 0) as buscas, coalesce(sum(api_units), 0) as unidades
  from enrich.related_run where started_at > now() - interval '24 hours';
-- jobs que rodaram
select job, status, count(*) from ops.job_run where started_at > now() - interval '24 hours' group by 1, 2;
```

Num ambiente recém-criado as duas primeiras tabelas ficam vazias. O banco de dev atual guarda o histórico anterior à
stack (até 24/10/2026), então a conferência é por "nenhuma linha depois da aplicação".

## Rollback

O arquivo e o ambiente anteriores estão no backup do passo 1. Reaplique-os com o mesmo `PUT`. Como o Postgres, o Valkey e
o RustFS têm a mesma configuração antes e depois, não há migração de dados nem de volume para desfazer.
