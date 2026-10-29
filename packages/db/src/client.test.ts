import { describe, expect, it } from 'vitest';
import { DB_TIMEOUTS, resolveDbTimeouts, sessionParams } from './client.js';
import { isLockTimeout } from './migrate.js';

describe('resolveDbTimeouts', () => {
  it('a API tem teto curto, os jobs longo e o migrate só lock_timeout', () => {
    const api = resolveDbTimeouts('api', {}, {});
    const job = resolveDbTimeouts('job', {}, {});
    const migrate = resolveDbTimeouts('migrate', {}, {});
    expect(api.statementMs).toBeLessThan(30_000); // abaixo do timeout da requisição
    expect(job.statementMs).toBeGreaterThan(api.statementMs);
    expect(migrate.statementMs).toBe(0);
    expect(migrate.lockMs).toBeGreaterThan(0);
    expect(migrate.lockMs).toBeLessThan(job.lockMs);
  });

  it('opções e env sobrescrevem o perfil, nessa ordem', () => {
    expect(resolveDbTimeouts('job', { lockMs: 1_000 }, {}).lockMs).toBe(1_000);
    const env = { DB_STATEMENT_TIMEOUT_MS: '0', DB_LOCK_TIMEOUT_MS: '2500' };
    const t = resolveDbTimeouts('job', { lockMs: 1_000 }, env);
    expect(t.statementMs).toBe(0);
    expect(t.lockMs).toBe(2_500);
    expect(t.idleInTransactionMs).toBe(DB_TIMEOUTS.job.idleInTransactionMs);
  });

  it('env inválido fica com o valor do perfil', () => {
    const env = {
      DB_STATEMENT_TIMEOUT_MS: '10s',
      DB_LOCK_TIMEOUT_MS: '-1',
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: ' ',
    };
    expect(resolveDbTimeouts('api', {}, env)).toEqual(DB_TIMEOUTS.api);
  });
});

describe('sessionParams', () => {
  it('manda só os tempos ligados, em ms', () => {
    expect(
      sessionParams({ statementMs: 0, lockMs: 5_000, idleInTransactionMs: 0 }, 'galaxie-migrate'),
    ).toEqual({
      application_name: 'galaxie-migrate',
      lock_timeout: '5000',
    });
    expect(sessionParams(DB_TIMEOUTS.api)).toEqual({
      statement_timeout: String(DB_TIMEOUTS.api.statementMs),
      lock_timeout: String(DB_TIMEOUTS.api.lockMs),
      idle_in_transaction_session_timeout: String(DB_TIMEOUTS.api.idleInTransactionMs),
    });
  });
});

describe('isLockTimeout', () => {
  it('reconhece o 55P03 direto ou embrulhado pelo drizzle', () => {
    expect(isLockTimeout({ code: '55P03' })).toBe(true);
    expect(isLockTimeout(new Error('falhou', { cause: { code: '55P03' } }))).toBe(true);
    expect(isLockTimeout({ code: '57014' })).toBe(false);
    expect(isLockTimeout(undefined)).toBe(false);
  });
});
