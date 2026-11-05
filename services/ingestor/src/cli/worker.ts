/**
 * Worker da fila de tarefas (#542): o serviço `worker` da stack (mesma imagem do ingestor). Toma as tarefas de
 * `ops.job_request` dos tipos registrados (`TASK_HANDLERS`), roda cada uma num processo filho com heap fixo, renova a
 * concessão e, no SIGTERM (`docker stop`, deploy), drena: para de tomar, deixa o lote em andamento fechar
 * (WORKER_DRAIN_S, padrão 60 s) e devolve à fila o que não fechou, com o checkpoint. O próximo worker retoma.
 *
 *   node dist/cli/worker.js
 *
 * /health (porta WORKER_OPS_PORT, padrão 8080) diz `{ idle, draining, task, tasks }`; /metrics tem
 * `worker_tasks_running` e `worker_task_duration_seconds` (Bearer METRICS_TOKEN). As variáveis estão em
 * `../worker/config.ts`; operação: docs/runbooks/tarefas.md.
 */
import { fileURLToPath } from 'node:url';
import { closeDb, createDb } from '@galaxie/db';
import { finish, release, renew, takeNext } from '@galaxie/db/queue';
import {
  registerWorkerMetrics,
  startOpsServer,
  versionInfo,
  type WorkerMetrics,
} from '@galaxie/observability';
import { logger } from '../logger.js';
import { handledTypes } from '../tasks/run.js';
import { concurrencyVar, workerConfig } from '../worker/config.js';
import { TaskWorker } from '../worker/loop.js';
import { forkTaskProcess } from '../worker/process.js';

const log = logger.child({ component: 'worker' });
const types = handledTypes();
const config = workerConfig(types);
if (config.invalid.length)
  log.warn({ variaveis: config.invalid }, 'variáveis do worker inválidas; usando o padrão');

const url = process.env.DATABASE_URL;
if (!url) {
  log.error('DATABASE_URL não definida: o worker precisa do banco');
  process.exit(2);
}
if (!Object.keys(config.concurrency).length) {
  log.error(
    { variaveis: types.map(concurrencyVar) },
    'nenhum tipo de tarefa com vaga (todas as WORKER_CONCURRENCY_<TIPO> em 0)',
  );
  process.exit(2);
}

const db = createDb(url, { max: 2, applicationName: 'galaxie-worker' });
const childScript = fileURLToPath(new URL('../worker/child.js', import.meta.url));
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
let metrics: WorkerMetrics | undefined;

const worker = new TaskWorker(config, {
  take: (t) => takeNext(db, config.workerId, t),
  renew: (task) => renew(db, task),
  release: (task) => release(db, task),
  fail: (task, detail) => finish(db, task, 'error', detail),
  // o filho resolve caminhos (config/, data/) a partir da raiz do pacote, como os CLIs do scheduler
  spawn: (task) => forkTaskProcess(task, { script: childScript, heapMb: config.heapMb, cwd: packageRoot }),
  log,
  observe: (type, result, seconds) => metrics?.observe(type, result, seconds),
});

startOpsServer({
  service: 'worker',
  port: config.opsPort,
  onError: (err) => log.warn({ err }, 'servidor de operação do worker com falha'),
  register: (registry) => {
    metrics = registerWorkerMetrics(registry, () => worker.runningByType());
  },
  health: () => ({ ...worker.state() }),
});

log.info(
  {
    ...versionInfo('worker'),
    worker: config.workerId,
    concorrencia: config.concurrency,
    max_tasks: config.maxTasks,
    heap_mb: config.heapMb,
    drain_s: config.drainMs / 1000,
    ops_port: config.opsPort,
  },
  'worker iniciado',
);

const loop = worker.start();

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'encerrando o worker');
  try {
    await worker.drain();
  } catch (err) {
    log.error({ err }, 'falha na drenagem do worker');
  }
  await closeDb(db).catch(() => {});
  log.info({ worker: config.workerId }, 'worker encerrado');
  process.exit(0);
}
// `on`, não `once`: um segundo SIGTERM no meio da drenagem não pode matar o processo (o padrão do Node)
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// o event loop esvaziou (nada segurando o processo: nem o laço, nem um filho, nem o banco): o Node sairia com 0 em
// silêncio e o contêiner reiniciaria sem rastro. Registra e sai com 1 para o reinício aparecer no log e no alerta.
process.on('beforeExit', (code) => {
  if (stopping) return;
  log.error({ code }, 'o event loop do worker esvaziou sem SIGTERM; saindo para o contêiner reiniciar');
  process.exit(1);
});

// o laço só termina pela drenagem; se terminar por outro motivo, o contêiner reinicia
void loop.then(
  () => {
    if (!stopping) {
      log.error('o laço do worker parou sem SIGTERM; saindo para o contêiner reiniciar');
      process.exit(1);
    }
  },
  (err: unknown) => {
    log.error({ err }, 'o laço do worker caiu; saindo para o contêiner reiniciar');
    process.exit(1);
  },
);
