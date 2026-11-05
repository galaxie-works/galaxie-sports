import { describe, expect, it } from 'vitest';

import { bearerMatches, renderMetrics } from './metrics';

describe('/metrics da demo', () => {
  const sample = {
    service: 'console',
    imageHash: 'in-abc',
    startedAtMs: 1_700_000_000_500,
    memory: { rss: 300, heapTotal: 200, heapUsed: 150, external: 20, arrayBuffers: 10 },
  };

  it('build_info com o serviço e o hash, como os outros serviços', () => {
    expect(renderMetrics(sample)).toContain('build_info{service="console",image_hash="in-abc"} 1\n');
  });

  it('memória e início do processo', () => {
    const text = renderMetrics(sample);
    expect(text).toContain('process_start_time_seconds 1700000000.5\n');
    expect(text).toContain('process_resident_memory_bytes 300\n');
    expect(text).toContain('nodejs_heap_size_used_bytes 150\n');
    expect(text).toContain('# TYPE nodejs_heap_size_total_bytes gauge\n');
  });

  it('escapa o rótulo', () => {
    expect(renderMetrics({ ...sample, service: 'a"b\\c' })).toContain('service="a\\"b\\\\c"');
  });

  it('confere o bearer', () => {
    expect(bearerMatches('Bearer segredo', 'segredo')).toBe(true);
    expect(bearerMatches('Bearer outro', 'segredo')).toBe(false);
    expect(bearerMatches(undefined, 'segredo')).toBe(false);
  });
});
