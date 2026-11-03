# Tarefas da fila

Trabalho avulso e longo (carga Ultra, backfill, acervo, espelho) entra numa fila no Postgres (`ops.job_request` com
`type`) e é retomado do checkpoint se o contêiner cair. Este runbook cobre o lado de quem pede (enfileirar pela CLI ou
pelo painel, a prévia com aprovação, acompanhar, cancelar e reprocessar) e o serviço `worker`, que executa a fila
([O worker](#o-worker)). O contrato da fila para quem escreve worker está em
[packages/db/README.md](../../packages/db/README.md#fila-de-tarefas).

> **Estado (#542):** a CLI, o painel, a regra da prévia, os tipos reais (acervo, espelho, carga histórica e backfills)
> e o serviço `worker` estão prontos. O `ingestor` roda com `QUEUE_MODE=enqueue`: o espelho de assets do horário só
> enfileira, e o worker executa.

## A regra: prévia antes do que muda dado

A ferramenta sinaliza, uma pessoa decide. Tipo que apaga, troca ou religa dados é **destrutivo** no registro
(`packages/db/src/queue-types.ts`) e nunca entra na fila direto:

1. Enfileira a **prévia** (`--previa` na CLI, "Só a prévia" no painel). Ela roda como uma tarefa comum, com
   `params.previa = true`, e grava o plano em `checkpoint.previa`: contagens do que mudaria e uma amostra, como o
   `--plan` do acervo. Nada muda.
2. Um **admin** confere o plano no painel e clica **Aprovar e executar**. Isso enfileira a execução de verdade, com os
   mesmos params e `params.previaId` apontando para a prévia.
3. Sem aprovação, nada muda. Cada prévia aprova uma vez só (dois cliques ao mesmo tempo criam uma execução).

A CLI recusa o tipo destrutivo sem `--previa`, e o painel trava o "Só a prévia" ligado. O worker confere de novo antes
de executar (`checkRunnable` e `checkApproval`): uma tarefa destrutiva que pulou a regra pelo `enqueue` direto, ou que
traz um `previaId` que não é o da execução criada pela aprovação, encerra em erro sem rodar.
A aprovação não tem comando na CLI, só o botão do painel, que exige papel de admin.

Tipo não destrutivo também pode rodar em prévia, quando o executor sabe (`previa: true` no registro): útil para ver o
tamanho de uma carga antes de gastar cota.

## Pela CLI

Roda de qualquer máquina com `DATABASE_URL` (o `.env` da raiz, ou a variável no ambiente). Quem pediu fica gravado
como `cli:<usuário>@<máquina>` (ou `GS_REQUESTED_BY`, se definida).

```bash
pnpm --filter @galaxie/ingestor build                       # uma vez, ou depois de atualizar
pnpm --filter @galaxie/ingestor gs tarefa tipos             # tipos, parâmetros e quais pedem prévia
pnpm --filter @galaxie/ingestor gs tarefa enfileirar exemplo.eco --param mensagem=oi --param repeticoes=5
pnpm --filter @galaxie/ingestor gs tarefa enfileirar exemplo.eco --param mensagem=oi --previa --prioridade 10
pnpm --filter @galaxie/ingestor gs tarefa listar --status pending,running
pnpm --filter @galaxie/ingestor gs tarefa ver <id>
pnpm --filter @galaxie/ingestor gs tarefa cancelar <id>
pnpm --filter @galaxie/ingestor gs tarefa reprocessar <id>
```

No contêiner do ingestor: `node dist/cli/gs.js tarefa ...`. Todos os comandos aceitam `--json`.

| Comando | O que faz | Recusa |
| --- | --- | --- |
| `tipos` | Lista os tipos, os parâmetros (tipo, obrigatório, padrão) e se rodam em prévia ou exigem prévia | — |
| `enfileirar <tipo>` | Valida os `--param k=v` pelo schema do tipo (converte número e booleano) e põe na fila | tipo desconhecido, parâmetro inválido ou desconhecido, destrutivo sem `--previa`, `--previa` em tipo sem prévia |
| `listar` | As 50 mais recentes (`--limite`), com estado, prioridade, tentativas, idade, worker e progresso | `--status` fora de `pending, running, done, error, canceled` |
| `ver <id>` | Params, progresso, plano da prévia, log resumido, execuções (com as retomadas) e o que está ligado | id que não existe |
| `cancelar <id>` | Tira da fila a pendente (inclusive a que espera retomar) | a que está rodando ou já encerrou |
| `reprocessar <id>` | Tarefa nova com os mesmos params, ligada à original (`params.reprocessaDe`) | a que ainda está pendente ou rodando |

Saída: `0` ok, `1` recusa da regra (a mensagem diz o porquê), `2` uso errado.

## Os tipos

Cada tipo anda em lotes idempotentes: grava o checkpoint depois de cada lote (os concluídos e o último), confere o
encerramento do worker entre dois lotes e, na retomada, pula os concluídos. O lote que estava em andamento roda de
novo, com o mesmo resultado.

| Tipo | O que faz | Lote e checkpoint | Prévia | Destrutiva |
| --- | --- | --- | --- | --- |
| `acervo.importar` | Importa o acervo de escudos de um pacote no S3 (o `assets:acervo` da [runbook do acervo](acervo-de-logos.md)) | Por país, até `lote` escudos (padrão 100); depois do último, desliga os que saíram do manifesto | Plano como o `--plan` (ligados, desligados, ignorados, lotes) e relatório de cobertura em `tasks/<id da prévia>/cobertura.md` no S3 e em `checkpoint.cobertura` | Sim: religa escudos |
| `assets.espelhar` | Espelha logos, bandeiras e fotos da CDN de mídia no S3 (o `mirror-assets`) | Lotes de `lote` assets (padrão 200) até `limite` (padrão 2000), com o cursor por tipo de asset em `ops.sync_cursor` | Quantos pendentes e quantos lotes | Não |
| `carga.historica` | Carga histórica do futebol (#417): `bootstrap:seasons`, `:details`, `:people` e `:perfis` | Temporadas e detalhes, uma liga por lote; pessoas e perfis, um lote cada | Chamadas de cota que gastaria (rede), do raw (cache) e já feitas | Não (gasta cota) |
| `backfill.normalizar` | Normalização completa raw → core do futebol (o `normalize:football --tudo`) | Um endpoint do raw por lote | Respostas por endpoint | Não |
| `backfill.tabelas` | Recálculo local das tabelas (o `standings:recompute`) | Lotes de `lote` temporadas (padrão 20) | Quantas temporadas | Não |
| `exemplo.eco` | Exemplo e teste da fila (`pausaMs` faz cada lote demorar, para exercitar a drenagem) | Um lote por repetição | Quantos lotes | Não |

Parâmetros (`gs tarefa tipos` mostra todos, com o padrão):

| Tipo | Parâmetros |
| --- | --- |
| `acervo.importar` | `pacote` (`s3://<bucket>/tasks/<id>/<arquivo>.tgz`), `acervo` (id do acervo.yaml), `manifesto` (opcional, `s3://…/<acervo>.yaml`; padrão: o versionado), `lote` |
| `assets.espelhar` | `limite`, `lote`, `descobrirRaw` (padrão sim), `retentarAusentes`, `caminho` (pasta da CDN: `volley`…), `concorrencia` |
| `carga.historica` | `etapas` (lista JSON: `temporadas`, `detalhes`, `pessoas`, `perfis`; padrão todas), `tierMax` (padrão 2), `ligas` (lista JSON de ids da api-sports), `semLive`, `maxChamadasPorLote` |
| `backfill.normalizar` | `endpoints` (lista JSON, ex. `["/fixtures"]`; padrão: todos os do raw) |
| `backfill.tabelas` | `dias` (padrão 4), `temporadas` (lista JSON de ids), `lote` |

Exemplos (no contêiner, troque `pnpm --filter @galaxie/ingestor gs` por `node dist/cli/gs.js`):

```bash
# acervo: o pacote vai antes para o S3 (runbook do acervo); a prévia vai para o painel, onde um admin aprova
gs tarefa enfileirar acervo.importar --previa --param pacote=s3://galaxie-sports-assets/tasks/<id>/acervo-galaxie-proprio.tgz \
  --param acervo=galaxie-proprio --param manifesto=s3://galaxie-sports-assets/tasks/<id>/galaxie-proprio.yaml
# espelho maior que o do horário
gs tarefa enfileirar assets.espelhar --param limite=20000 --param lote=500
# carga Ultra (#417): só as ligas do Brasil e da Argentina, primeiro a prévia de quanto gasta
gs tarefa enfileirar carga.historica --previa --param 'ligas=[71,72,128]' --param semLive=true
gs tarefa enfileirar carga.historica --param 'ligas=[71,72,128]' --param semLive=true --prioridade 5
# backfills
gs tarefa enfileirar backfill.normalizar --param 'endpoints=["/fixtures","/standings"]'
gs tarefa enfileirar backfill.tabelas --param dias=400 --param lote=50
```

- **Cota do dia esgotada** (`carga.historica`): a tarefa não falha. O lote que parou fica pendente e a tarefa volta à
  fila para o próximo dia de cota (00:30 UTC), sem gastar tentativa. No painel ela aparece como **Retomada**, com a
  hora em `run_after` e o motivo no detalhe. O limite de requisições do fornecedor (`rate_limited`) faz o mesmo, com
  volta em 15 min.
- **CDN pedindo pausa** (`assets.espelhar`, 429 em sequência): volta à fila em 30 min.
- **A aprovação vale para o que a prévia viu** (`acervo.importar`): a prévia guarda o sha256 do pacote e do manifesto
  em `checkpoint.prova`. Se o pacote ou o manifesto mudou no S3 (ou o versionado mudou num deploy) antes da execução,
  ela é recusada na hora, sem nova tentativa. Rode outra prévia.
- **Normalização com erro** (`backfill.normalizar`): o endpoint com resposta que não normalizou não conta como feito; a
  tarefa tenta de novo e, esgotadas as tentativas, encerra em falha (as respostas ficam em `ops.normalize_failure`).
  Corrigida a causa, **Reprocessar** continua dos endpoints que faltam.
- **Teto de chamadas do lote** (`carga.historica`, `maxChamadasPorLote`): o lote roda de novo até terminar; o teto só
  divide o trabalho em rodadas menores, com a parada do deploy conferida entre elas.
- **Deploy no meio** (SIGTERM): o executor termina o lote em andamento, grava o checkpoint e a tarefa volta à fila na
  hora (`release`), sem gastar tentativa. O espelho também para no meio do lote e grava o cursor.

CLIs manuais longos que viraram tipo: `assets:acervo` (importação), `assets:mirror`, `bootstrap:seasons`,
`bootstrap:details`, `bootstrap:people`, `bootstrap:perfis`, `normalize:football --tudo` e `standings:recompute`. Os
CLIs continuam funcionando como antes, para rodar como contêiner avulso enquanto não houver worker.

## O scheduler e a fila (QUEUE_MODE)

O job agendado que tem tarefa equivalente (hoje, `assets-mirror` → `assets.espelhar`) segue a variável `QUEUE_MODE`
do contêiner do scheduler:

- `run` (padrão do código): o horário executa o CLI dentro do `ingestor`, como antes do worker. Vale no dev e na
  volta de emergência (`QUEUE_MODE=run` no `.env` da VPS, se o worker estiver fora por muito tempo).
- `enqueue` (o da stack da VPS desde a #542): o horário só enfileira a tarefa, com `dedupe_key` = `<job>:<dia UTC>` (o
  horário seguinte, o catch-up e o "rodar agora" do painel não criam outra enquanto a do dia estiver viva), e o worker
  executa. Tipo destrutivo nunca entra assim: só por prévia e aprovação.

O registro de cada enfileiramento fica em `ops.job_run` do job (`stats.tarefa`, `stats.nova`), com `requested_by` =
`scheduler:<job>` na tarefa.

## O worker

O serviço `worker` da stack (`infra/vps-telemetry/compose.yml`; mesma imagem do ingestor, `node dist/cli/worker.js`)
executa a fila:

- **Laço:** toma a próxima tarefa pronta dos tipos com vaga (`takeNext`, `FOR UPDATE SKIP LOCKED`: dois workers nunca
  pegam a mesma), roda cada uma num **processo filho com heap fixo** (`WORKER_TASK_HEAP_MB`, padrão 160) e renova a
  concessão a cada 30 s, do processo pai. O filho grava o checkpoint a cada lote e encerra a tomada (`finish`). Sem
  tarefa, espera de 1 a 10 s (a fila não tem NOTIFY). O filho que morre sem dizer o destino (heap estourado, código
  134) encerra a tomada em erro, e a tarefa tenta de novo com backoff.
- **Vagas:** `WORKER_CONCURRENCY_<TIPO>` por tipo (`assets.espelhar` → `WORKER_CONCURRENCY_ASSETS_ESPELHAR`; padrão 1,
  o espelho 2; 0 tira o tipo deste worker) e o teto `WORKER_MAX_TASKS` (padrão 2) somando os tipos. Teto de CPU
  `cpus: 1.0`; o `mem_limit` (576m) é a conta do README da stack › Memória dos jobs: mudou o teto ou o heap, refaça.
- **Cota:** as chamadas à api-sports da carga passam pelo Quota Governor, com a reserva do ao vivo. Cota do dia
  esgotada: a tarefa volta à fila para o próximo dia de cota, sem falhar e sem gastar tentativa.
- **SIGTERM (`docker stop`, deploy):** o log diz `drenando`; o worker para de tomar, o lote em andamento fecha
  (prazo `WORKER_DRAIN_S`, padrão 60 s), o checkpoint fica gravado e a tarefa volta à fila na hora (`release`, sem
  gastar tentativa). Passado o prazo, SIGTERM no filho, SIGKILL 5 s depois e o `release` do pai: a tarefa volta do
  último checkpoint. O `stop_grace_period` do serviço (75 s) cobre tudo isso. Com o worker de volta (ou outro no ar),
  a tarefa continua do lote seguinte, e a execução cortada aparece como `interrupted` com a seguinte "retomada".
- **Deploy:** o worker troca no grupo do ingestor (mesma imagem), depois do ingestor e antes da API, lado a lado: o
  novo sobe e fica healthy, e o antigo drena (`rolling-swap.sh` espera o `/health` dizer `idle` ou o prazo de 75 s).
- **Operação:** `/health`, `/version` e `/metrics` na porta 8080 do contêiner, sem router no Traefik. O `/health`
  responde `{ status, worker, idle, draining, task, tasks }`; o `/metrics` (Bearer `METRICS_TOKEN`, raspado pelo
  Prometheus no job `galaxie-services`, `service="worker"`) tem `worker_tasks_running{type}`,
  `worker_task_duration_seconds{type,result}` e `build_info`.

### Ver o que ele roda

```bash
cd /docker/galaxie-sports
docker compose ps worker                                   # no ar e healthy?
docker compose logs -f --tail 50 worker                    # tarefa tomada, encerrada, devolvida, drenando
docker compose exec worker node -e "fetch('http://127.0.0.1:8080/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
docker compose exec worker node dist/cli/gs.js tarefa listar --status running,pending
```

No painel, **Ajustes → Sistema → Tarefas** mostra cada worker (lido das concessões no banco, sem chamar o worker):
**Rodando** com a tarefa, o lote e a última renovação; **Ocioso** com a última tarefa encerrada; **Concessão vencida**
quando ele parou de renovar (caiu ou travou), e a tarefa volta à fila para outro.

### Drenar à mão

Para mexer na VPS, no banco ou no worker sem cortar um lote no meio:

```bash
docker compose stop worker          # SIGTERM: drena (até 75 s) e para; o log diz "drenando" e "drenado"
docker compose logs --tail 20 worker
docker compose up -d worker         # de volta: retoma a tarefa devolvida do lote seguinte
```

Uma tarefa só, sem parar o worker: não há comando; ela não pode ser cancelada rodando. Espere encerrar, ou drene o
worker inteiro como acima.

### Mais de um worker

Os workers dividem a fila sem combinar nada entre si (a concessão e o `SKIP LOCKED` fazem o trabalho). Na mesma VPS:

```bash
docker compose up -d --no-deps --scale worker=2 worker     # dois iguais; o deploy seguinte volta a um
```

Cada cópia soma o `mem_limit` dela (576m) e até 14 conexões do papel `galaxie_ingestor` (README da stack ›
Conexões); confira a folga antes. Para um worker dedicado a um tipo (por exemplo, a carga histórica longe do espelho),
suba um contêiner avulso com as vagas dele, e tire o tipo do serviço:

```bash
docker compose run -d --no-deps --name worker-carga -e WORKER_CONCURRENCY_ASSETS_ESPELHAR=0 \
  -e WORKER_CONCURRENCY_CARGA_HISTORICA=1 -e WORKER_MAX_TASKS=1 worker
docker stop -t 75 worker-carga && docker rm worker-carga   # no fim: drena e sai
```

O contêiner avulso não entra no deploy (que só troca os serviços da lista) nem no healthcheck da stack: pare-o com
`docker stop -t 75`, para ele drenar.

## Pelo painel

**Ajustes → Sistema → Tarefas** (só admin).

- **Lista**: as 100 mais recentes, com filtro por estado (aguardando aprovação, pendentes, retomadas, rodando, falhas,
  concluídas, canceladas), tipo, prioridade, tentativas, idade, worker e barra de progresso.
- **Ver**: abre o detalhe com params, progresso por lote, o plano da prévia (contagens e amostra), log, execuções
  ligadas, checkpoint em JSON e os botões **Cancelar tarefa**, **Reprocessar** e **Aprovar e executar**.
- **Enfileirar**: o formulário monta os campos pelo schema do tipo (texto, número, sim/não, lista, JSON). O servidor
  valida de novo antes de pôr na fila; o erro volta por campo.

Cada botão pede confirmação, roda uma server action que confere a sessão de admin e grava o e-mail de quem clicou em
`requested_by` da tarefa criada.

## Estados

| No painel | `status` no banco | Quer dizer |
| --- | --- | --- |
| Pendente | `pending`, sem `run_id` | Na fila, nunca tomada |
| Retomada | `pending`, com `run_id` | Já rodou e voltou: concessão vencida, `release` do deploy ou nova tentativa depois de erro. A próxima tomada continua do checkpoint |
| Rodando | `running` | Um worker tem a concessão (coluna Worker) |
| Concluída | `done` | Terminou. Prévia concluída com plano e sem aprovação aparece também como **aguarda aprovação** |
| Falha | `error` | Gastou as tentativas, ou foi recusada pela regra |
| Cancelada | `canceled` | Alguém cancelou enquanto estava pendente |

## Retomadas

O worker grava o progresso em `checkpoint` (substitui o anterior) e renova a concessão a cada 30 s. Se o contêiner
cai, a concessão vence em 90 s e o próximo worker pega a tarefa com o último checkpoint; no deploy, o `SIGTERM` devolve
a tarefa na hora, sem gastar tentativa. A execução cortada fecha como `interrupted` e a seguinte aparece como
"retomada" no detalhe. Nada a fazer à mão: retomar é o padrão.

Convenções do checkpoint que o painel e a CLI mostram:

| Chave | Formato | Mostra |
| --- | --- | --- |
| `progresso` | `{ feitos, total?, lote? }` | Barra e "3 de 10 · Lote: Brasil" |
| `log` | lista de linhas (as últimas 20) | Log resumido |
| `previa` | `{ resumo?, contagens, amostra }` | O plano da prévia, antes do botão de aprovar |

O resto do checkpoint é livre e aparece em JSON.

## Quando algo dá errado

- **Tarefa pendente há muito tempo**: nenhum worker roda aquele tipo (vaga 0 em `WORKER_CONCURRENCY_<TIPO>`), as
  vagas estão ocupadas por tarefas longas, ou o worker está fora. O alerta `TarefaPendenteAntiga` dispara com tarefa
  pronta há mais de 1 h. Confira `docker compose ps worker`, o `/health` e a seção Workers do painel.
- **Worker com concessão vencida no painel**: ele parou de renovar. Veja `docker compose logs worker`; o healthcheck
  reinicia o contêiner travado, e a tarefa volta à fila do checkpoint (a tomada cortada gasta a tentativa).
- **Falha**: `gs tarefa ver <id>` mostra o último erro e cada execução. Corrigida a causa, **Reprocessar** cria uma
  tarefa nova com os mesmos params.
- **Reprocessar a execução aprovada de um tipo destrutivo** volta como **prévia**: o plano antigo pode não valer mais, e
  alguém aprova de novo.
- **Prévia concluída sem plano** (`checkpoint.previa` vazio): o executor não gravou o resultado; reprocesse a prévia.
- **Cancelar a que está rodando**: não dá pelo painel nem pela CLI (o worker é dono dela). Espere encerrar.

## Para quem registra um tipo novo (#543)

1. Declare o tipo em `TASK_TYPES` (`packages/db/src/queue-types.ts`) com `defineTaskType`: `type`, `descricao`,
   schema zod dos `params` (sem `previa`, `previaId` e `reprocessaDe`, que são do sistema), `previa`, `destrutiva` e,
   se a tarefa é longa, `maxAttempts`.
2. Escreva o executor e registre em `TASK_HANDLERS` (`services/ingestor/src/tasks/run.ts`). Ele recebe `db`, `params`,
   `previa`, `previaId`, o `checkpoint` anterior, `save` para gravar o progresso e `checkStop`/`signal` do
   encerramento. Em prévia, grave `checkpoint.previa` e não mude nada. Continue do checkpoint: o trecho depois do
   último `save` se repete na retomada. O laço de lotes pronto é `runLots` (`src/tasks/lotes.ts`); para continuar
   depois (cota), devolva `runAfter` no resultado.
3. CLI e painel passam a mostrar o tipo e o formulário sozinhos, pelo schema.

O upload de pacote pelo painel direto para o S3 ainda não existe: o pacote do `acervo.importar` sobe pelo `aws s3 cp`
do contêiner `s3-init` ([runbook do acervo](acervo-de-logos.md#produção-vps)).
