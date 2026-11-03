/**
 * O CLI do scheduler, compartilhado pelos serviços que agendam jobs: o ingestor e o ao vivo (`dist/cli/scheduler.js`,
 * perfis `ingestor` e `live`) e os agentes de IA (`dist/cli/agents-scheduler.js`). Cada um passa o perfil, a lista de
 * jobs e a raiz do próprio pacote (onde ficam o `dist/` e os CLIs que o scheduler executa); o resto é igual.
 *
 *   node dist/cli/scheduler.js               # inicia (fica no ar; SIGTERM encerra com elegância)
 *   node dist/cli/scheduler.js --list        # mostra a agenda efetiva e as próximas execuções
 *   node dist/cli/scheduler.js --run <job>   # executa um job agora (registrado) e sai com o código dele
 *
 * Variáveis: SCHEDULE_<JOB>=<cron>|off · SCHEDULER_RUN_ON_START=job1,job2 · SCHEDULER_TIMEOUT_MINUTES
 *            SCHEDULER_HEARTBEAT_FILE (padrão /tmp/galaxie-scheduler.heartbeat, usado no healthcheck)
 *            SCHEDULER_REFRESH_SECONDS (padrão 30): releitura da configuração do painel e dos pedidos
 *            SCHEDULER_MAX_JOBS: jobs simultâneos fora da faixa do ao vivo (padrão 2 no ingestor, 3 nos agents; a stack
 *            da VPS passa 1 no ingestor, que deixou o trabalho longo para o worker da fila)
 *            SCHEDULER_JOB_HEAP_MB: heap de cada job sem heap próprio (padrão 160 no ingestor, 128 nos agents)
 *            SCHEDULER_CATCHUP=off desliga o catch-up da partida; SCHEDULER_CATCHUP_MAX_HOURS (padrão 24): horário
 *            perdido mais velho que isto não roda na volta (catch-up.ts)
 *            QUEUE_MODE=run|enqueue (padrão run): com enqueue, os jobs com `task` só enfileiram a tarefa na fila
 *            (dedupe por job e dia) e o worker executa (queue-mode.ts); os outros rodam como sempre
 *            SCHEDULER_STOP_WAIT_SECONDS (padrão 25): no SIGTERM, quanto esperar os jobs em andamento terminarem antes de
 *            sair (o contêiner cai junto, e os filhos com ele); fica abaixo do stop_grace_period do serviço
 *
 * O painel de Ajustes → Operação sobrescreve as flags pelo banco (ops.runtime_setting): banco > env >
 * padrão. As agendas mudadas são reprogramadas sem reinício e cada job recebe o env efetivo.
 *
 * Cada job roda em um processo por vez em todo o banco (advisory lock de sessão, solto quando o processo
 * cai): se outro scheduler já está rodando o job, a execução é pulada (o `--run` sai com código 1). O job com trava
 * por cópia (`lock: 'instance'`, o `live-run` do perfil `live`) roda um por cópia do scheduler: quem coordena as
 * cópias é ele (líder e reserva). SCHEDULER_TIMEOUT_MINUTES não vale para o ao vivo, que tem tempo limite próprio.
 */
import { writeFile } from 'node:fs/promises';
import { closeDb, createDb, tryJobLock, type Database } from '@galaxie/db';
import { startOpsServer, versionInfo, type Logger, type OpsServerOptions } from '@galaxie/observability';
import { checkAiCredit } from './ai-credit.js';
import { closeOrphans, lastJobStarts, missedSlots } from './catch-up.js';
import { enqueueJob, queueMode } from './queue-mode.js';
import { PgRunRecorder, runJob, runExitCode, schedulerInstance } from './runner.js';
import type { ScheduledJob } from './schedule.js';
import { describeSchedule, SchedulerService, type SchedulerProfile } from './service.js';

export interface SchedulerCliOptions {
  /**
   * Quem agenda: define o registro do painel (ingestor, agents ou live), o nome do serviço no `/health` e no `/version`,
   * o crédito da IA, os padrões de memória e o perfil de tempos do banco (`live` no ao vivo).
   */
  profile: SchedulerProfile;
  /** Os jobs do serviço (agenda padrão do código). */
  jobs: readonly ScheduledJob[];
  /** Raiz do pacote do serviço: o `script` de cada job é relativo a ela. */
  packageRoot: string;
  log: Logger;
  /**
   * Métricas do serviço no `/metrics` do scheduler, lidas do banco a cada coleta (o ingestor expõe as do ritmo do ao
   * vivo, já que o `live-run` é um processo filho sem servidor próprio). Só no modo serviço e com DATABASE_URL.
   */
  metrics?: ((db: Database) => NonNullable<OpsServerOptions['register']>) | undefined;
}

/** Saída do `--list`: tabela legível no terminal; JSON estruturado quando roda em contêiner. */
function report(log: Logger, msg: string, data: Record<string, unknown> | unknown[]): void {
  if (process.stdout.isTTY) {
    console.log(msg);
    if (Array.isArray(data)) console.table(data);
    else console.log(JSON.stringify(data));
  } else {
    log.info(Array.isArray(data) ? { rows: data } : data, msg);
  }
}

/** Inteiro positivo do env, ou o padrão (valor inválido não pode virar "sem teto"). */
const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * Roda o CLI do scheduler com `process.argv` e `process.env`. No modo serviço não retorna (o processo fica no ar até o
 * SIGTERM); `--list` e `--run` encerram o processo com o código de saída.
 */
export async function runScheduler(options: SchedulerCliOptions): Promise<void> {
  const { profile, log, packageRoot } = options;
  const definitions = options.jobs;
  const arg = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? (process.argv[i + 1] ?? '') : undefined;
  };

  // a soma tem de caber no mem_limit do contêiner (infra/vps-telemetry/README.md › Memória dos jobs)
  const maxJobs = positiveInt(process.env.SCHEDULER_MAX_JOBS, profile === 'agents' ? 3 : 2);
  // o ao vivo fecha o tick em andamento no SIGTERM: o serviço `live` dá mais tempo (compose › stop_grace_period)
  const stopWaitMs = positiveInt(process.env.SCHEDULER_STOP_WAIT_SECONDS, 25) * 1000;
  const jobHeapMb = positiveInt(process.env.SCHEDULER_JOB_HEAP_MB, profile === 'agents' ? 128 : 160);

  const databaseUrl = process.env.DATABASE_URL;
  const db: Database | undefined = databaseUrl
    ? createDb(databaseUrl, {
        max: 2,
        applicationName: 'galaxie-scheduler',
        // o ao vivo não pode ficar preso numa consulta (packages/db/src/client.ts › DB_TIMEOUTS)
        ...(profile === 'live' ? { profile: 'live' as const } : {}),
      })
    : undefined;
  if (!db) log.warn('DATABASE_URL não definida: as execuções não serão registradas em ops.job_run');
  const recorder = db ? new PgRunRecorder(db) : undefined;
  /** Abortado no encerramento: os jobs em andamento recebem SIGTERM (o ao vivo fecha o tick e sai). */
  const shutdownController = new AbortController();
  const bootedAt = new Date();
  /** Esta cópia do scheduler (o ID do contêiner): nome da trava por cópia e `stats.instance` da execução. */
  const instance = schedulerInstance();
  /** Trava do job (advisory lock de sessão, pelo nome que `jobLockName` dá): `null` = outro processo já o roda. */
  const jobLock = databaseUrl
    ? (name: string) =>
        tryJobLock(databaseUrl, name, {
          onLost: () =>
            log.warn(
              { job: name },
              'conexão da trava do job caiu com o job rodando; outro processo pode iniciá-lo em paralelo',
            ),
        })
    : undefined;

  const service = new SchedulerService({
    profile,
    jobs: definitions,
    env: process.env,
    db,
    log,
    refreshMs: Number(process.env.SCHEDULER_REFRESH_SECONDS ?? 30) * 1000 || 30_000,
    creditCheck: profile === 'agents' ? (env) => checkAiCredit(env) : undefined,
    maxJobs,
    run: (job, { trigger, env, signal }) =>
      // QUEUE_MODE=enqueue: o job pesado vira tarefa da fila e o worker executa (sem banco, roda como sempre)
      job.task && db && queueMode(env) === 'enqueue'
        ? enqueueJob(db, job, { trigger, recorder, logger: log })
        : runJob(job, {
            cwd: packageRoot,
            env,
            heapMb: jobHeapMb,
            recorder,
            logger: log,
            trigger,
            // o encerramento do scheduler e, no job que fica no ar, o desligamento dele pelo painel
            signal: signal ? AbortSignal.any([shutdownController.signal, signal]) : shutdownController.signal,
            // um processo por job em todo o banco: o `--run` no console ou um contêiner sobreposto no deploy
            // não dobram o ao vivo (trava de sessão: some sozinha se este processo cair)
            lock: jobLock,
            instance,
          }),
  });

  if (process.argv.includes('--list') || arg('--run') !== undefined) {
    // a agenda e o env efetivos já com a configuração do painel (banco > env > padrão)
    await service.refresh();
  }

  if (process.argv.includes('--list')) {
    report(log, `Agenda do scheduler — perfil ${profile} (UTC)`, describeSchedule(service.schedule));
    if (db) await closeDb(db);
    process.exit(0);
  }

  const manual = arg('--run');
  if (manual !== undefined) {
    const result = await service.execute(manual, 'manual');
    if (result.status === 'skipped')
      console.error(`"${manual}" já está rodando em outro processo; nada feito.`);
    if (db) await closeDb(db);
    process.exit(runExitCode(result.status));
  }

  // ── modo serviço ──────────────────────────────────────────────────────────────────────────────────
  // /health, /version e /metrics deste processo (sem router no Traefik); os jobs são processos filhos, sem servidor
  const serviceName = profile;
  log.info({ ...versionInfo(serviceName), instance }, 'partida');
  startOpsServer({
    service: serviceName,
    port: Number(process.env.SCHEDULER_OPS_PORT ?? 9464) || 9464,
    onError: (err) => log.warn({ err }, 'servidor de operação do scheduler com falha'),
    ...(db && options.metrics ? { register: options.metrics(db) } : {}),
  });
  const heartbeatFile = process.env.SCHEDULER_HEARTBEAT_FILE ?? '/tmp/galaxie-scheduler.heartbeat';
  const beat = () =>
    writeFile(heartbeatFile, new Date().toISOString()).catch((err: unknown) =>
      log.warn({ err, file: heartbeatFile }, 'não foi possível gravar o heartbeat'),
    );
  await beat();
  const heartbeat = setInterval(() => void beat(), 30_000);

  // O `running` que o processo anterior deixou fecha antes de qualquer job subir: o job que fica no ar (trava por
  // cópia) pegaria a trava `<job>@<cópia>` do mesmo hostname (o contêiner reiniciado) e a linha órfã ficaria `running`
  if (db && jobLock) {
    try {
      const orphans = await closeOrphans(
        db,
        definitions.map((j) => j.name),
        { bootedAt, lock: jobLock },
      );
      if (orphans.runs || orphans.requests || orphans.busy.length)
        log.info(orphans, 'execuções e pedidos deixados como running pelo processo anterior');
    } catch (err) {
      log.warn({ err }, 'não foi possível fechar as execuções deixadas pelo processo anterior');
    }
  }

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

  // Volta de um reinício: roda uma vez o job cujo horário passou com o scheduler fora do ar (catch-up.ts); o `running`
  // deixado pelo processo anterior já fechou antes da partida (acima)
  async function recover(): Promise<void> {
    if (!db || !jobLock) return;
    if (['off', 'false', '0'].includes((process.env.SCHEDULER_CATCHUP ?? '').trim().toLowerCase())) return;
    const maxHours = Number(process.env.SCHEDULER_CATCHUP_MAX_HOURS);
    const missed = missedSlots(
      service.schedule,
      await lastJobStarts(
        db,
        service.schedule.map((j) => j.name),
      ),
      {
        ...(Number.isFinite(maxHours) && maxHours > 0 ? { maxAgeMs: maxHours * 3_600_000 } : {}),
      },
    );
    service.catchUp(missed);
  }
  void recover().catch((err: unknown) => log.warn({ err }, 'catch-up da partida não rodou'));

  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    const running = service.stop();
    log.info({ signal, running: running.length }, 'encerrando scheduler; aguardando jobs em andamento');
    clearInterval(heartbeat);
    shutdownController.abort();
    await Promise.race([Promise.allSettled(running), new Promise((r) => setTimeout(r, stopWaitMs))]);
    if (db) await closeDb(db);
    process.exit(0);
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}
