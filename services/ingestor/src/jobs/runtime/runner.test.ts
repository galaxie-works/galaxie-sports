import { describe, expect, it, vi } from 'vitest';
import { harness } from '../../testing/fake-api.js';
import {
  classify,
  dedupeRequests,
  paramsKey,
  planJob,
  plannedRequest,
  runJob,
  type JobSpec,
  type PlannedRequest,
} from './runner.js';

function spec(items: () => PlannedRequest[], job = 'teste'): JobSpec {
  return { job, priority: 'BOOTSTRAP', phases: [{ name: 'única', build: async () => items() }] };
}

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    plannedRequest('squads', 'football', '/players/squads', { team: i + 1 }),
  );

describe('paramsKey / dedupeRequests', () => {
  it('normaliza a chave e une pedidos idênticos somando cursores', () => {
    expect(paramsKey({ season: 2024, league: 71 })).toBe('league=71&season=2024');
    expect(paramsKey({})).toBe('*');
    const a = plannedRequest(
      'x',
      'football',
      '/fixtures',
      { ids: '1-2' },
      {
        cursors: [{ sport: 'football', endpoint: '/fixtures', key: 'id=1' }],
      },
    );
    const b = plannedRequest(
      'x',
      'football',
      '/fixtures',
      { ids: '1-2' },
      {
        cursors: [{ sport: 'football', endpoint: '/fixtures', key: 'id=2' }],
      },
    );
    const out = dedupeRequests([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.cursors.map((c) => c.key)).toEqual(['id=1', 'id=2']);
  });
});

describe('classify / planJob', () => {
  it('separa feito, cache, rede, bloqueado pelo plano e sem cobertura — sem chamar o fornecedor', async () => {
    const h = harness();
    await h.dayWithoutLive();
    await h.client.get({
      sport: 'football',
      endpoint: '/teams',
      params: { country: 'Brazil' },
      priority: 'BOOTSTRAP',
    });
    await h.cursors.complete(
      [{ sport: 'football', endpoint: '/coachs', key: 'team=1' }],
      {},
      new Date(h.clock.t),
    );
    const calls = h.api.calls.length;

    const items = [
      plannedRequest('coachs', 'football', '/coachs', { team: 1 }), // feito
      plannedRequest('teams', 'football', '/teams', { country: 'Brazil' }), // cache (TTL 7 dias)
      plannedRequest('fixtures', 'football', '/fixtures', { league: 71, season: 2024 }), // rede
      plannedRequest('fixtures', 'football', '/fixtures', { league: 71, season: 2026 }), // free: bloqueado
      plannedRequest(
        'standings',
        'football',
        '/standings',
        { league: 71, season: 2024 },
        { skip: 'no_coverage' },
      ),
    ];
    expect(await classify(items, h.deps)).toEqual(['done', 'cache', 'network', 'blocked', 'no_coverage']);
    // com --forcar o cursor não vale: /coachs não está no raw, então iria à rede
    expect(await classify(items, h.deps, true)).toEqual([
      'network',
      'cache',
      'network',
      'blocked',
      'no_coverage',
    ]);

    const plan = await planJob(
      spec(() => items),
      h.deps,
    );
    expect(plan.totals).toMatchObject({ total: 5, done: 1, cache: 1, network: 1, blocked: 1, noCoverage: 1 });
    expect(h.api.calls.length).toBe(calls);
  });

  it('cursor concluído antes de staleBefore volta a ser pendente (rodízio / sync diário)', async () => {
    const h = harness();
    const ref = { sport: 'football', endpoint: '/players/squads', key: 'team=9' };
    await h.cursors.complete([ref], {}, new Date(h.clock.t - 10 * 86_400_000));
    const item = plannedRequest('squads', 'football', '/players/squads', { team: 9 });
    expect(await classify([item], h.deps)).toEqual(['done']);
    expect(await classify([{ ...item, staleBefore: new Date(h.clock.t - 7 * 86_400_000) }], h.deps)).toEqual([
      'network',
    ]);
  });
});

describe('runJob', () => {
  it('executa, marca cursores, chama o afterFetch e não repete na segunda execução', async () => {
    const h = harness();
    await h.dayWithoutLive();
    const afterFetch = vi.fn();
    const first = await runJob(
      spec(() => teams(5)),
      h.deps,
      { afterFetch },
    );
    expect(first).toMatchObject({ status: 'ok', callsSpent: 5 });
    expect(afterFetch).toHaveBeenCalledTimes(5);
    expect(afterFetch.mock.calls[0]![0].results).toBe(1);
    expect(afterFetch.mock.calls[0]![1]).toMatchObject({ step: 'squads', source: 'network' });
    expect(h.cursors.rows.size).toBe(5);
    expect(h.runs.runs[0]).toMatchObject({ job: 'teste', status: 'ok', callsSpent: 5 });

    const second = await runJob(
      spec(() => teams(5)),
      h.deps,
    );
    expect(second.callsSpent).toBe(0);
    expect(second.totals.done).toBe(5);
    expect(h.api.calls).toHaveLength(5);
  });

  it('--forcar ignora os cursores, mas o cache do raw continua valendo (zero cota)', async () => {
    const h = harness();
    await h.dayWithoutLive();
    await runJob(
      spec(() => teams(3)),
      h.deps,
    );
    const again = await runJob(
      spec(() => teams(3)),
      h.deps,
      { force: true },
    );
    expect(again.totals).toMatchObject({ cache: 3, done: 0 });
    expect(again.callsSpent).toBe(0);
  });

  it('respeita --max-chamadas e retoma do ponto onde parou', async () => {
    const h = harness();
    await h.dayWithoutLive();
    const r1 = await runJob(
      spec(() => teams(10)),
      h.deps,
      { maxCalls: 4 },
    );
    expect(r1).toMatchObject({ status: 'partial', stoppedBy: 'max_calls', callsSpent: 4 });
    expect(r1.totals.pending).toBe(6);
    const r2 = await runJob(
      spec(() => teams(10)),
      h.deps,
    );
    expect(r2).toMatchObject({ status: 'ok', callsSpent: 6 });
    expect(r2.totals.done).toBe(4);
    expect(new Set(h.api.calls.map((u) => u.search)).size).toBe(10);
  });

  it('erro de plano do fornecedor: conta tentativa, segue para o próximo e desiste após 3', async () => {
    const h = harness();
    await h.dayWithoutLive();
    const items = () => teams(2);
    for (let i = 0; i < 3; i++) {
      h.api.failNext({ plan: 'Free plans do not have access to this team.' });
      const r = await runJob(spec(items), h.deps);
      expect(r.status).toBe('ok');
      expect(r.totals.failed).toBe(1);
    }
    // o time 1 falhou 3 vezes (o 2 deu certo na primeira): agora fica de fora sem gastar cota
    const plan = await planJob(spec(items), h.deps);
    expect(plan.totals).toMatchObject({ failed: 1, done: 1, network: 0 });
  });

  it('erro que vale para a API inteira (cota do fornecedor esgotada) para o job sem marcar tentativa', async () => {
    const h = harness();
    await h.dayWithoutLive();
    h.api.failNext({ requests: 'You have reached the request limit for the day.' });
    const r = await runJob(
      spec(() => teams(4)),
      h.deps,
    );
    expect(r).toMatchObject({ status: 'partial', stoppedBy: 'provider', callsSpent: 1 });
    expect(r.totals.pending).toBe(3);
    expect(h.cursors.rows.size).toBe(0);
  });

  it('fases seguintes não são montadas depois que a cota acaba', async () => {
    const h = harness({ dailyLimit: 10 });
    const build = vi.fn(async () => teams(1));
    const job: JobSpec = {
      job: 'duas-fases',
      priority: 'BOOTSTRAP',
      phases: [
        { name: 'a', build: async () => teams(20) },
        { name: 'b', build },
      ],
    };
    const r = await runJob(job, h.deps);
    expect(r).toMatchObject({ status: 'partial', stoppedBy: 'quota', skippedPhases: ['b'] });
    expect(build).not.toHaveBeenCalled();
  });
});

describe('simulação: orçamento diário, parada e retomada', () => {
  it('um bootstrap maior que a cota do dia termina em 3 dias, sem nenhuma chamada repetida', async () => {
    // limite 20/dia: reserva 3 → BOOTSTRAP fica com 17 num dia planejado sem ao vivo
    const h = harness({ dailyLimit: 20 });
    const job = () => spec(() => teams(40), 'bootstrap:simulado');
    const days: { calls: number; pending: number; status: string }[] = [];
    for (let day = 0; day < 5; day++) {
      await h.dayWithoutLive();
      const r = await runJob(job(), h.deps);
      days.push({ calls: r.callsSpent, pending: r.totals.pending, status: r.status });
      if (r.status === 'ok') break;
      h.nextDay();
    }
    expect(days).toEqual([
      { calls: 17, pending: 23, status: 'partial' },
      { calls: 17, pending: 6, status: 'partial' },
      { calls: 6, pending: 0, status: 'ok' },
    ]);
    expect(h.api.calls).toHaveLength(40);
    expect(new Set(h.api.calls.map((u) => u.search)).size).toBe(40);
    expect(h.runs.runs.map((r) => r.status)).toEqual(['partial', 'partial', 'ok']);
  });

  it('sem planejar o dia, a política padrão protege DAILY e LIVE e o BOOTSTRAP só usa a folga', async () => {
    const h = harness({ dailyLimit: 100 });
    const r = await runJob(
      spec(() => teams(30)),
      h.deps,
    );
    // 100 − 15 de reserva − 40 DAILY − 40 LIVE protegidos = 5
    expect(r).toMatchObject({ status: 'partial', stoppedBy: 'quota', callsSpent: 5 });
  });
});
