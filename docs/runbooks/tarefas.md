# Tarefas da fila

Trabalho avulso e longo (carga Ultra, backfill, acervo, espelho) entra numa fila no Postgres (`ops.job_request` com
`type`) e é retomado do checkpoint se o contêiner cair. Este runbook cobre o lado de quem pede: enfileirar pela CLI ou
pelo painel, a prévia com aprovação, acompanhar, cancelar e reprocessar. O contrato da fila para quem escreve worker
está em [packages/db/README.md](../../packages/db/README.md#fila-de-tarefas).

> **Estado (#544):** a CLI, o painel e a regra da prévia estão prontos, com um tipo de exemplo (`exemplo.eco`). O
> serviço `worker` que toma as tarefas (#542) e os tipos reais (#543) vêm depois: até lá, a tarefa enfileirada fica
> pendente.

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
de executar (`checkRunnable`): uma tarefa destrutiva que pulou a regra pelo `enqueue` direto encerra em erro sem rodar.
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

- **Tarefa pendente há muito tempo**: nenhum worker roda aquele tipo, ou o worker está fora. O alerta
  `TarefaPendenteAntiga` dispara com tarefa pronta há mais de 1 h. Confira o serviço worker.
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
2. Escreva o executor e registre em `TASK_HANDLERS` (`services/ingestor/src/tasks/run.ts`). Ele recebe `params`,
   `previa`, `previaId`, o `checkpoint` anterior e `save` para gravar o progresso. Em prévia, grave `checkpoint.previa`
   e não mude nada. Continue do checkpoint: o trecho depois do último `save` se repete na retomada.
3. CLI e painel passam a mostrar o tipo e o formulário sozinhos, pelo schema.

O upload de pacote pelo painel direto para o S3 ainda não existe: entra com o tipo do acervo (#543).
