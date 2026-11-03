/**
 * Scheduler do ingestor (contêiner `ingestor` da stack): roda os CLIs do pacote em horários fixos (UTC), um processo por
 * execução, registrando cada uma em ops.job_run.
 *
 *   node dist/cli/scheduler.js               # inicia (fica no ar; SIGTERM encerra com elegância)
 *   node dist/cli/scheduler.js --list        # mostra a agenda efetiva e as próximas execuções
 *   node dist/cli/scheduler.js --run <job>   # executa um job agora (registrado) e sai com o código dele
 *
 * O motor (cron, processo filho, trava, catch-up, painel) é o `@galaxie/scheduler`, o mesmo dos agentes de IA, que
 * têm entrada própria em `services/ai-agents` (`dist/cli/agents-scheduler.js`). Os jobs deste perfil estão em
 * `../scheduler/schedule.ts`; as variáveis (SCHEDULE_<JOB>, SCHEDULER_*) estão em `packages/scheduler/src/cli.ts`.
 */
import { fileURLToPath } from 'node:url';
import { registerLiveTickMetrics } from '@galaxie/observability';
import { runScheduler } from '@galaxie/scheduler';
import { logger } from '../logger.js';
import { DEFAULT_JOBS } from '../scheduler/schedule.js';

// Os agentes de IA já tiveram um perfil aqui (`SCHEDULER_PROFILE=agents`); hoje a entrada deles é outra. Falhar alto
// evita subir o scheduler errado, com a agenda do ingestor, num contêiner de agentes.
const requested = process.env.SCHEDULER_PROFILE?.trim().toLowerCase();
if (requested && requested !== 'ingestor') {
  console.error(
    `SCHEDULER_PROFILE=${requested}: este scheduler roda só o perfil ingestor. Os agentes de IA têm entrada própria: ` +
      'node dist/cli/agents-scheduler.js no pacote @galaxie/ai-agents (a imagem do ingestor traz os dois; ' +
      'o CMD escolhe pelo SCHEDULER_PROFILE).',
  );
  process.exit(2);
}

await runScheduler({
  profile: 'ingestor',
  jobs: DEFAULT_JOBS,
  packageRoot: fileURLToPath(new URL('../../', import.meta.url)),
  log: logger.child({ component: 'scheduler' }),
  // o live-run é um processo filho sem servidor: o ritmo dele sai daqui, lido do Postgres a cada coleta (#538)
  metrics: (db) => (registry) =>
    registerLiveTickMetrics(registry, db, {
      onCollectorError: (collector, err) =>
        logger.warn({ err, collector }, 'não foi possível ler o ritmo do ao vivo para o /metrics'),
    }),
});
