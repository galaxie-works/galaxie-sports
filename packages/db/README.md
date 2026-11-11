# @galaxie/db

Dono do schema do banco. Define as tabelas em Drizzle, guarda as migrations e expõe o cliente, o migrator e alguns
helpers de banco compartilhados (trava de job, change feed, grades, widgets, vídeos relacionados).

| Schema Postgres | Conteúdo |
|---|---|
| `raw` | Respostas brutas da api-sports, imutáveis (reprocessar não gasta cota) |
| `core` | Modelo canônico: eventos, competições, temporadas, times, pessoas, classificação, assets |
| `semantic` | Base semântica carregada de `data/knowledge` (clássicos, apelidos, copy) |
| `enrich` | O que a IA e as fontes externas acrescentam (onde assistir, contexto, resumos, vídeos) |
| `multisport` · `equestrian` | Olimpíadas/Pan e hipismo |
| `api` | Tenants, chaves, uso, webhooks, widgets do Builder |
| `ops` | Cota, cursores de sync, jobs, change feed, uso de LLM, configuração em tempo de execução |
| `cosmos` | Cosmos AI: carteira de créditos por tenant, extrato, reservas e catálogo de funções (regras em `@galaxie/cosmos`) |
| `fan` | Identidade do torcedor (#937): Conta, Perfil e registro de exclusão, só ids pseudônimos do cliente. Só a API escreve; agentes e ingestor não leem (docs/05 §9) |

Modelo completo: [docs/04](../../docs/04-modelo-de-dados.md).

## Papéis por serviço

`src/roles.ts` define um papel de login por serviço (sem superusuário, sem DDL), e o `migrate` aplica os GRANTs e o
`CONNECTION LIMIT` de cada um a cada deploy (`DB_ROLES=on`). A URL do serviço (`DB_URL_<SERVIÇO>`) troca o dono pelo
papel. Detalhes e passo a passo: [runbook](../../docs/runbooks/papeis-do-banco.md).

| Papel | URL | Lê | Escreve | Conexões |
|---|---|---|---|---|
| `galaxie_api` | `DB_URL_API` | todos os schemas | `api`, `enrich`, `ops` | 45 |
| `galaxie_demo` | `DB_URL_DEMO` | todos, menos `raw` | `ops`, `semantic`, `enrich`, `api`, `core.asset` (dona do `demo_auth`) | 30 |
| `galaxie_ingestor` | `DB_URL_INGESTOR` | todos | `raw`, `core`, `ops`, `semantic`, `enrich`, `multisport`, `equestrian` | 40 |
| `galaxie_agents` | `DB_URL_AGENTS` | todos | `enrich`, `semantic`, `ops`, `core.asset`, `api.tenant_channel_list` | 25 |
| `galaxie_live` | `DB_URL_LIVE` | `core`, `ops`, `raw`, `semantic` | `core`, `raw.api_response`, `ops.change_feed`, `ops.job_run`, `ops.sync_cursor`, `ops.quota_*` | 36 |
| `galaxie_backup` | `DB_URL_BACKUP` | tudo | `ops.job_run` (`CREATEDB` para o ensaio de restauração) | 6 |

Tempos por perfil de conexão (`createDb({ profile })`): `api` 10 s de consulta, `live` 30 s, `job` 10 min, `migrate` sem
teto de consulta.

## Como usar

```bash
pnpm db:migrate     # na raiz: aplica as migrations (idempotente)
pnpm db:generate    # gera migration a partir de src/schema (commite drizzle/)
pnpm db:studio      # Drizzle Studio
```

Mudou `src/schema`? Rode `pnpm db:generate` e commite a pasta `drizzle/`; o CI falha com drift e confere o `when` do
journal (CONTRIBUTING, regra 2). `DB_ROLES` cria os papéis de banco por serviço (`src/roles.ts`).

## Fila de tarefas

`@galaxie/db/queue` é a fila de trabalho longo no Postgres, para o que não pode morrer quando o contêiner é recriado no
deploy (importação do acervo, espelho de assets, carga histórica). Mora em `ops.job_request`, nas linhas com `type`; a
linha sem `type` continua sendo pedido de "rodar agora" do painel, e o `job` da tarefa leva o prefixo `fila:` para o
scheduler nunca alcançá-la. Cada tomada abre uma linha em `ops.job_run` (`job` = tipo, `request_id` = tarefa).

```text
              enqueue
                 │
                 ▼
      ┌──────► pending ◄─────────────────────────────────┐
      │          │ takeNext (prioridade, run_after;      │
      │          │ SKIP LOCKED; attempts + 1)            │
      │          ▼                                       │
      │       running ───── release (SIGTERM) ───────────┤ devolve a tentativa
      │        │  │  │                                   │ run: interrupted
      │        │  │  └───── concessão vencida ───────────┤ gasta a tentativa
      │        │  │         (próximo takeNext)            │ run: interrupted
      │        │  │                                       │
      │        │  └──────── finish(error), sobra tentativa ┘ run_after + backoff
      │        │                                            run: error
      │        ├── finish(ok, { runAfter }) ── volta a pending em run_after,
      │        │   (cota do dia esgotada)     devolve a tentativa; run: ok
      │        ├──────────► done     finish(ok)             run: ok
      │        └──────────► error    finish(error) ou concessão vencida
      │                              na última tentativa    run: error
      └── renew (a cada 30 s) e checkpoint não mudam o estado
```

| Operação | O que faz | Devolve |
|---|---|---|
| `enqueue(db, { type, params, priority, runAfter, dedupeKey, maxAttempts, requestedBy })` | Cria a tarefa. Com `dedupeKey`, só uma viva (pendente ou em execução) por tipo e chave, para o scheduler não enfileirar duas vezes | `{ id, created }` |
| `takeNext(db, workerId, types)` | Fecha as concessões vencidas dos `types` e toma a próxima pronta, maior prioridade e `run_after` mais antigo primeiro. Concessão de 90 s | `QueueTask` ou `null` |
| `renew(db, task)` | Empurra a concessão por mais 90 s. O worker chama a cada 30 s | `boolean` |
| `checkpoint(db, task, data)` | Grava o progresso (substitui o anterior) | `boolean` |
| `finish(db, task, 'ok' \| 'error', detail, { callsSpent, stats, runAfter })` | Encerra a tomada. No erro, nova tentativa com backoff (30 s, 1 min, 2 min… até 1 h) até `max_attempts`. `ok` com `runAfter`: a tarefa não acabou e só continua depois (cota do dia esgotada); volta a pendente para aquele instante, com o checkpoint e sem gastar tentativa | `'done' \| 'retry' \| 'error' \| 'deferred'` ou `null` |
| `release(db, task)` | No SIGTERM: volta para pendente na hora, com o checkpoint, e devolve a tentativa | `boolean` |

O contrato para quem escreve um worker:

- **A tomada é a prova da posse.** `renew`, `checkpoint`, `finish` e `release` recebem o `task` do `takeNext` e só valem
  para a tomada corrente (pelo `run_id`). `false` ou `null` quer dizer que a concessão venceu e outro worker retomou: **pare
  de trabalhar**, sem gravar mais nada.
- **Retomar é o padrão.** Toda tomada recebe o `checkpoint` da anterior. A tarefa precisa continuar dele e aguentar repetir
  o último trecho, porque o que veio depois do último `checkpoint` se perde.
- **Retomada não é falha.** A execução cortada por `release` ou concessão vencida fecha como `interrupted`, a seguinte grava
  `resumed_from` e `galaxie_job_consecutive_failures` não sobe. Nova tentativa depois de um `finish(error)` recebe o
  checkpoint, mas não é retomada (`resumed_from` nulo): a anterior falhou de fato.
- **Tentativas.** `attempts` conta ao tomar, `release` devolve. Deploy com SIGTERM não gasta tentativa. Queda sem `release`
  gasta, senão a tarefa que derruba o worker o derrubaria para sempre; na última, a tarefa encerra em erro. Tarefa longa que
  pode cair várias vezes sem culpa pede um `maxAttempts` maior no `enqueue`.
- **O relógio é o do banco.** Prazos e `run_after` usam `now()` do Postgres, não o do contêiner.

Métricas (`/metrics`): `galaxie_queue_tasks_pending`, `galaxie_queue_tasks_running`,
`galaxie_queue_oldest_pending_age_seconds`, `galaxie_queue_resumed_24h` e `galaxie_queue_failed_24h`, todas por `type`.
Alerta: `TarefaPendenteAntiga`, com tarefa pronta há mais de 1 h sem worker pegar. Retenção: encerrada sai depois de
30 dias, com o checkpoint; viva fica, por mais velha.

### Tipos de tarefa, prévia e operação

`@galaxie/db/queue-types` é o registro dos tipos (`TASK_TYPES`): descrição, schema zod dos `params`, se roda em prévia
(`previa`) e se apaga, troca ou religa dados (`destrutiva`). `@galaxie/db/queue-admin` é o lado de quem pede, usado
pela CLI `gs tarefa` e pelo painel (Ajustes → Sistema → Tarefas): `requestTask` (valida pelo registro), `listTasks`,
`getTask`, `cancelTask` (só pendente; estado `canceled`), `reprocessTask` (nova, com `params.reprocessaDe`) e
`approvePreview`.

- **Prévia**: tarefa comum com `params.previa = true`; o executor grava o plano em `checkpoint.previa`
  (`{ resumo?, contagens, amostra }`) e não muda nada.
- **Aprovação**: `approvePreview` enfileira a execução de verdade com os mesmos params e `params.previaId`, uma por
  prévia (`dedupe_key` `previa:<id>`).
- **Destrutiva**: `requestTask` recusa sem prévia, e o worker confere de novo antes de executar: `checkRunnable` (regra
  e params) e `checkApproval` (o `previaId` aponta para uma prévia concluída do mesmo tipo e esta é a execução que a
  aprovação criou). A aprovação trava a linha da prévia, então duas aprovações nunca criam duas execuções.
- `previa`, `previaId` e `reprocessaDe` são chaves reservadas dos `params`: nenhum tipo declara, quem pede não manda.
- Convenções do checkpoint que o painel mostra: `progresso` (`{ feitos, total?, lote? }`), `log` (últimas 20 linhas)
  e `previa`.

Os executores moram no worker (`services/ingestor/src/tasks/run.ts`: `TASK_HANDLERS` e `runTask`). Tipos registrados:
`exemplo.eco`, `acervo.importar` (destrutiva), `assets.espelhar`, `carga.historica`, `backfill.normalizar` e
`backfill.tabelas`. O executor recebe o `signal` do encerramento e confere entre os lotes (`checkStop`): a tarefa
interrompida volta à fila com `release`. O worker (`services/ingestor/src/worker`, o serviço `worker` da stack) toma no
processo pai, roda o `runTask` num processo filho com heap fixo e renova a concessão do pai (`leaseLost` no `runTask`).
Com QUEUE_MODE=enqueue, o scheduler só enfileira os jobs que declaram `task` (`@galaxie/scheduler`, `queue-mode.ts`).
Passo a passo de operação:
[docs/runbooks/tarefas.md](../../docs/runbooks/tarefas.md).

## Migrations: expandir e contrair

A troca de versão no deploy é lado a lado, e o candidato aplica a migration **antes** da troca: por alguns segundos a
versão antiga e a nova rodam sobre o mesmo schema. Por isso toda migration precisa servir às duas, e o que quebra a
antiga (contrair) só sai num deploy seguinte, depois que nenhum código usa mais o que vai embora.

| Expandir: em qualquer PR | Contrair: só em PR próprio, com o rótulo `contrair` |
|---|---|
| `CREATE TABLE`, `ADD COLUMN` opcional (ou com `DEFAULT`) | `DROP TABLE`, `DROP COLUMN`, `DROP CONSTRAINT`, `DROP INDEX` (mesmo o trocado por outro) |
| `CREATE INDEX` (em tabela grande, com `-- galaxie:concurrently`) | `RENAME` de tabela, coluna, constraint ou índice |
| tabela ou coluna nova que o código novo lê e o antigo ignora | `ALTER COLUMN … TYPE`, `SET NOT NULL`, `ADD COLUMN … NOT NULL` sem `DEFAULT`, `TRUNCATE` |

Ordem para tirar ou trocar algo: (1) PR que expande e passa o código para o novo; (2) deploy; (3) PR que contrai,
rotulado `contrair`, depois que o deploy do passo 2 está no ar e estável. Com uma migration `contrair` aplicada, **voltar
o código para a versão anterior é proibido** (a antiga quebra no schema novo; o `restore_previous` do `deploy-gh.sh` já
recusa a volta com migration nova aplicada): o caminho é corrigir para frente, ou o dump de antes do migrate.

O CI confere: o passo "Migration destrutiva sem o rótulo contrair" lê os `.sql` que o PR acrescenta em `drizzle/`
(`src/destructive-migrations.ts`) e reprova o PR sem o rótulo `contrair`; na fila de merge e no push na main só avisa.
O rótulo `contrair` existe no repositório; depois de colocá-lo, reexecute o job `checks` (o rótulo é lido na hora).
Regras, receitas (renomear coluna, mudar tipo, tornar obrigatória, trocar índice) e o que o check não pega:
[docs/runbooks/migrations.md](../../docs/runbooks/migrations.md).

## Depende de

Nenhum pacote do repo. Precisa de Postgres 17 (`DATABASE_URL`).

## Usado por

Todos os apps e serviços, e `apisports-client`, `ai-ledger`, `knowledge`, `observability`, `rules`, `where-to-watch`.
