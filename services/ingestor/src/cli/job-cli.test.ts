import { describe, expect, it } from 'vitest';
import { errorMessage } from './job-cli.js';

describe('errorMessage', () => {
  it('mostra a causa do erro embrulhado (o "Failed query" do drizzle esconde o do Postgres)', () => {
    const pg = Object.assign(new Error('permission denied for table webhook_delivery'), { code: '42501' });
    const wrapped = new Error('Failed query: delete from api.webhook_delivery …', { cause: pg });
    expect(errorMessage(wrapped)).toBe(
      'Failed query: delete from api.webhook_delivery …\nCausa: permission denied for table webhook_delivery',
    );
  });

  it('erro sem causa e valor que não é Error', () => {
    expect(errorMessage(new Error('--dias-raw precisa ser um inteiro ≥ 1.'))).toBe(
      '--dias-raw precisa ser um inteiro ≥ 1.',
    );
    expect(errorMessage('texto')).toBe('texto');
  });

  it('para numa cadeia de causas longa', () => {
    let err = new Error('fundo');
    for (let i = 0; i < 10; i++) err = new Error(`nível ${i}`, { cause: err });
    expect(errorMessage(err).split('\n')).toHaveLength(5);
  });
});
