import { describe, expect, it } from 'vitest';
import { queueDedupeKey, queueMode } from './queue-mode.js';

describe('QUEUE_MODE', () => {
  it('só `enqueue` liga o modo fila; o padrão e qualquer outro valor executam como sempre', () => {
    expect(queueMode({})).toBe('run');
    expect(queueMode({ QUEUE_MODE: 'run' })).toBe('run');
    expect(queueMode({ QUEUE_MODE: ' Enqueue ' })).toBe('enqueue');
    expect(queueMode({ QUEUE_MODE: 'fila' })).toBe('run');
  });

  it('dedupe por job e dia UTC', () => {
    expect(queueDedupeKey({ name: 'assets-mirror' }, new Date('2026-11-03T23:59:59Z'))).toBe(
      'assets-mirror:2026-11-03',
    );
    expect(queueDedupeKey({ name: 'assets-mirror' }, new Date('2026-11-04T00:00:00Z'))).toBe(
      'assets-mirror:2026-11-04',
    );
  });
});
