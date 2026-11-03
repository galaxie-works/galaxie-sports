# Ambiente de dev (NAS): o que fica ligado e como ligar o resto

A infra de **desenvolvimento** roda no NAS da LAN (`192.168.1.34`), na stack `galaxie-sports-dev` do Portainer do NAS.
O compose é [infra/nas-dev/compose.yml](../../infra/nas-dev/compose.yml) e o Portainer o lê **direto do git** (branch
`nas-dev`, a main com atraso que o `docker.yml` avança depois de publicar as imagens; [Stack a partir do
git](#stack-a-partir-do-git)): a cada commit novo ele puxa as imagens de novo e redeploya, e o serviço `migrate` aplica
as migrations no Postgres do dev. As variáveis estão em
[infra/nas-dev/env.example](../../infra/nas-dev/env.example). Postgres 17 em `:5433`, Valkey em `:6379` e RustFS (S3) em
`:9000`/`:9001` ficam sempre no ar.

> **Aviso: a cota é compartilhada com a produção.** O dev usa a **mesma conta da api-sports**, a **mesma chave do
> YouTube** (100 buscas por dia) e o **mesmo crédito de IA** da produção. Um worker ligado por engano no dev gasta a
> cota que o ao vivo da produção precisa. Por isso a stack nasce com tudo que gasta cota **desligado**, e quem precisa
> testar liga só o que precisa, por pouco tempo. Chave gratuita da api-sports para o dev foi descartada: 100 chamadas
> por dia não cobrem nem o sync diário; o acordo é a conta compartilhada com reserva (PR #401).

## O que fica ligado

| Serviço | Estado no dev | Como ligar |
|---|---|---|
| Postgres, Valkey, RustFS | Sempre ligados (o `s3-init` cria o bucket de assets, com leitura pública, e encerra) | — |
| `migrate` | Roda a cada atualização da stack (a cada merge na main) com a imagem `api:main` e encerra: as migrations da main no Postgres do dev ([abaixo](#migrate-as-migrations-da-main-no-dev)) | — (plano B: `infra/ops/migrate-dev.sh`) |
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

1. No Portainer do NAS (`https://192.168.1.34:19943`), **Stacks › galaxie-sports-dev**, em *Environment variables*,
   acrescente o que o teste precisa (a stack vem do git: o compose não se edita ali, só as variáveis). Exemplos:
   - Rodar só a normalização: `COMPOSE_PROFILES=workers` e `SCHEDULE_NORMALIZE_SPORTS=15 * * * *` (não gasta cota).
   - Resumo pós-jogo com IA: `COMPOSE_PROFILES=workers`, `AI_STATUS=on`, `OPENAI_API_KEY=...` e `SCHEDULE_RECAP_RUN=*/5 * * * *`
     (o teto de US$ 0,5 por dia continua valendo).
   - Uma consulta ao YouTube: `YOUTUBE_SEARCH=on`, `YOUTUBE_API_KEY=...` e o job `related-run`.
   - api-sports: `APISPORTS_KEY=...`, `APISPORTS_PLAN=...` (e `APISPORTS_PLAN_FOOTBALL`) e o job desejado. Prefira
     um job de agenda curta (`SCHEDULE_SYNC_DAILY`) a um cron frequente.
2. Salve e redeploye a stack (o botão da stack do git: *Pull and redeploy* / *Update the stack*, o nome varia com a
   versão do Portainer; mudar só variável não dispara o polling, que olha o commit). Os contêineres do Postgres, do
   Valkey e do RustFS não são recriados quando a configuração deles não muda; o `migrate` roda de novo (idempotente).
3. Quando terminar, **desfaça**: apague a variável (ou volte para `off`) e atualize a stack de novo. Esquecer um job ligado
   é exatamente o que este ambiente quer evitar.

Para uma execução única, sem agendar nada, rode o job pelo painel (**Ajustes › Operação › Rodar agora**, só os jobs
marcados como seguros) ou, no contêiner, `node dist/cli/scheduler.js --run <job>`. Atenção: o "Rodar agora" roda mesmo
um job desligado na agenda. Sem chave o dano é nenhum (modo offline, IA e YouTube desligados), mas com a chave
preenchida ele gasta cota de verdade.

As imagens do ingestor, dos agentes e do `migrate` são do GHCR e **privadas**: o Portainer do NAS precisa de um registro
`ghcr.io` (*Registries*, token `read:packages`), e desde a stack do git ele é obrigatório, porque o `migrate` puxa a
imagem `api` a cada atualização. Os workers não migram o banco: o `migrate` da stack aplica as migrations da mesma tag
(`IMAGE_TAG`, padrão `main`) antes de qualquer worker subir (`depends_on` com `service_completed_successfully`).

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

## Stack a partir do git

Decisão de 03/11/2026 (#552): a stack `galaxie-sports-dev` é uma stack **a partir do repositório** no Portainer CE 2.39
do NAS, com atualização automática por polling e re-pull das imagens. O Portainer confere a branch **`nas-dev`** a cada
5 min e, a cada commit novo, baixa o repositório, puxa as imagens de novo e faz o `compose up` da stack: quem não mudou
de configuração fica no ar (Postgres, Valkey, RustFS), os contêineres de uma vez (`migrate`, `s3-init`) rodam de novo e
os workers, se o perfil estiver ligado, trocam para a imagem `main` recém-publicada. Sem chave SSH, sem `sudo`, sem
socket do Docker: o GitHub Actions não alcança a LAN, então o cron é o polling do próprio Portainer. **Colar o arquivo
no editor deixou de ser o caminho**: o que está na main é o que roda.

**Por que `nas-dev`, e não `main`.** O polling só redeploya quando vê um commit novo, e não tenta de novo depois. Se o
Portainer apontasse para a main, o poll de 5 min cairia no meio do build das imagens (3 a 6 min depois do push), puxaria
a `api:main` do commit anterior e, sem outro commit, ficaria assim: a migration nova só entraria no merge seguinte. A
`nas-dev` é a main com atraso: o job `nas-dev` do [docker.yml](../../.github/workflows/docker.yml) a avança para o SHA
**só depois de todas as imagens do commit saírem com a tag `main`** (`needs: build`, push pelo `GITHUB_TOKEN`, que não
dispara workflow). O redeploy, portanto, nunca vê um commit cujas imagens ainda não existem. Build de uma imagem
vermelho = a branch não anda e o dev fica na versão anterior, inteira (nunca meio a meio); o `gs dev:esquema` avisa o
atraso. Nunca faça commit na `nas-dev`: o job a sobrescreve (`push` simples, sem `--force`: um commit à mão nela
quebraria o job até ser removido).

O compose foi feito para isso: não depende de nenhum arquivo ao lado (só dele e das variáveis da stack), toda variável
sem segredo tem padrão e os três segredos (`POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) são `${VAR:?}`: sem eles
a stack não sobe, em vez de subir um Postgres sem senha. O CI valida o arquivo
(`docker compose … config -q`, com e sem o perfil `workers`) e o vitest do ingestor trava as regras (migrate sem perfil
na tag `main` com a imagem e o comando da produção, workers na mesma tag, segredos sem padrão).

### Pré-requisitos no Portainer

1. **Registro `ghcr.io`** (*Registries › Add registry › Custom*: URL `ghcr.io`, usuário do GitHub e um PAT clássico só
   com `read:packages`). As imagens são privadas e o `migrate` puxa a `api:main` a cada atualização: sem o registro a
   stack falha no primeiro deploy.
2. **Credencial git**, só quando a repo virar privada (aviso de 02/11): um fine-grained PAT **só desta repo** com
   **Contents: read** (nada mais), guardado no Portainer como credencial git (na criação da stack, *Authentication*, ou
   antes em *User settings › Git credentials*) e, como toda chave, no OneDrive em *About Galaxie\Chaves de recuperação*
   com um `.txt` descritivo. Enquanto a repo é pública, *Authentication* fica desligada.

### Criar a stack

**Stacks › Add stack › Repository**, com:

| Campo | Valor |
|---|---|
| Name | `galaxie-sports-dev` (**exatamente**: ver abaixo) |
| Repository URL | `https://github.com/galaxie-works/galaxie-sports` |
| Repository reference | `refs/heads/nas-dev` (a main com atraso, avançada pelo `docker.yml` depois das imagens; ver acima) |
| Compose path | `infra/nas-dev/compose.yml` |
| Authentication | desligada (repo pública); ligada com o PAT só de leitura quando ficar privada |
| GitOps updates | **ligado**, mecanismo **Polling**, *Fetch interval* `5m`, **Re-pull image** ligado; *Force redeployment* desligado (recriaria Postgres, Valkey e RustFS a cada commit) |
| Environment variables | as de hoje (as três senhas, `COMPOSE_PROFILES`, `IMAGE_PREFIX`, `IMAGE_TAG=main`, `PULL_POLICY` e o que estiver ligado para teste; a lista está em [env.example](../../infra/nas-dev/env.example)) |

**O nome tem de ser o mesmo da stack de hoje.** O Compose nomeia os volumes pelo projeto, que no Portainer é o nome da
stack: `galaxie-sports-dev_pgdata`, `galaxie-sports-dev_valkeydata`, `galaxie-sports-dev_s3data`. Com o mesmo nome a
stack nova monta os mesmos volumes e o Postgres sobe com os dados que já estão lá; com outro nome nascem volumes vazios
e um banco do zero.

### Trocar a stack colada no editor pela do git

A stack antiga (stack id 10, colada à mão) e a nova não podem ter o mesmo nome ao mesmo tempo. Nesta ordem:

1. **Backup, fora do git** (o env tem as senhas): `GET /api/stacks/10/file` e `GET /api/stacks/10` (campo `Env`) pela API
   (`https://192.168.1.34:19943/api`, cabeçalho `X-API-Key`), ou copie o editor e a lista de variáveis pela tela. Guarde
   em `.claude/handover/`. Um `pg_dump -Fc` do banco de dev pela máquina de dev é barato e vale como seguro.
2. **Remova a stack antiga** (*Stacks › galaxie-sports-dev › Remove*). Remover a stack para e apaga os contêineres e a
   rede; **não apaga os volumes nomeados** (não há opção de volumes para stacks Compose no Portainer, e o `docker compose
   down` dele roda sem `-v`). Confira em *Volumes* que os três `galaxie-sports-dev_*` continuam lá antes de seguir.
3. **Crie a stack do git** com a tabela acima e as variáveis do backup (`IMAGE_TAG=main`; `staging` não vale mais).
4. **Confira**: em *Stacks › galaxie-sports-dev*, Postgres, Valkey e RustFS `running`, `s3-init` e `migrate` `exited (0)`;
   o log do `migrate` termina em `Migrations aplicadas: esquema na 00NN_… (N no journal da imagem)`. Da máquina de dev,
   `pnpm --filter @galaxie/ingestor gs dev:esquema` diz `em dia`, e as consultas de [cota](#conferir-que-nada-gastou-cota)
   seguem sem linha nova.
5. Depois do primeiro merge na main seguinte, volte ao Portainer: a stack deve mostrar o commit novo e o `migrate` ter
   rodado de novo (hora do contêiner). Isso fecha a #552.

### `migrate`: as migrations da main no dev

O serviço `migrate` do compose é o mesmo da produção ([infra/vps-telemetry/compose.yml](../../infra/vps-telemetry/compose.yml)):
a imagem `api` e o comando `node node_modules/@galaxie/db/dist/migrate-cli.js`, fixo na tag `main` (`IMAGE_TAG`),
`pull_policy: always`, `restart: "no"`, esperando o Postgres da stack ficar saudável e com `DB_ROLES=off` (o dev não tem
papéis por serviço). Como o Portainer redeploya a cada commit novo na `nas-dev` (cada commit da main, assim que as
imagens dele saem), o `migrate` roda **a cada merge na main**:
nada a aplicar = sai em 0 em segundos; migration nova = aplica e sai em 0; falhou = contêiner com saída ≠ 0 na lista da
stack, com o log dizendo qual migration, e os workers não sobem (dependem dele). Vale o critério da #550: depois de um
merge com migration nova, o dev tem a migration em menos de 1 h sem ninguém mexer no Portainer.

Imagem `main`: o [docker.yml](../../.github/workflows/docker.yml) publica as tags `<sha>`, `in-<hash>`, `main` e
`staging` a cada push na main. A produção usa `in-<hash>` por serviço; o dev usa `main`, que é sempre a última.

### Esquema do dev atrasado (`DevEsquemaAtrasado`)

Não é um alerta do Grafana nem do GitHub: o Prometheus da VPS não enxerga o Postgres do NAS, e o GitHub não entra na
LAN; um alertador novo só para isso seria infraestrutura nova sem necessidade. A checagem é o comando, rodado da
máquina de dev (ou do contêiner do ingestor na própria stack):

```bash
pnpm --filter @galaxie/ingestor build                 # uma vez (dist/cli/gs.js)
pnpm --filter @galaxie/ingestor gs dev:esquema        # DATABASE_URL do .env = o Postgres do NAS
```

Ele compara `drizzle.__drizzle_migrations` do banco com o journal de migrations **da main** (`git fetch` + `git show
origin/main:packages/db/drizzle/meta/_journal.json`; sem git, o journal do pacote instalado) e diz:

```text
Esquema do dev: postgres://galaxie@192.168.1.34:5433/galaxie_sports
  journal (origin/main)     66 migrations, última 0065_resumo_explorar
  aplicadas no banco     65, última 0064_fila_de_tarefas
  falta                  0065_resumo_explorar (na main desde 2026-11-02T18:40:12.000Z)
  estado                 pendente há 2 h (limite 24 h): o migrate da stack do NAS aplica na próxima atualização da stack (até ~5 min depois do merge)
```

| Estado | Saída | Quer dizer |
|---|---|---|
| `em dia` | 0 | O banco tem exatamente o journal da main |
| `pendente` | 0 | Falta migration, mas a mais antiga entrou na main há menos de 24 h (`--limite-horas`) |
| `ATRASADO` | 1 | Falta migration há mais de 24 h: o `migrate` do NAS não aplicou. Veja o contêiner `migrate` no Portainer (saída e log) e o polling da stack; plano B abaixo |
| `VAZIO` | 1 | Sem migration nenhuma (tabela de controle ausente ou vazia): banco novo ou URL errada |
| `à frente` | 0 | A última aplicada no banco é mais nova que a última do journal comparado: `git fetch` (ou o checkout está em outro branch) |

O critério de "falta" é o do próprio migrator do Drizzle: só a migration cujo `when` passa do `created_at` da última
aplicada. Uma entrada do journal sem linha no banco e com `when` anterior aparece como `puladas` (o migrator nunca mais a
aplica; histórico de migration renumerada ou regerada, [packages/db/src/journal.ts](../../packages/db/src/journal.ts)), e
linhas do banco que o journal não tem aparecem como `desconhecidas`: as duas são só informação, não mudam o estado. No
banco de dev de hoje (03/11/2026) há 11 linhas históricas desconhecidas e a `0035_pais_gb_reino_unido` pulada; não é
atraso. "Desde quando" é a hora do commit da main que acrescentou o `.sql` (sem git, a hora em que a migration foi
gerada, que é anterior e portanto conservadora). `--json` dá o mesmo em JSON; `--ref` troca o ref (`origin/main`);
`--sem-fetch` não atualiza o ref antes. Uma migration só do seu branch não aparece como atraso: o comparado é a main.

### Plano B: migrate pela máquina de dev

Quando o `migrate` da stack falhou e não dá para esperar o próximo commit, ou com o Portainer fora:

```bash
infra/ops/migrate-dev.sh            # a imagem publicada: docker run …-api:main migrate-cli.js (Docker Desktop + login no ghcr.io)
infra/ops/migrate-dev.sh --pnpm     # sem Docker: as migrations DESTE checkout (pnpm db:migrate), inclusive as que não estão na main
infra/ops/migrate-dev.sh --plan     # só mostra o que faria
```

Lê `DATABASE_URL` do ambiente ou do `.env` do checkout principal (`GALAXIE_ENV`, padrão `/g/galaxie-sports/.env`) e
**recusa, em letras grandes, uma URL que não seja a do dev** (host `192.168.1.34` ou `localhost`; `--forcar` passa por
cima). O `migrate` é idempotente: rodar à mão e deixar o do Portainer rodar depois não aplica nada duas vezes. Teste do
script: `infra/ops/migrate-dev.test.sh` (docker e pnpm falsos, no CI).

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

Voltar para a stack colada no editor: remova a stack do git (os volumes ficam, como acima) e crie uma stack pelo
editor com o **mesmo nome**, o arquivo e as variáveis do backup do passo 1 da troca. Como o Postgres, o Valkey e o RustFS
têm a mesma configuração antes e depois, não há migração de dados nem de volume para desfazer. As migrations que o
`migrate` aplicou no meio do caminho ficam (são de expandir, [migrations.md](migrations.md)); o `pg_dump` do passo 1 é o
caminho se for preciso voltar o esquema.
