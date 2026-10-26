import type { Database } from '@galaxie/db';
import { describe, expect, it } from 'vitest';
import { panelEnv } from './panel-env.js';

const db = {} as Database;

describe('env do painel na ordem das fotos', () => {
  it('aplica as sobrescritas do painel (AI_STATUS=off do painel vale)', async () => {
    const env = await panelEnv(db, { AI_STATUS: 'on' }, async () => new Map([['AI_STATUS', 'off']]));
    expect(env.AI_STATUS).toBe('off');
  });

  it('banco sem a tabela (antigo): segue com o env do processo', async () => {
    const missing = Object.assign(new Error('relation "ops.runtime_setting" does not exist'), {
      code: '42P01',
    });
    const wrapped = Object.assign(new Error('Failed query'), { cause: missing });
    for (const err of [missing, wrapped]) {
      const env = await panelEnv(db, { AI_STATUS: 'on' }, async () => {
        throw err;
      });
      expect(env.AI_STATUS).toBe('on');
    }
  });

  it('outra falha de leitura aborta (não ignora o estado da IA do painel)', async () => {
    await expect(
      panelEnv(db, { AI_STATUS: 'on' }, async () => {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      }),
    ).rejects.toThrow(/Abortado/);
  });
});
