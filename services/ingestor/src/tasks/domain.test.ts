/**
 * `tenant.verify_domain` com DNS e banco falsos: bate quando algum TXT é igual ao token, grava a conferência sempre,
 * não marca duas vezes, trata o domínio apagado e o host já comprovado por outra marca, e põe as origens do host
 * comprovado nas chaves publicáveis (F3, decisão 12).
 */
import { describe, expect, it } from 'vitest';
import type { Database } from '@galaxie/db';
import type { QueueTask } from '@galaxie/db/queue';
import {
  originsForHost,
  tenantVerifyDomain,
  txtMatches,
  txtRecordName,
  type DomainRecord,
} from './domain.js';
import type { TaskContext } from './run.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const TOKEN = 'galaxie-verify=token-de-teste';

function world(record: DomainRecord | null, txt: Record<string, string[][] | Error>) {
  const saves: unknown[] = [];
  const origins: { tenantId: string; origins: readonly string[] }[] = [];
  const deps = {
    resolveTxt: async (name: string) => {
      const r = txt[name];
      if (r === undefined) throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
      if (r instanceof Error) throw r;
      return r;
    },
    load: async () => record,
    save: async (_db: Database, _id: string, patch: unknown) => {
      saves.push(patch);
    },
    addOrigins: async (_db: Database, tenantId: string, list: readonly string[]) => {
      origins.push({ tenantId, origins: list });
      return list.length ? 1 : 0;
    },
    now: () => NOW,
  };
  const ctx = {
    db: {} as Database,
    task: { id: 't' } as QueueTask,
    params: { domainId: 'd1' },
    previa: false,
    previaId: null,
    checkpoint: null,
    save: async () => {},
    signal: new AbortController().signal,
    checkStop: () => {},
  } as TaskContext;
  return { deps, saves, origins, ctx };
}

const pending: DomainRecord = {
  id: 'd1',
  tenantId: 't1',
  host: 'app.exemplo.com',
  txtToken: TOKEN,
  verifiedAt: null,
};

describe('tenant.verify_domain', () => {
  it('marca comprovado quando um dos TXT é igual ao token (pedaços juntados)', async () => {
    const w = world(pending, {
      [txtRecordName('app.exemplo.com')]: [['outro'], ['galaxie-', 'verify=token-de-teste']],
    });
    const out = await tenantVerifyDomain(w.deps)(w.ctx);
    expect(out.stats).toEqual({ comprovado: 1, registros: 2, chavesComOrigem: 1 });
    expect(w.saves).toEqual([{ verifiedAt: NOW, lastCheckedAt: NOW, lastError: null }]);
    // o host comprovado entra nas origens das chaves publicáveis da marca, com o www. (decisão 12)
    expect(w.origins).toEqual([
      { tenantId: 't1', origins: ['https://app.exemplo.com', 'https://www.app.exemplo.com'] },
    ]);
  });

  it('sem o valor: grava a conferência e o motivo, sem comprovar', async () => {
    const w = world(pending, { '_galaxie-verify.app.exemplo.com': [['galaxie-verify=errado']] });
    const out = await tenantVerifyDomain(w.deps)(w.ctx);
    expect(out.stats).toEqual({ comprovado: 0, registros: 1, chavesComOrigem: 0 });
    expect(w.saves).toEqual([
      { lastCheckedAt: NOW, lastError: 'TXT em _galaxie-verify.app.exemplo.com não tem o valor esperado' },
    ]);
    // sem comprovar, nenhuma origem entra
    expect(w.origins).toEqual([]);
  });

  it('registro inexistente: o erro de DNS vira last_error, sem falhar a tarefa', async () => {
    const w = world(pending, {});
    await tenantVerifyDomain(w.deps)(w.ctx);
    expect(w.saves).toEqual([{ lastCheckedAt: NOW, lastError: 'TXT não encontrado' }]);
  });

  it('já comprovado: só a conferência, sem regravar verified_at; apagado: encerra sem gravar', async () => {
    const w = world(
      { ...pending, verifiedAt: new Date('2026-01-01') },
      {
        '_galaxie-verify.app.exemplo.com': [[TOKEN]],
      },
    );
    await tenantVerifyDomain(w.deps)(w.ctx);
    expect(w.saves).toEqual([{ lastCheckedAt: NOW, lastError: null }]);
    // reconferência que bate: as origens que faltarem entram (idempotente nas que já estão)
    expect(w.origins).toHaveLength(1);
    const gone = world(null, {});
    expect((await tenantVerifyDomain(gone.deps)(gone.ctx)).stats).toEqual({ encontrado: 0 });
    expect(gone.saves).toEqual([]);
  });

  it('host já comprovado por outra marca: a colisão do índice vira last_error', async () => {
    const w = world(pending, { '_galaxie-verify.app.exemplo.com': [[TOKEN]] });
    let n = 0;
    w.deps.save = async (_db, _id, patch) => {
      if (++n === 1) throw Object.assign(new Error('dup'), { code: '23505' });
      w.saves.push(patch);
    };
    const out = await tenantVerifyDomain(w.deps)(w.ctx);
    expect(out.stats).toEqual({ comprovado: 0 });
    expect(w.saves).toEqual([{ lastCheckedAt: NOW, lastError: 'host já comprovado por outra marca' }]);
  });

  it('txtMatches ignora espaços nas pontas', () => {
    expect(txtMatches([[' galaxie-verify=token-de-teste ']], TOKEN)).toBe(true);
    expect(txtMatches([], TOKEN)).toBe(false);
  });

  it('originsForHost: o host e o www., só https; host que já é www. entra sozinho', () => {
    expect(originsForHost('exemplo.com')).toEqual(['https://exemplo.com', 'https://www.exemplo.com']);
    expect(originsForHost('www.exemplo.com')).toEqual(['https://www.exemplo.com']);
  });
});
