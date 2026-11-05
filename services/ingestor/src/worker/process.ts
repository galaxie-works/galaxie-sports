/**
 * O processo filho de uma tarefa (`child.ts`), com heap fixo como os jobs do scheduler (`heapFlags`): uma tarefa que
 * vaza memória morre sozinha com "heap out of memory" (o pai encerra a tomada em erro) em vez de o kernel matar o
 * worker inteiro. A conversa é por IPC, com serialização `advanced` (as datas da tomada atravessam como Date).
 */
import { fork } from 'node:child_process';
import type { QueueTask } from '@galaxie/db/queue';
import { heapFlags } from '@galaxie/scheduler';
import type { ChildMessage, ParentMessage, TaskProcess, TaskProcessExit, TaskRunResult } from './loop.js';

export interface ForkOptions {
  /** O script do filho (dist/worker/child.js). */
  script: string;
  heapMb: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function forkTaskProcess(task: QueueTask, options: ForkOptions): TaskProcess {
  const child = fork(options.script, [], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    // flags de memória próprias: o pai roda com heap pequeno, e o filho não pode herdar
    execArgv: heapFlags({ heapMb: options.heapMb }),
    env: {
      // nome da sessão no Postgres (pg_stat_activity): quem segura conexão ou consulta
      PGAPPNAME: `galaxie-task:${task.type}`,
      ...(options.env ?? process.env),
      GALAXIE_INVOKER: 'worker',
      GALAXIE_TASK_ID: task.id,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    serialization: 'advanced',
  });
  let result: TaskRunResult | undefined;
  let error: string | undefined;
  child.on('message', (raw) => {
    const msg = raw as ChildMessage;
    if (msg?.type === 'result') result = msg.result;
    else if (msg?.type === 'failed') error = msg.message;
  });
  const done = new Promise<TaskProcessExit>((resolve) => {
    child.once('error', (err) => {
      error ??= `falha no processo da tarefa: ${err.message}`;
      // não chegou a nascer: não vai haver `close`
      if (child.pid === undefined) resolve({ error, exitCode: null, signal: null });
    });
    // `close` vem depois do canal IPC fechado: a mensagem do resultado, se houve, já chegou
    child.once('close', (exitCode, signal) =>
      resolve({ ...(result !== undefined ? { result } : {}), ...(error ? { error } : {}), exitCode, signal }),
    );
  });
  const send = (msg: ParentMessage) => {
    if (child.connected) child.send(msg, () => {});
  };
  send({ type: 'run', task });
  return {
    done,
    stop: () => send({ type: 'stop' }),
    leaseLost: () => send({ type: 'lease-lost' }),
    kill: (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    },
  };
}
