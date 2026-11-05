# @galaxie/scheduler

O motor de agendamento que o [ingestor](../../services/ingestor/README.md) e os [agentes de IA](../../services/ai-agents/README.md)
compartilham. Cada serviço tem a própria entrada (`dist/cli/scheduler.js` e `dist/cli/agents-scheduler.js`), que só diz
qual é o perfil, quais são os jobs e onde fica a raiz do seu pacote; o resto é daqui.

## O que faz

- **Cron em UTC** com sobrescrita por variável (`SCHEDULE_<JOB>=<cron>|off`) e pelo painel de Operação
  (`ops.runtime_setting`, banco > env > padrão), sem reiniciar o contêiner.
- **Um processo filho por job** (`runJob`), com heap e tempo limite próprios, registrado em `ops.job_run`. O `script` de cada
  job é relativo à raiz do pacote do serviço que agenda (`packageRoot`).
- **Uma execução por job em todo o banco** (advisory lock de sessão) e teto de jobs simultâneos (`SCHEDULER_MAX_JOBS`).
  Job com `lock: 'instance'` tem uma trava por cópia do scheduler (`<job>@<cópia>`, com a cópia em `stats.instance` da
  execução): para o job que se coordena sozinho entre as cópias, como o `live-run` com líder e reserva.
- **Job que fica no ar** (`keepAlive`): sem cron; sobe com o serviço e de novo quando sai (1 s, dobrando a cada saída
  rápida até 60 s). Não ocupa vaga do teto.
- **Catch-up da partida**: o horário perdido com o scheduler fora do ar roda uma vez na volta; o `running` deixado por
  um processo que caiu é fechado.
- **Pedidos do painel** ("rodar agora", `ops.job_request`) e relato do env (`ops.runtime_env`).
- **Crédito da conta de IA** (`checkAiCredit`), só no perfil `agents`.

As variáveis e os modos (`--list`, `--run <job>`) estão no cabeçalho de [`src/cli.ts`](src/cli.ts).

## Como usar

```ts
import { runScheduler, MINUTE, type ScheduledJob } from '@galaxie/scheduler';

const JOBS: readonly ScheduledJob[] = [
  { name: 'meu-job', description: '…', cron: '*/5 * * * *', script: 'dist/cli/meu-job.js', args: [], timeoutMs: 15 * MINUTE },
];

await runScheduler({ profile: 'ingestor', jobs: JOBS, packageRoot, log });
```

Os perfis são `ingestor`, `live` (o ao vivo, que roda com a entrada do ingestor) e `agents`: o perfil também é o nome do
serviço no registro do painel (`@galaxie/runtime-config`) e no `/health` e `/version`. Job novo entra na lista do serviço dono (`services/ingestor/src/scheduler/schedule.ts` ou
`services/ai-agents/src/scheduler/jobs.ts`) e no registro `SCHEDULED_JOBS` do `runtime-config`; os testes de cada serviço
conferem que os dois batem.

## Depende de

`@galaxie/db`, `@galaxie/runtime-config`, `@galaxie/observability` (só o tipo do logger).

## Usado por

`services/ingestor`, `services/ai-agents`.
