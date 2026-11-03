import { Gauge, Histogram, type Registry } from 'prom-client';

/**
 * Métricas do worker da fila de tarefas (#542), no `/metrics` do próprio worker (porta 8080 no contêiner). Sem o
 * prefixo `galaxie_`, como o `build_info`: são do processo, não do banco (as da fila, `galaxie_queue_*`, saem do
 * `/metrics` da API e valem com qualquer número de workers).
 */

/** Buckets da duração de uma tomada: de segundos (exemplo, prévia) a horas (carga histórica). */
export const WORKER_DURATION_BUCKETS = [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200, 14_400];

export interface WorkerMetrics {
  /** Fim de uma tomada: tipo, destino (`done`, `retry`, `error`, `deferred`, `released`, `lost`…) e duração. */
  observe(type: string, result: string, seconds: number): void;
}

/**
 * `worker_tasks_running{type}`: tarefas que este worker roda agora, lidas de `running` a cada coleta (tipos com 0
 * também, para o painel não perder a série); `worker_task_duration_seconds{type,result}`: duração de cada tomada.
 */
export function registerWorkerMetrics(
  registry: Registry,
  running: () => Record<string, number>,
): WorkerMetrics {
  new Gauge({
    name: 'worker_tasks_running',
    help: 'Tarefas da fila que este worker executa agora, por tipo',
    labelNames: ['type'],
    registers: [registry],
    collect() {
      this.reset();
      for (const [type, n] of Object.entries(running())) this.set({ type }, n);
    },
  });
  const duration = new Histogram({
    name: 'worker_task_duration_seconds',
    help: 'Duração de cada tomada de tarefa pelo worker, por tipo e destino',
    labelNames: ['type', 'result'],
    buckets: WORKER_DURATION_BUCKETS,
    registers: [registry],
  });
  return {
    observe: (type, result, seconds) => duration.observe({ type, result }, seconds),
  };
}
