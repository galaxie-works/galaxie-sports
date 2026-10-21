import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid.js';

describe('uuidv7', () => {
  it('gera versão 7, variante RFC e ordem por tempo', () => {
    const a = uuidv7(1_792_576_800_000);
    const b = uuidv7(1_792_576_800_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.slice(0, 13) < b.slice(0, 13)).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});
