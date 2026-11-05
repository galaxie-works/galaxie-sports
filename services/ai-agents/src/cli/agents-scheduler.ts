/**
 * Scheduler dos agentes de IA (contêiner `agents` da stack): roda os CLIs deste pacote em horários fixos (UTC), um
 * processo por execução, registrando cada uma em ops.job_run. Roda mesmo com o ingestor parado.
 *
 *   node dist/cli/agents-scheduler.js               # inicia (fica no ar; SIGTERM encerra com elegância)
 *   node dist/cli/agents-scheduler.js --list        # mostra a agenda efetiva e as próximas execuções
 *   node dist/cli/agents-scheduler.js --run <job>   # executa um job agora (registrado) e sai com o código dele
 *
 * O motor é o `@galaxie/scheduler`, o mesmo do ingestor. Os jobs estão em `../scheduler/jobs.ts`; as variáveis
 * (SCHEDULE_<JOB>, SCHEDULER_*) estão em `packages/scheduler/src/cli.ts`. O `script` de cada job é relativo à raiz
 * deste pacote, achada a partir deste arquivo, e não a uma pasta irmã da imagem.
 */
import { fileURLToPath } from 'node:url';
import { createLogger } from '@galaxie/observability';
import { runScheduler } from '@galaxie/scheduler';
import { AGENT_JOBS } from '../scheduler/jobs.js';

await runScheduler({
  profile: 'agents',
  jobs: AGENT_JOBS,
  packageRoot: fileURLToPath(new URL('../../', import.meta.url)),
  log: createLogger({ service: 'agents' }).child({ component: 'scheduler' }),
});
