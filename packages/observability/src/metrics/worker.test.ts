import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { registerWorkerMetrics } from './worker.js';

describe('registerWorkerMetrics', () => {
  it('lê as tarefas em execução a cada coleta e mede a duração por tipo e destino', async () => {
    const registry = new Registry();
    let running: Record<string, number> = { 'exemplo.eco': 1, 'assets.espelhar': 0 };
    const metrics = registerWorkerMetrics(registry, () => running);
    metrics.observe('exemplo.eco', 'done', 12);
    let body = await registry.metrics();
    expect(body).toContain('worker_tasks_running{type="exemplo.eco"} 1');
    expect(body).toContain('worker_tasks_running{type="assets.espelhar"} 0');
    expect(body).toContain('worker_task_duration_seconds_count{type="exemplo.eco",result="done"} 1');
    expect(body).toContain('worker_task_duration_seconds_bucket{le="15",type="exemplo.eco",result="done"} 1');
    running = { 'exemplo.eco': 0, 'assets.espelhar': 2 };
    body = await registry.metrics();
    expect(body).toContain('worker_tasks_running{type="exemplo.eco"} 0');
    expect(body).toContain('worker_tasks_running{type="assets.espelhar"} 2');
  });
});
