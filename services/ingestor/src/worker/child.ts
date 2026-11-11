/**
 * Processo filho de uma tarefa da fila (#542): recebe a tomada do worker pelo IPC e roda o `runTask` com a própria
 * conexão ao banco. A concessão é renovada pelo pai; daqui só sai trabalho, checkpoint e o encerramento da tomada
 * (`finish` ou `release`). Mensagens do pai: `stop` (drenagem: parar entre dois lotes e devolver a tarefa) e
 * `lease-lost` (a concessão foi perdida: parar sem gravar). No fim, informa o destino e sai.
 *
 * Não roda sozinho: o worker (`dist/cli/worker.js`) o cria com `fork` e heap fixo (WORKER_TASK_HEAP_MB).
 */
import { closeDb, createDb } from '@galaxie/db';
import type { QueueTask } from '@galaxie/db/queue';
import { applyPanelSecrets } from '../assets/commons/panel-env.js';
import { logger } from '../logger.js';
import { runTask } from '../tasks/run.js';
import type { ChildMessage, ParentMessage } from './loop.js';

const log = logger.child({ component: 'worker-task' });
const stop = new AbortController();
const lost = new AbortController();
let started = false;

if (!process.send) {
  console.error('worker/child.js roda só como processo filho do worker (node dist/cli/worker.js).');
  process.exit(2);
}

/** Manda ao pai e espera o envio (antes de sair). */
const tell = (msg: ChildMessage) =>
  new Promise<void>((resolve) => {
    if (!process.connected) return resolve();
    process.send!(msg, undefined, {}, () => resolve());
  });

async function execute(raw: QueueTask): Promise<void> {
  const task: QueueTask = { ...raw, lockedUntil: new Date(raw.lockedUntil) };
  const url = process.env.DATABASE_URL;
  let code = 0;
  if (!url) {
    await tell({ type: 'failed', message: 'DATABASE_URL não definida no processo da tarefa' });
    process.exit(1);
  }
  // 2 conexões: o checkpoint e o finish; o executor que monta o contexto dos jobs (carga) abre o pool dele (4). A conta
  // do papel do banco está em packages/db/src/roles.ts (ROLE_CONNECTION_LIMITS)
  const db = createDb(url, { max: 2, applicationName: `galaxie-task:${task.type}` });
  try {
    // chaves trocadas no painel (#1087, ex.: APISPORTS_KEY): valem para a tarefa como para os jobs do scheduler
    await applyPanelSecrets(db);
    const result = await runTask(db, task, { signal: stop.signal, leaseLost: lost.signal });
    await tell({ type: 'result', result });
  } catch (err) {
    code = 1;
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, task: task.id, type: task.type }, 'o executor da tarefa falhou fora do runTask');
    await tell({ type: 'failed', message: message.slice(0, 500) });
  } finally {
    await closeDb(db).catch(() => {});
  }
  // o executor pode deixar conexões e timers abertos (contexto dos jobs): sai sem esperar por eles
  process.exit(code);
}

process.on('message', (raw) => {
  const msg = raw as ParentMessage;
  if (msg?.type === 'stop') stop.abort();
  else if (msg?.type === 'lease-lost') lost.abort();
  else if (msg?.type === 'run' && !started) {
    started = true;
    void execute(msg.task);
  }
});
// o pai saiu sem avisar (SIGKILL no contêiner): não há mais quem renove a concessão
process.on('disconnect', () => {
  stop.abort();
  lost.abort();
  setTimeout(() => process.exit(1), 2000).unref();
});
