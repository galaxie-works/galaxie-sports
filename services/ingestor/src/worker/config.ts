/**
 * Configuração do worker da fila (#542), lida do env do contêiner. A conta da memória (README da stack › Memória dos
 * jobs) depende de WORKER_MAX_TASKS e WORKER_TASK_HEAP_MB: mudou um deles, refaça o `mem_limit` do serviço `worker`.
 *
 *   WORKER_CONCURRENCY_<TIPO>  tarefas simultâneas do tipo (`assets.espelhar` → WORKER_CONCURRENCY_ASSETS_ESPELHAR);
 *                              padrão 1, o espelho 2; 0 tira o tipo deste worker
 *   WORKER_MAX_TASKS           teto de tarefas simultâneas, somando os tipos (padrão 2)
 *   WORKER_TASK_HEAP_MB        heap de cada processo filho (padrão 160, o mesmo dos jobs do scheduler)
 *   WORKER_DRAIN_S             prazo para o lote em andamento fechar no SIGTERM (padrão 60; o stop_grace_period do
 *                              serviço é 75 s)
 *   WORKER_OPS_PORT            /health, /version e /metrics (padrão 8080)
 *   WORKER_ID                  nome do worker em ops.job_request.locked_by (padrão <hostname>:<pid>)
 */
import { hostname } from 'node:os';

/** Concorrência padrão dos tipos que fogem do 1: o espelho de assets é rede e S3, cabe dois. */
export const DEFAULT_TYPE_CONCURRENCY: Readonly<Record<string, number>> = { 'assets.espelhar': 2 };
export const DEFAULT_MAX_TASKS = 2;
export const DEFAULT_TASK_HEAP_MB = 160;
export const DEFAULT_DRAIN_S = 60;
export const DEFAULT_OPS_PORT = 8080;

export interface WorkerConfig {
  workerId: string;
  /** Vagas por tipo (só os tipos com vaga > 0). */
  concurrency: Record<string, number>;
  maxTasks: number;
  heapMb: number;
  drainMs: number;
  opsPort: number;
  /** Variáveis com valor inválido (ficaram no padrão): o worker avisa no log. */
  invalid: string[];
}

/** Nome da variável de concorrência do tipo: `assets.espelhar` → WORKER_CONCURRENCY_ASSETS_ESPELHAR. */
export function concurrencyVar(type: string): string {
  return `WORKER_CONCURRENCY_${type.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** Inteiro ≥ `min` do env, ou o padrão (e o nome da variável vai para `invalid`). */
function intVar(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  invalid: string[],
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min) return n;
  invalid.push(name);
  return fallback;
}

export function workerConfig(types: readonly string[], env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const invalid: string[] = [];
  const concurrency: Record<string, number> = {};
  for (const type of types) {
    const n = intVar(env, concurrencyVar(type), DEFAULT_TYPE_CONCURRENCY[type] ?? 1, 0, invalid);
    if (n > 0) concurrency[type] = n;
  }
  return {
    workerId: env.WORKER_ID?.trim() || `${hostname()}:${process.pid}`,
    concurrency,
    maxTasks: intVar(env, 'WORKER_MAX_TASKS', DEFAULT_MAX_TASKS, 1, invalid),
    heapMb: intVar(env, 'WORKER_TASK_HEAP_MB', DEFAULT_TASK_HEAP_MB, 32, invalid),
    drainMs: intVar(env, 'WORKER_DRAIN_S', DEFAULT_DRAIN_S, 1, invalid) * 1000,
    opsPort: intVar(env, 'WORKER_OPS_PORT', DEFAULT_OPS_PORT, 0, invalid),
    invalid,
  };
}
