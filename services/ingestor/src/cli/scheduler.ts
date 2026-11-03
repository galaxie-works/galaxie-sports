/**
 * Scheduler do ingestor (contêineres `ingestor` e `live` da stack): roda os CLIs do pacote em horários fixos (UTC), um
 * processo por execução, registrando cada uma em ops.job_run. `SCHEDULER_PROFILE` escolhe os jobs (`jobsForProfile`):
 * `ingestor` (padrão) ou `live` (só a faixa do ao vivo, com o `live-run` sempre no ar e `LIVE_LEADER=on`, #535). No
 * ingestor, `SCHEDULER_LIVE=external` tira a faixa do ao vivo (ela roda no serviço `live`); o padrão `internal` a mantém.
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
import { jobsForProfile, schedulerLiveMode } from '../scheduler/schedule.js';

// Os agentes de IA já tiveram um perfil aqui (`SCHEDULER_PROFILE=agents`); hoje a entrada deles é outra. Falhar alto
// evita subir o scheduler errado, com a agenda do ingestor, num contêiner de agentes.
const requested = process.env.SCHEDULER_PROFILE?.trim().toLowerCase() || 'ingestor';
if (requested !== 'ingestor' && requested !== 'live') {
  console.error(
    `SCHEDULER_PROFILE=${requested}: este scheduler roda os perfis ingestor e live. Os agentes de IA têm entrada própria: ` +
      'node dist/cli/agents-scheduler.js no pacote @galaxie/ai-agents (a imagem do ingestor traz os dois; ' +
      'o CMD escolhe pelo SCHEDULER_PROFILE).',
  );
  process.exit(2);
}
const profile = requested;
let liveMode: ReturnType<typeof schedulerLiveMode>;
try {
  liveMode = schedulerLiveMode(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}
/** Este scheduler roda a faixa do ao vivo: o serviço `live`, ou o ingestor com SCHEDULER_LIVE=internal. */
const runsLive = profile === 'live' || liveMode === 'internal';
if (profile === 'live') {
  // sem a eleição, duas cópias chamariam a api-sports juntas: o live-run do perfil live não tem a trava por job
  const leader = process.env.LIVE_LEADER?.trim();
  if (leader && leader !== 'on') {
    console.error(
      `LIVE_LEADER=${leader}: o perfil live roda o live-run com líder e reserva (LIVE_LEADER=on); sem a eleição, use o ` +
        'perfil ingestor com SCHEDULER_LIVE=internal.',
    );
    process.exit(2);
  }
  // os jobs herdam o env do scheduler (e o perfil, que o contextFromEnv lê para os tempos do banco)
  process.env.LIVE_LEADER = 'on';
}

await runScheduler({
  profile,
  jobs: jobsForProfile(profile, process.env),
  packageRoot: fileURLToPath(new URL('../../', import.meta.url)),
  log: logger.child({ component: 'scheduler' }),
  // o live-run é um processo filho sem servidor: o ritmo dele sai daqui, lido do Postgres a cada coleta (#538). Só no
  // scheduler que roda o ao vivo: com o serviço `live` no ar, o ingestor não repete as séries
  metrics: runsLive
    ? (db) => (registry) =>
        registerLiveTickMetrics(registry, db, {
          onCollectorError: (collector, err) =>
            logger.warn({ err, collector }, 'não foi possível ler o ritmo do ao vivo para o /metrics'),
        })
    : undefined,
});
