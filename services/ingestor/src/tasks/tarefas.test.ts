/**
 * Executores das tarefas longas (#543) com dependências falsas: lotes, checkpoint a cada lote, retomada do
 * checkpoint, parada entre lotes no encerramento e a volta à fila quando a cota acaba.
 */
import { describe, expect, it } from 'vitest';
import type { Database } from '@galaxie/db';
import type { QueueTask } from '@galaxie/db/queue';
import { readLog, readProgress } from '@galaxie/db/queue-types';
import type { MirrorReport } from '../assets/asset-mirror.js';
import { backfillNormalizar, backfillTabelas, seasonLots } from './backfill.js';
import {
  cargaHistorica,
  cargaLots,
  lotOutcome,
  nextQuotaDay,
  type CargaDeps,
  type CargaLot,
} from './carga.js';
import { assetsEspelhar, CDN_PAUSE_MS, type EspelhoDeps } from './espelho.js';
import { runLots } from './lotes.js';
import { TaskInterruptedError, type TaskContext } from './run.js';

interface FakeCtx extends TaskContext {
  saves: unknown[];
  stop: AbortController;
}

function fakeCtx(
  params: Record<string, unknown>,
  opts: { previa?: boolean; checkpoint?: unknown } = {},
): FakeCtx {
  const stop = new AbortController();
  const ctx: FakeCtx = {
    db: {} as Database,
    task: { id: 'tarefa-1' } as QueueTask,
    params,
    previa: opts.previa ?? false,
    previaId: opts.previa ? null : 'previa-1',
    checkpoint: opts.checkpoint ?? null,
    saves: [],
    stop,
    signal: stop.signal,
    save: async (data) => {
      ctx.saves.push(data);
    },
    checkStop: () => {
      if (stop.signal.aborted) throw new TaskInterruptedError('tarefa-1');
    },
  };
  return ctx;
}

const last = (ctx: FakeCtx) => ctx.saves.at(-1) as Record<string, unknown>;

describe('runLots', () => {
  const lots = ['a', 'b', 'c'].map((id) => ({ id, label: `lote ${id}` }));

  it('grava o checkpoint a cada lote e retoma pulando os concluídos', async () => {
    const ctx = fakeCtx({});
    const ran: string[] = [];
    let n = 0;
    await expect(
      runLots(ctx, lots, async (lot) => {
        ran.push(lot.id);
        if (++n === 2) ctx.stop.abort(); // o deploy chega no meio do lote b
        return { stats: { itens: 10 } };
      }),
    ).rejects.toBeInstanceOf(TaskInterruptedError);
    // o lote b terminou (a parada é entre lotes) e ficou gravado; o c não começou
    expect(ran).toEqual(['a', 'b']);
    expect(ctx.saves).toHaveLength(2);
    expect(last(ctx)).toMatchObject({ concluidos: ['a', 'b'], ultimoLote: 'b', totais: { itens: 20 } });
    expect(readProgress(last(ctx))).toEqual({ feitos: 2, total: 3, lote: 'lote b' });

    // a próxima tomada recebe o checkpoint e faz só o c
    const next = fakeCtx({}, { checkpoint: last(ctx) });
    const again: string[] = [];
    const r = await runLots(next, lots, async (lot) => {
      again.push(lot.id);
      return { stats: { itens: 10 } };
    });
    expect(again).toEqual(['c']);
    expect(r).toMatchObject({ feitos: 3, total: 3, totais: { itens: 30 } });
    expect(readLog(r.checkpoint)).toEqual(['lote a: itens 10', 'lote b: itens 10', 'lote c: itens 10']);
  });

  it('lote que pede para continuar depois para o laço e fica pendente', async () => {
    const ctx = fakeCtx({});
    const at = new Date('2026-11-04T00:30:00Z');
    const r = await runLots(ctx, lots, async (lot) =>
      lot.id === 'b' ? { adiarAte: at, stats: { chamadas: 3 }, log: 'cota' } : { stats: { chamadas: 5 } },
    );
    expect(r).toMatchObject({ adiarAte: at, feitos: 1, totais: { chamadas: 8 } });
    expect(last(ctx)).toMatchObject({ concluidos: ['a'], totais: { chamadas: 8 } });
    expect(readLog(last(ctx)).at(-1)).toBe('lote b: cota');
  });
});

describe('carga.historica', () => {
  const lots = cargaLots({ etapas: ['temporadas', 'detalhes', 'pessoas'] }, [71, 13]);

  function fakeDeps(script: (lot: CargaLot, call: number) => Awaited<ReturnType<CargaDeps['run']>>) {
    const calls: string[] = [];
    let prepared = 0;
    const deps: CargaDeps = {
      lots: async () => lots,
      plan: async (lot) => ({ rede: lot.etapa === 'pessoas' ? 40 : 10, cache: 1, feitos: 0 }),
      run: async (lot) => {
        calls.push(lot.id);
        return script(lot, calls.length);
      },
      prepareDay: async () => {
        prepared += 1;
      },
      close: async () => {},
    };
    return { deps, calls, prepared: () => prepared };
  }

  it('lotes por liga nas etapas por liga, um lote nas outras, na ordem das etapas', () => {
    expect(lots.map((l) => l.id)).toEqual([
      'temporadas:71',
      'temporadas:13',
      'detalhes:71',
      'detalhes:13',
      'pessoas',
    ]);
  });

  it('cota esgotada no meio: não falha, volta à fila no próximo dia de cota e retoma do lote que parou', async () => {
    const now = new Date('2026-11-03T15:20:00Z');
    const fake = fakeDeps((lot, call) =>
      call === 3
        ? { status: 'cota', chamadas: 7, pendentes: 30 }
        : { status: 'ok', chamadas: 20, pendentes: 0 },
    );
    const ctx = fakeCtx({ etapas: ['temporadas', 'detalhes', 'pessoas'], tierMax: 2, semLive: true });
    const out = await cargaHistorica(
      () => fake.deps,
      () => now,
    )(ctx);
    expect(out.runAfter).toEqual(new Date('2026-11-04T00:30:00Z'));
    expect(out.stats).toMatchObject({ chamadas: 47, lotes: 2, total: 5 });
    expect(fake.calls).toEqual(['temporadas:71', 'temporadas:13', 'detalhes:71']);
    expect(fake.prepared()).toBe(1);
    expect(last(ctx)).toMatchObject({ concluidos: ['temporadas:71', 'temporadas:13'] });

    // no dia seguinte: refaz o lote que parou (os cursores evitam gastar de novo) e segue
    const fake2 = fakeDeps(() => ({ status: 'ok', chamadas: 4, pendentes: 0 }));
    const ctx2 = fakeCtx(
      { etapas: ['temporadas', 'detalhes', 'pessoas'], tierMax: 2, semLive: false },
      {
        checkpoint: last(ctx),
      },
    );
    const done = await cargaHistorica(
      () => fake2.deps,
      () => now,
    )(ctx2);
    expect(done.runAfter).toBeUndefined();
    expect(fake2.calls).toEqual(['detalhes:71', 'detalhes:13', 'pessoas']);
    expect(done.stats).toMatchObject({ chamadas: 59, lotes: 5 });
  });

  it('rate limit do fornecedor: volta em 15 min', async () => {
    const now = new Date('2026-11-03T15:20:00Z');
    const fake = fakeDeps(() => ({ status: 'pausa', chamadas: 0, pendentes: 1 }));
    const out = await cargaHistorica(
      () => fake.deps,
      () => now,
    )(fakeCtx({ etapas: ['pessoas'], tierMax: 2, semLive: false }));
    expect(out.runAfter).toEqual(new Date(now.getTime() + 15 * 60_000));
  });

  it('prévia soma o plano dos lotes sem rodar nada', async () => {
    const fake = fakeDeps(() => {
      throw new Error('não deveria rodar');
    });
    const ctx = fakeCtx(
      { etapas: ['temporadas', 'detalhes', 'pessoas'], tierMax: 2, semLive: true },
      { previa: true },
    );
    await cargaHistorica(() => fake.deps)(ctx);
    expect(fake.prepared()).toBe(0);
    expect(last(ctx)).toMatchObject({ previa: { contagens: { lotes: 5, rede: 80, cache: 5, feitos: 0 } } });
  });

  it('desfecho do runJob: cota, rate limit, teto do lote e erro do fornecedor', () => {
    const base = { job: 'bootstrap:seasons', runId: 'r', phases: [], skippedPhases: [], callsSpent: 3 };
    const totals = {
      total: 0,
      done: 0,
      cache: 0,
      network: 0,
      blocked: 0,
      failed: 0,
      noCoverage: 0,
      pending: 9,
    };
    expect(lotOutcome({ ...base, totals, status: 'ok' }).status).toBe('ok');
    expect(lotOutcome({ ...base, totals, status: 'partial', stoppedBy: 'quota' }).status).toBe('cota');
    expect(
      lotOutcome({
        ...base,
        totals,
        status: 'partial',
        stoppedBy: 'provider',
        reason: 'quota_exhausted: limite',
      }).status,
    ).toBe('cota');
    expect(
      lotOutcome({ ...base, totals, status: 'partial', stoppedBy: 'provider', reason: 'rate_limited' })
        .status,
    ).toBe('pausa');
    expect(lotOutcome({ ...base, totals, status: 'partial', stoppedBy: 'max_calls' })).toMatchObject({
      status: 'limite',
      pendentes: 9,
    });
    expect(() =>
      lotOutcome({ ...base, totals, status: 'partial', stoppedBy: 'provider', reason: 'auth_error' }),
    ).toThrow(/auth_error/);
  });

  it('próximo dia de cota: 00:30 UTC do dia seguinte', () => {
    expect(nextQuotaDay(new Date('2026-11-30T23:59:00Z'))).toEqual(new Date('2026-12-01T00:30:00Z'));
    expect(nextQuotaDay(new Date('2026-11-03T00:10:00Z'))).toEqual(new Date('2026-11-04T00:30:00Z'));
  });
});

describe('assets.espelhar', () => {
  const report = (over: Partial<MirrorReport>): MirrorReport => ({
    pending: 0,
    stored: 0,
    notFound: 0,
    denied: 0,
    placeholders: 0,
    placeholderLogos: 0,
    logoCleanup: { placeholders: 0, participants: 0, competitions: 0 },
    photoCleanup: 0,
    failed: 0,
    errors: 0,
    recoveredLogos: [],
    unlinked: 0,
    bytes: 0,
    aborted: null,
    failures: [],
    notFoundUrls: [],
    ...over,
  });

  function fakeDeps(reports: MirrorReport[]) {
    const calls: { limit: number | undefined; skipCleanup: boolean | undefined }[] = [];
    let discovered = 0;
    let finished: readonly string[] | undefined;
    const deps: EspelhoDeps = {
      mirror: async (call) => {
        calls.push({ limit: call.limit, skipCleanup: call.skipCleanup });
        return (
          reports.shift() ??
          report({ pending: 0, cursor: { retomou: true, fimDaVolta: true, interrompida: false } })
        );
      },
      cursor: () => ({ load: async () => ({}), save: async () => {} }),
      discover: async () => {
        discovered += 1;
        return { urls: 10, added: 2 };
      },
      finish: async (recovered) => {
        finished = recovered;
        return 'fim';
      },
      close: () => {},
    };
    return { deps, calls, discovered: () => discovered, finished: () => finished };
  }

  const params = { limite: 500, lote: 200, descobrirRaw: true, retentarAusentes: false, concorrencia: 3 };

  it('lotes até o limite, limpeza só no primeiro e o fim da volta encerra', async () => {
    const fake = fakeDeps([
      report({ pending: 200, stored: 190, failed: 10, recoveredLogos: ['x'] }),
      report({ pending: 120, stored: 120, cursor: { retomou: true, fimDaVolta: true, interrompida: false } }),
    ]);
    const ctx = fakeCtx(params);
    const out = await assetsEspelhar(async () => fake.deps)(ctx);
    expect(fake.calls).toEqual([
      { limit: 200, skipCleanup: false },
      { limit: 200, skipCleanup: true },
    ]);
    expect(fake.discovered()).toBe(1);
    expect(fake.finished()).toEqual(['x']);
    expect(out.stats).toMatchObject({ stored: 310, failed: 10, feitos: 320 });
    expect(readProgress(ctx.saves.at(-2))).toEqual({ feitos: 320, total: 500, lote: 'lote 2' });
  });

  it('retoma do checkpoint: não descobre o raw de novo nem refaz a limpeza, e para no limite', async () => {
    const fake = fakeDeps([report({ pending: 100, stored: 100 })]);
    const ctx = fakeCtx(params, {
      checkpoint: { descoberto: true, limpo: true, feitos: 400, totais: { stored: 400 } },
    });
    const out = await assetsEspelhar(async () => fake.deps)(ctx);
    expect(fake.discovered()).toBe(0);
    expect(fake.calls).toEqual([{ limit: 100, skipCleanup: true }]);
    expect(out.stats).toMatchObject({ stored: 500, feitos: 500 });
  });

  it('CDN com 429 em sequência: volta à fila em 30 min, sem falhar', async () => {
    const now = new Date('2026-11-03T10:00:00Z');
    const fake = fakeDeps([
      report({ pending: 200, stored: 20, failed: 5, aborted: 'A CDN de mídia respondeu 429.' }),
    ]);
    const out = await assetsEspelhar(
      async () => fake.deps,
      () => now,
    )(fakeCtx(params));
    expect(out.runAfter).toEqual(new Date(now.getTime() + CDN_PAUSE_MS));
    expect(fake.finished()).toBeUndefined();
  });

  it('SIGTERM no meio do lote: grava o checkpoint e interrompe (a tarefa volta à fila)', async () => {
    const ctx = fakeCtx(params);
    const fake = fakeDeps([]);
    fake.deps.mirror = async () => {
      ctx.stop.abort();
      return report({
        pending: 200,
        stored: 30,
        cursor: { retomou: false, fimDaVolta: false, interrompida: true },
      });
    };
    await expect(assetsEspelhar(async () => fake.deps)(ctx)).rejects.toBeInstanceOf(TaskInterruptedError);
    expect(last(ctx)).toMatchObject({ feitos: 30, limpo: true });
  });

  it('prévia conta os pendentes sem baixar nada', async () => {
    const fake = fakeDeps([report({ pending: 1234 })]);
    const ctx = fakeCtx(params, { previa: true });
    await assetsEspelhar(async () => fake.deps)(ctx);
    expect(last(ctx)).toMatchObject({ previa: { contagens: { pendentes: 1234, lotes: 7 } } });
    expect(fake.discovered()).toBe(0);
  });
});

describe('backfills', () => {
  it('backfill.normalizar: um lote por endpoint, retomando do checkpoint', async () => {
    const ran: string[] = [];
    const deps = {
      endpoints: async () => [
        { endpoint: '/fixtures', respostas: 10 },
        { endpoint: '/standings', respostas: 3 },
        { endpoint: '/teams', respostas: 5 },
      ],
      run: async (_db: Database, endpoint: string) => {
        ran.push(endpoint);
        return { respostas: endpoint === '/teams' ? 5 : 1, erros: endpoint === '/standings' ? 1 : 0 };
      },
    };
    const ctx = fakeCtx(
      {},
      { checkpoint: { concluidos: ['endpoint:/fixtures'], totais: { respostas: 10, erros: 0 } } },
    );
    const out = await backfillNormalizar(deps)(ctx);
    expect(ran).toEqual(['/standings', '/teams']);
    expect(out.stats).toEqual({ respostas: 16, erros: 1 });

    const previa = fakeCtx({ endpoints: ['/teams', '/odds'] }, { previa: true });
    await backfillNormalizar(deps)(previa);
    expect(last(previa)).toMatchObject({ previa: { contagens: { lotes: 1, respostas: 5 } } });
    expect((last(previa).previa as { resumo: string }).resumo).toMatch(/Sem raw: \/odds/);
  });

  it('backfill.tabelas: lotes de temporadas com id pelo conteúdo', async () => {
    const ids = Array.from(
      { length: 45 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const lots = seasonLots(ids, 20);
    expect(lots.map((l) => l.seasons.length)).toEqual([20, 20, 5]);
    expect(seasonLots([...ids].reverse(), 20).map((l) => l.id)).toEqual(lots.map((l) => l.id));

    const batches: number[] = [];
    const ctx = fakeCtx({ dias: 30, lote: 20 });
    const out = await backfillTabelas({
      seasons: async () => ids,
      recompute: async (_db, seasonIds) => {
        batches.push(seasonIds.length);
        return seasonIds.map((_, i) => ({ outcome: i === 0 ? 'skipped' : 'computed' }));
      },
    })(ctx);
    expect(batches).toEqual([20, 20, 5]);
    expect(out.stats).toEqual({ temporadas: 45, skipped: 3, computed: 42 });
  });
});
