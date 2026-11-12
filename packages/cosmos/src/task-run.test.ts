import { describe, expect, it } from 'vitest';

import { parseModelJson } from './task-run.js';

describe('parseModelJson', () => {
  it('objeto direto, embrulhado em cerca de código ou com texto em volta; o resto é null', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('Aqui está:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseModelJson('[1,2]')).toBeNull();
    expect(parseModelJson('nada')).toBeNull();
  });
});
