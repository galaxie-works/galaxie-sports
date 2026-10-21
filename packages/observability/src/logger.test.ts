import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, maskIp } from './logger.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('emite JSON com serviço, nível em texto, horário ISO e os campos de contexto', () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'ingestor', environment: 'test' }, stream);
    log.child({ job_id: 'job-run:1', sport: 'football' }).info({ endpoint: '/leagues' }, 'chamada');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'ingestor',
      env: 'test',
      job_id: 'job-run:1',
      sport: 'football',
      endpoint: '/leagues',
      msg: 'chamada',
    });
    expect(String(lines[0]!.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('oculta segredos', () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'api' }, stream);
    log.info({ apiKey: 'k', headers: { 'x-apisports-key': 'k', authorization: 'Bearer x' } }, 'x');
    expect(JSON.stringify(lines[0])).not.toContain('"k"');
    expect(JSON.stringify(lines[0])).not.toContain('Bearer');
  });

  it('respeita LOG_LEVEL', () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'api' }, stream, { LOG_LEVEL: 'warn' });
    log.info('não aparece');
    log.warn('aparece');
    expect(lines.map((l) => l.msg)).toEqual(['aparece']);
  });
});

describe('maskIp', () => {
  it('trunca IPv4 em /24 e IPv6 em /48', () => {
    expect(maskIp('203.0.113.77')).toBe('203.0.113.0');
    expect(maskIp('::ffff:198.51.100.9')).toBe('198.51.100.0');
    expect(maskIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(maskIp('::1')).toBe('::/48');
    expect(maskIp(undefined)).toBeUndefined();
    expect(maskIp('não-é-ip')).toBeUndefined();
  });
});
