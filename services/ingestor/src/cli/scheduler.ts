/**
 * Scheduler do ingestor (container `ingestor` do staging): roda os CLIs existentes em horários fixos (UTC),
 * um processo por execução, registrando cada uma em ops.job_run.
 *
 *   node dist/cli/scheduler.js               # inicia (fica no ar; SIGTERM encerra com elegância)
 *   node dist/cli/scheduler.js --list        # mostra a agenda efetiva e as próximas execuções
 *   node dist/cli/scheduler.js --run <job>   # executa um job agora (registrado) e sai com o código dele
 *
 * Variáveis: SCHEDULER_PROFILE=ingestor|agents (conjunto de jobs; `agents` = agentes de IA)
 *            SCHEDULE_<JOB>=<cron>|off · SCHEDULER_RUN_ON_START=job1,job2 · SCHEDULER_TIMEOUT_MINUTES
 *            SCHEDULER_HEARTBEAT_FILE (padrão /tmp/galaxie-scheduler.heartbeat, usado no healthcheck)
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Cron } from 'croner';
import { closeDb, createDb, type Database } from '@galaxie/db';
import { logger, report } from '../logger.js';
import { PgRunRecorder, runJob, type RunResult } from '../scheduler/runner.js';
import { nextRuns, scheduleFromEnv } from '../scheduler/schedule.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const log = logger.child({ component: 'scheduler' });
const jobs = scheduleFromEnv();
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? '') : undefined;
};

if (process.argv.includes('--list')) {
  report(
    `Agenda do scheduler — perfil ${process.env.SCHEDULER_PROFILE ?? 'ingestor'} (UTC)`,
    jobs.map((j) => ({
      job: j.name,
      cron: j.cron,
      script: j.script,
      next: nextRuns(j, 2).map((d) => d.toISOString()),
      description: j.description,
    })),
  );
  process.exit(0);
}

const db: Database | undefined = process.env.DATABASE_URL
  ? createDb(process.env.DATABASE_URL, { max: 2 })
  : undefined;
if (!db) log.warn('DATABASE_URL não definida: as execuções não serão registradas em ops.job_run');
const recorder = db ? new PgRunRecorder(db) : undefined;
const running = new Set<Promise<RunResult>>();
/** Abortado no encerramento: os jobs em andamento recebem SIGTERM (o ao vivo fecha o tick e sai). */
const shutdownController = new AbortController();

function execute(name: string, trigger: 'schedule' | 'manual' | 'start'): Promise<RunResult> {
  const job = jobs.find((j) => j.name === name);
  if (!job)
    throw new Error(
      `Job desconhecido ou desligado: "${name}". Disponíveis: ${jobs.map((j) => j.name).join(', ')}`,
    );
  const run = runJob(job, {
    cwd: packageRoot,
    recorder,
    logger: log,
    trigger,
    signal: shutdownController.signal,
  });
  running.add(run);
  void run.finally(() => running.delete(run));
  return run;
}

const manual = arg('--run');
if (manual !== undefined) {
  const result = await execute(manual, 'manual');
  if (db) await closeDb(db);
  process.exit(result.status === 'ok' ? 0 : 1);
}

// ── modo serviço ──────────────────────────────────────────────────────────────────────────────────
const heartbeatFile = process.env.SCHEDULER_HEARTBEAT_FILE ?? '/tmp/galaxie-scheduler.heartbeat';
const beat = () =>
  writeFile(heartbeatFile, new Date().toISOString()).catch((err: unknown) =>
    log.warn({ err, file: heartbeatFile }, 'não foi possível gravar o heartbeat'),
  );
await beat();
const heartbeat = setInterval(() => void beat(), 30_000);

const crons = jobs.map(
  (job) =>
    new Cron(
      job.cron,
      {
        name: job.name,
        timezone: 'UTC',
        mode: '5-part',
        // não sobrepõe execuções do mesmo job
        protect: () =>
          log.warn({ job: job.name }, 'execução anterior ainda em andamento; pulando este horário'),
        catch: (err: unknown) => log.error({ err, job: job.name }, 'erro no agendamento'),
      },
      async () => {
        await execute(job.name, 'schedule');
      },
    ),
);
log.info(
  { jobs: jobs.map((j) => ({ job: j.name, cron: j.cron, next: nextRuns(j, 1)[0]?.toISOString() })) },
  'scheduler iniciado',
);

for (const name of (process.env.SCHEDULER_RUN_ON_START ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  void execute(name, 'start').catch((err: unknown) =>
    log.error({ err, job: name }, 'falha no job de partida'),
  );
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal, running: running.size }, 'encerrando scheduler; aguardando jobs em andamento');
  for (const c of crons) c.stop();
  clearInterval(heartbeat);
  shutdownController.abort();
  await Promise.race([Promise.allSettled([...running]), new Promise((r) => setTimeout(r, 25_000))]);
  if (db) await closeDb(db);
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
