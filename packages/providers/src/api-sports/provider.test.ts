import { describe, expect, it } from 'vitest';
import {
  ApiSportsError,
  PlanViolationError,
  QuotaExceededError,
  RequestInFlightError,
  type CallRequest,
  type CallResult,
} from '@galaxie/apisports-client';
import { loadFootballFixture } from '../../test/load-fixture.js';
import { FakeProvider } from '../fake-provider.js';
import { emptyBatch } from '../model.js';
import { canOverride, providerRank, type PrecedencePolicy } from '../precedence.js';
import { UnsupportedQueryError, type SportsDataProvider } from '../provider.js';
import { ApiSportsProvider, classifyApiSportsError, type ApiSportsGetter } from './provider.js';

const FETCHED = new Date('2026-10-21T14:13:54Z');

/** Cliente falso: responde com envelopes de fixture por endpoint, sem rede e sem cota. */
function fakeClient(responses: Record<string, unknown | Error>): ApiSportsGetter & { calls: CallRequest[] } {
  const calls: CallRequest[] = [];
  return {
    calls,
    async get<T>(req: CallRequest): Promise<CallResult<T>> {
      calls.push(req);
      const r = responses[req.endpoint];
      if (r instanceof Error) throw r;
      return {
        envelope: (r ?? { get: req.endpoint, parameters: {}, errors: [], results: 0, response: [] }) as never,
        source: 'cache',
        requestHash: 'h',
        fetchedAt: FETCHED,
      };
    },
  };
}

describe('ApiSportsProvider', () => {
  it('lista eventos de uma temporada pelo cliente e devolve o lote neutro', async () => {
    const client = fakeClient({ '/fixtures': loadFootballFixture('fixtures-league-71-2024.json') });
    const provider: SportsDataProvider = new ApiSportsProvider(client, { priority: 'DAILY', jobId: 'job-1' });
    const r = await provider.listEvents({ sport: 'football', competitionId: '71', season: 2024 });
    expect(client.calls).toEqual([
      {
        sport: 'football',
        endpoint: '/fixtures',
        params: { league: '71', season: 2024 },
        priority: 'DAILY',
        jobId: 'job-1',
      },
    ]);
    expect(r.status).toBe('ok');
    if (r.status !== 'error') {
      expect(r.batch.events).toHaveLength(4);
      expect(r.fetchedAt).toEqual(FETCHED);
      expect(r.source).toBe('cache');
    }
  });

  it('monta os parâmetros de cada consulta', async () => {
    const client = fakeClient({});
    const p = new ApiSportsProvider(client);
    await p.listEvents({ sport: 'football', date: '2026-10-21' });
    await p.listEvents({ sport: 'football', participantIds: ['121', '131'] });
    await p.getEventDetail('football', '1492407');
    await p.listLive('football', ['71', '13']);
    await p.listLive('football', ['307']);
    await p.listLive('football');
    await p.listParticipants({ sport: 'football', country: 'Brazil' });
    await p.listParticipants({ sport: 'football', competitionId: '71', season: 2024 });
    await p.listSquad('football', '121');
    await p.listCoaches('football', '121');
    await p.listStandings('football', '71', 2024);
    await p.listCompetitions('football');
    expect(client.calls.map((c) => [c.endpoint, c.params, c.priority])).toEqual([
      ['/fixtures', { date: '2026-10-21' }, 'ADHOC'],
      ['/fixtures/headtohead', { h2h: '121-131' }, 'ADHOC'],
      ['/fixtures', { id: '1492407' }, 'ADHOC'],
      ['/fixtures', { live: '71-13' }, 'LIVE'],
      ['/fixtures', { live: '307-307' }, 'LIVE'],
      ['/fixtures', { live: 'all' }, 'LIVE'],
      ['/teams', { country: 'Brazil' }, 'ADHOC'],
      ['/teams', { league: '71', season: 2024 }, 'ADHOC'],
      ['/players/squads', { team: '121' }, 'ADHOC'],
      ['/coachs', { team: '121' }, 'ADHOC'],
      ['/standings', { league: '71', season: 2024 }, 'ADHOC'],
      ['/leagues', {}, 'ADHOC'],
    ]);
  });

  it('payload vazio vira `empty` (o chamador mantém o último estado válido)', async () => {
    const p = new ApiSportsProvider(fakeClient({}));
    const r = await p.getEventDetail('football', '1');
    expect(r.status).toBe('empty');
  });

  it('falha do fornecedor vira `error` classificado, sem lançar', async () => {
    const now = new Date('2026-10-21T20:00:00Z');
    const p = new ApiSportsProvider(
      fakeClient({ '/fixtures': new ApiSportsError('http_error', { status: 503 }, 'h') }),
      undefined,
      () => now,
    );
    const r = await p.listLive('football');
    expect(r).toEqual({
      status: 'error',
      error: { kind: 'http_error', message: expect.stringContaining('http_error'), retryable: true },
      fetchedAt: now,
    });
  });

  it('classifica as exceções do cliente', () => {
    const kinds = [
      new ApiSportsError('plan_error', {}, 'h'),
      new ApiSportsError('rate_limited', {}, 'h'),
      new ApiSportsError('quota_exhausted', {}, 'h'),
      new ApiSportsError('auth_error', {}, 'h'),
      new ApiSportsError('timeout', {}, 'h'),
      new PlanViolationError('season', 'fora do plano'),
      new QuotaExceededError('football', 'LIVE', 'sem saldo'),
      new RequestInFlightError('abc'),
      new TypeError('fetch failed'),
    ].map((e) => classifyApiSportsError(e).kind);
    expect(kinds).toEqual([
      'plan',
      'rate_limited',
      'quota',
      'auth',
      'timeout',
      'plan',
      'quota',
      'rate_limited',
      'http_error',
    ]);
  });

  it('recusa esportes que ainda não normaliza', () => {
    const p = new ApiSportsProvider(fakeClient({}));
    expect(p.supports('basketball')).toBe(false);
    expect(() => p.listLive('basketball')).toThrow(UnsupportedQueryError);
  });
});

describe('FakeProvider', () => {
  it('implementa a mesma interface e devolve o que foi enfileirado', async () => {
    const batch = emptyBatch('provedor-licenciado', 'football', FETCHED);
    batch.participants.push({
      id: 'T1',
      kind: 'club',
      name: 'Time Um',
      shortName: null,
      code: null,
      countryName: null,
      countryCode: 'BR',
      founded: null,
      venueId: null,
      logoUrl: null,
    });
    const fake: SportsDataProvider = new FakeProvider('provedor-licenciado')
      .willReturn('listParticipants', batch)
      .willFail('listLive', { kind: 'timeout', message: 'sem resposta', retryable: true }, FETCHED);
    expect((await fake.listParticipants({ sport: 'football', country: 'Brazil' })).status).toBe('ok');
    expect(await fake.listLive('football')).toMatchObject({ status: 'error', error: { kind: 'timeout' } });
    await expect(fake.listLive('football')).rejects.toThrow(/nenhuma resposta/);
  });
});

describe('precedência entre provedores', () => {
  const policy: PrecedencePolicy = { order: ['provedor-cliente', 'api-sports'], staleAfterMs: 5 * 60_000 };
  const now = new Date('2026-10-21T20:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it('ordem: listados primeiro, desconhecidos por último', () => {
    expect(providerRank(policy, 'provedor-cliente')).toBe(0);
    expect(providerRank(policy, 'api-sports')).toBe(1);
    expect(providerRank(policy, 'outro')).toBe(2);
  });

  const cases: [string, Parameters<typeof canOverride>[1], string, boolean][] = [
    ['ninguém escreveu ainda', { provider: null, lastValidAt: null, isStale: false }, 'api-sports', true],
    [
      'o próprio dono atualiza',
      { provider: 'api-sports', lastValidAt: ago(1), isStale: false },
      'api-sports',
      true,
    ],
    [
      'maior precedência sobrescreve',
      { provider: 'api-sports', lastValidAt: ago(1), isStale: false },
      'provedor-cliente',
      true,
    ],
    [
      'menor precedência não sobrescreve dado fresco',
      { provider: 'provedor-cliente', lastValidAt: ago(1), isStale: false },
      'api-sports',
      false,
    ],
    [
      'menor precedência assume quando o dono está stale',
      { provider: 'provedor-cliente', lastValidAt: ago(1), isStale: true },
      'api-sports',
      true,
    ],
    [
      'menor precedência assume quando o dono some',
      { provider: 'provedor-cliente', lastValidAt: ago(6), isStale: false },
      'api-sports',
      true,
    ],
    [
      'desconhecido não sobrescreve listado',
      { provider: 'api-sports', lastValidAt: ago(1), isStale: false },
      'outro',
      false,
    ],
  ];
  it.each(cases)('%s', (_name, current, incoming, expected) => {
    expect(canOverride(policy, current, incoming, now)).toBe(expected);
  });
});
