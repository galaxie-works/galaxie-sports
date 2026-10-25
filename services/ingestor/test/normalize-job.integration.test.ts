/**
 * Jobs `normalize:<esporte>` no Postgres: resposta do raw com erro determinístico vira poison depois de algumas
 * tentativas (o cursor segue, a falha fica consultável em ops.normalize_failure e pode ser reprocessada) e o
 * pós-processamento da NBA roda antes de o cursor andar.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeParams, requestHash } from '@galaxie/apisports-client';
import { apiResponse, jobRun, normalizeFailure, sport, type Database } from '@galaxie/db';
import {
  NORMALIZE_POISON_ATTEMPTS,
  pendingNormalizeFailures,
  readNormalizeCursor,
  runNormalizeFootballJob,
  runNormalizeSportsJob,
} from '../src/normalize/raw-runner.js';
import { disposableDb } from './db.js';

// pós-processamento da NBA que falha na primeira vez (ex.: banco indisponível no meio do job)
const nba = vi.hoisted(() => ({ calls: 0, failNext: true }));
vi.mock('../src/standings/nba.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/standings/nba.js')>()),
  recomputeNbaStandings: async () => {
    nba.calls += 1;
    if (nba.failNext) {
      nba.failNext = false;
      throw new Error('falha simulada no recálculo da NBA');
    }
    return [];
  },
}));

const disposable = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
});
afterAll(() => disposable.teardown());

async function insertRaw(
  sportSlug: string,
  endpoint: string,
  params: Record<string, string>,
  response: unknown[],
  fetchedAt: string,
): Promise<number> {
  const p = normalizeParams(params);
  const body = { get: endpoint.slice(1), parameters: p, errors: [], results: response.length, response };
  const [row] = await db
    .insert(apiResponse)
    .values({
      provider: 'api-sports',
      sport: sportSlug,
      apiVersion: sportSlug === 'nba' ? 'v2' : 'v3',
      endpoint,
      params: p,
      requestHash: requestHash('api-sports', sportSlug, endpoint, p),
      statusCode: 200,
      results: response.length,
      errors: [],
      body,
      bodyHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      fetchedAt: new Date(fetchedAt),
      jobId: 'teste',
    })
    .returning({ id: apiResponse.id });
  return row!.id;
}

describe('normalize: resposta com erro determinístico', () => {
  let poison: number;
  let after: number;

  it('segura o cursor nas primeiras tentativas e vira poison na N-ésima; o cursor segue', async () => {
    // item sem placar/times: o normalizador quebra sempre nele
    poison = await insertRaw(
      'football',
      '/fixtures',
      { id: '1' },
      [{ fixture: { id: 1, date: 'x' }, league: { id: 1, season: 2026 } }],
      '2026-10-21T10:00:00Z',
    );
    after = await insertRaw('football', '/fixtures', { date: '2026-10-21' }, [], '2026-10-21T10:01:00Z');

    for (let attempt = 1; attempt < NORMALIZE_POISON_ATTEMPTS; attempt++) {
      const r = await runNormalizeFootballJob(db);
      expect(r.rows.map((row) => [row.id, row.outcome])).toEqual([
        [poison, 'error'],
        [after, 'empty'],
      ]);
      // o cursor para antes da que falhou: a próxima execução tenta de novo
      expect(await readNormalizeCursor(db)).toBe(poison - 1);
      const [f] = await pendingNormalizeFailures(db, 'api-sports', 'football');
      expect(f).toMatchObject({ rawId: poison, endpoint: '/fixtures', attempts: attempt, poisonedAt: null });
      expect(f!.error).toBeTruthy();
    }

    await runNormalizeFootballJob(db);
    const [f] = await pendingNormalizeFailures(db, 'api-sports', 'football');
    expect(f).toMatchObject({ rawId: poison, attempts: NORMALIZE_POISON_ATTEMPTS });
    expect(f!.poisonedAt).toBeInstanceOf(Date);
    expect(await readNormalizeCursor(db)).toBe(after);

    // a próxima incremental não reprocessa nada (antes: reprocessava tudo acima da que falhou, para sempre)
    const next = await runNormalizeFootballJob(db);
    expect(next.rows).toHaveLength(0);
    const runs = await db.select().from(jobRun).where(eq(jobRun.job, 'normalize:football'));
    expect(runs.filter((r) => r.status === 'partial')).toHaveLength(NORMALIZE_POISON_ATTEMPTS);
    expect(runs.some((r) => r.error?.includes(`raw ${poison} (poison)`))).toBe(true);
  });

  it('--reprocessar-falhas tenta de novo a resposta em poison e a resolve quando passa', async () => {
    // a correção (normalizador ou dado) entrou: a mesma resposta agora é processável
    await db
      .update(apiResponse)
      .set({ body: { get: 'fixtures', parameters: { id: '1' }, errors: [], results: 0, response: [] } })
      .where(eq(apiResponse.id, poison));
    const plain = await runNormalizeFootballJob(db);
    expect(plain.rows).toHaveLength(0);

    const retried = await runNormalizeFootballJob(db, { retryFailures: true });
    expect(retried.rows.map((r) => [r.id, r.outcome])).toEqual([[poison, 'empty']]);
    expect(await pendingNormalizeFailures(db, 'api-sports', 'football')).toHaveLength(0);
    const [f] = await db.select().from(normalizeFailure).where(eq(normalizeFailure.rawId, poison));
    expect(f!.resolvedAt).toBeInstanceOf(Date);
    expect(await readNormalizeCursor(db)).toBe(after);
  });

  it('falha pendente cuja requisição já tem resposta mais nova no raw fica resolvida no reprocessamento', async () => {
    const broken = await insertRaw(
      'football',
      '/fixtures',
      { id: '2' },
      [{ fixture: { id: 2, date: 'x' }, league: { id: 1, season: 2026 } }],
      '2026-10-21T11:00:00Z',
    );
    await runNormalizeFootballJob(db);
    expect((await pendingNormalizeFailures(db, 'api-sports', 'football')).map((f) => f.rawId)).toEqual([
      broken,
    ]);
    // o fornecedor respondeu de novo a mesma requisição: a resposta velha deixa de ser a vigente
    const fresh = await insertRaw('football', '/fixtures', { id: '2' }, [], '2026-10-21T12:00:00Z');
    const r = await runNormalizeFootballJob(db, { retryFailures: true });
    expect(r.rows.map((row) => row.id)).toEqual([fresh]);
    expect(await pendingNormalizeFailures(db, 'api-sports', 'football')).toHaveLength(0);
    expect(await readNormalizeCursor(db)).toBe(fresh);
  });
});

describe('normalize:nba', () => {
  it('pós-processamento que falha não deixa o cursor andar; a próxima execução tenta de novo', async () => {
    const id = await insertRaw('nba', '/games', { date: '2026-10-21' }, [], '2026-10-21T10:00:00Z');
    await expect(runNormalizeSportsJob(db, { sports: ['nba'] })).rejects.toThrow('falha simulada');
    expect(await readNormalizeCursor(db, 'api-sports', 'nba')).toBe(0);
    const [failed] = await db.select().from(jobRun).where(eq(jobRun.job, 'normalize:nba'));
    expect(failed!.status).toBe('error');

    const [again] = await runNormalizeSportsJob(db, { sports: ['nba'] });
    expect(again!.result.rows.map((r) => r.id)).toEqual([id]);
    expect(nba.calls).toBe(2);
    expect(await readNormalizeCursor(db, 'api-sports', 'nba')).toBe(id);
  });
});
