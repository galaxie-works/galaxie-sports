import { describe, expect, it } from 'vitest';
import { createMetrics } from './registry.js';

describe('createMetrics sem banco', () => {
  it('expõe latência HTTP, intervalo ao vivo e métricas do processo', async () => {
    const { registry, httpDuration } = createMetrics({ livePollIntervalSeconds: 120 });
    httpDuration.observe({ method: 'GET', route: '/health', status_code: '200' }, 0.012);
    const text = await registry.metrics();
    expect(text).toContain(
      'galaxie_http_request_duration_seconds_bucket{le="0.025",method="GET",route="/health",status_code="200"} 1',
    );
    expect(text).toContain('galaxie_live_poll_interval_seconds 120');
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).not.toContain('galaxie_quota_remaining');
  });

  it('exige a política de cota quando há banco', () => {
    expect(() => createMetrics({ db: {} as never, defaultMetrics: false })).toThrow(/policyFor/);
  });
});
