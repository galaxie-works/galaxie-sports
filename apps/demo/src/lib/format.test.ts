import { describe, expect, it } from 'vitest';
import { initials } from './format';

describe('initials', () => {
  it('duas primeiras palavras, sem pontuação', () => {
    expect(initials('Sydney Swans')).toBe('SS');
    expect(initials('AFL (futebol australiano)')).toBe('AF');
    expect(initials('  ')).toBe('');
  });
});
