import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('remove acentos e pontuação', () => {
    expect(slugify('Paulista - A1 (São Paulo)')).toBe('paulista-a1-sao-paulo');
  });

  it('não deixa hífen nas pontas', () => {
    expect(slugify('  Atlético de Madrid!  ')).toBe('atletico-de-madrid');
  });
});
