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
 *            SCHEDULER_REFRESH_SECONDS (padrão 30): releitura da configuração do painel e dos pedidos
 *
 * O painel de Ajustes → Operação sobrescreve as flags pelo banco (ops.runtime_setting): banco > env >
 * padrão. As agendas mudadas são reprogramadas sem reinício e cada job recebe o env efetivo.
 *
 * Cada job roda em um processo por vez em todo o banco (advisory lock de sessão, solto quando o processo
 * cai): se outro scheduler já está rodando o job, a execução é pulada (o `--run` sai com código 1).
 * SCHEDULER_TIMEOUT_MINUTES não vale para o ao vivo, que tem tempo limite próprio.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { closeDb, createDb, tryJobLock, type Database } from '@galaxie/db';
import { logger, report } from '../logger.js';
import { checkAiCredit } from '../scheduler/ai-credit.js';
import { PgRunRecorder, runJob } from '../scheduler/runner.js';
import { jobsForProfile } from '../scheduler/schedule.js';
import { describeSchedule, SchedulerService, type SchedulerProfile } from '../scheduler/service.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const log = logger.child({ component: 'scheduler' });
const profile = (process.env.SCHEDULER_PROFILE?.trim().toLowerCase() || 'ingestor') as SchedulerProfile;
const definitions = jobsForProfile(profile);
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? '') : undefined;
};

const databaseUrl = process.env.DATABASE_URL;
const db: Database | undefined = databaseUrl ? createDb(databaseUrl, { max: 2 }) : undefined;
if (!db) log.warn('DATABASE_URL não definida: as execuções não serão registradas em ops.job_run');
const recorder = db ? new PgRunRecorder(db) : undefined;
/** Abortado no encerramento: os jobs em andamento recebem SIGTERM (o ao vivo fecha o tick e sai). */
const shutdownController = new AbortController();

const service = new SchedulerService({
  profile,
  jobs: definitions,
  env: process.env,
  db,
  log,
  refreshMs: Number(process.env.SCHEDULER_REFRESH_SECONDS ?? 30) * 1000 || 30_000,
  creditCheck: profile === 'agents' ? (env) => checkAiCredit(env) : undefined,
  run: (job, { trigger, env }) =>
    runJob(job, {
      cwd: packageRoot,
      env,
      recorder,
      logger: log,
      trigger,
      signal: shutdownController.signal,
      // um processo por job em todo o banco: o `--run` no console ou um contêiner sobreposto no deploy
      // não dobram o ao vivo (trava de sessão: some sozinha se este processo cair)
      lock: databaseUrl
        ? (name) =>
            tryJobLock(databaseUrl, name, {
              onLost: () =>
                log.warn(
                  { job: name },
                  'conexão da trava do job caiu com o job rodando; outro processo pode iniciá-lo em paralelo',
                ),
            })
        : undefined,
    }),
});

if (process.argv.includes('--list') || arg('--run') !== undefined) {
  // a agenda e o env efetivos já com a configuração do painel (banco > env > padrão)
  await service.refresh();
}

if (process.argv.includes('--list')) {
  report(`Agenda do scheduler — perfil ${profile} (UTC)`, describeSchedule(service.schedule));
  if (db) await closeDb(db);
  process.exit(0);
}

const manual = arg('--run');
if (manual !== undefined) {
  const result = await service.execute(manual, 'manual');
  if (result.status === 'skipped')
    console.error(`"${manual}" já está rodando em outro processo; nada feito.`);
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

await service.start();

for (const name of (process.env.SCHEDULER_RUN_ON_START ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  try {
    void service
      .execute(name, 'start')
      .catch((err: unknown) => log.error({ err, job: name }, 'falha no job de partida'));
  } catch (err) {
    log.error({ err, job: name }, 'falha no job de partida');
  }
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  const running = service.stop();
  log.info({ signal, running: running.length }, 'encerrando scheduler; aguardando jobs em andamento');
  clearInterval(heartbeat);
  shutdownController.abort();
  await Promise.race([Promise.allSettled(running), new Promise((r) => setTimeout(r, 25_000))]);
  if (db) await closeDb(db);
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
