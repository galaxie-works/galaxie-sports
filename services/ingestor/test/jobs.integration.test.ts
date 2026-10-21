import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, count, eq, like, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiSportsClient,
  defaultPolicy,
  FREE_PLAN,
  PgQuotaGovernor,
  PgRawStore,
  PlanRules,
  PRO_PLAN,
  RateLimiter,
  type Clock,
  type PlanLimits,
} from '@galaxie/apisports-client';
import {
  apiResponse,
  asset,
  closeDb,
  competition,
  createDb,
  jobRun,
  runMigrations,
  season,
  syncCursor,
  type Database,
} from '@galaxie/db';
import { runFootballCatalogJob } from '../src/bootstrap/football-catalog-job.js';
import { PgCatalogSource } from '../src/jobs/catalog-source.js';
import { dailyJob } from '../src/jobs/daily-job.js';
import { detailsJob } from '../src/jobs/details-job.js';
import { PgCursorStore } from '../src/jobs/runtime/cursor-store.js';
import { PgJobRunStore } from '../src/jobs/runtime/job-run-store.js';
import { PgRawSource } from '../src/jobs/runtime/raw-source.js';
import { planJob, runJob, type RunDeps } from '../src/jobs/runtime/runner.js';
import { seasonsJob } from '../src/jobs/seasons-job.js';
import { exportRawSnapshot, importRawSnapshot } from '../src/snapshot/raw-snapshot.js';
import { fakeApi, fakeCatalogConfig, NOW, type FakeApi } from '../src/testing/fake-api.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const suffix = randomBytes(4).toString('hex');
const dbName = `galaxie_test_${suffix}`;
const restoreName = `galaxie_test_${suffix}_r`;
const urlFor = (name: string) => {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return u.toString();
};

const DAY = 86_400_000;
let admin: postgres.Sql;
let db: Database;
let restored: Database;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  for (const name of [dbName, restoreName]) {
    await admin.unsafe(`CREATE DATABASE ${name}`);
    await runMigrations(urlFor(name));
  }
  db = createDb(urlFor(dbName), { max: 5 });
  restored = createDb(urlFor(restoreName), { max: 5 });
}, 90_000);

afterAll(async () => {
  if (db) await closeDb(db);
  if (restored) await closeDb(restored);
  for (const name of [dbName, restoreName])
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

const clock: Clock & { t: number } = {
  t: Date.parse(NOW),
  now: () => clock.t,
  sleep: async (ms) => {
    clock.t += ms;
  },
};
const now = () => new Date(clock.t);

interface PgHarness {
  deps: RunDeps;
  api: FakeApi;
  governor: PgQuotaGovernor;
  dayWithoutLive(): Promise<void>;
}

function pg(
  target: Database,
  limits: PlanLimits,
  dailyLimit = limits.dailyLimit,
  offline = false,
): PgHarness {
  const api = fakeApi(now);
  const governor = new PgQuotaGovernor(target, () => defaultPolicy(dailyLimit), now);
  const plan = new PlanRules(limits);
  const client = new ApiSportsClient({
    apiKey: offline ? '' : 'test-key',
    store: new PgRawStore(target),
    governor,
    fetch: api.fetchFn,
    clock,
    plan,
    rateLimiter: new RateLimiter(600_000, clock),
    offline,
  });
  return {
    api,
    governor,
    deps: {
      client,
      plan,
      now,
      cursors: new PgCursorStore(target),
      runs: new PgJobRunStore(target),
      raw: new PgRawSource(target, 7),
    },
    dayWithoutLive: async () =>
      governor.plan('football', now().toISOString().slice(0, 10), { LIVE: 0, DAILY: 0 }),
  };
}

const catalog = () => new PgCatalogSource(db);

describe('jobs de ingestão contra o Postgres', () => {
  it('catálogo (pré-requisito): /leagues e /countries do servidor falso viram core.competition e core.season', async () => {
    const h = pg(db, FREE_PLAN);
    await h.dayWithoutLive();
    await runFootballCatalogJob(db, h.deps.client, fakeCatalogConfig());
    const comps = await catalog().competitions(2);
    expect(comps.map((c) => [c.leagueId, c.tier])).toEqual([
      [13, 1],
      [71, 1],
      [72, 2],
    ]);
    expect(comps.find((c) => c.leagueId === 71)?.countryName).toBe('Brazil');
    expect(
      comps.find((c) => c.leagueId === 13)?.seasons.find((s) => s.year === 2024)?.coverage?.injuries,
    ).toBe(false);
  });

  it('bootstrap:seasons para na cota, grava ops.sync_cursor e ops.job_run e retoma no dia seguinte', async () => {
    clock.t += DAY;
    const h = pg(db, FREE_PLAN, 30); // 25 chamadas/dia num dia sem ao vivo
    const job = () => seasonsJob(catalog(), h.deps.raw, h.deps.plan, now);
    const plan = await planJob(job(), h.deps);
    expect(plan.totals.network).toBe(62);

    const statuses: string[] = [];
    for (let day = 0; day < 4; day++) {
      await h.dayWithoutLive();
      const r = await runJob(job(), h.deps);
      statuses.push(r.status);
      if (r.status === 'ok') break;
      clock.t += DAY;
    }
    expect(statuses).toEqual(['partial', 'partial', 'ok']);
    expect(h.api.calls).toHaveLength(62);

    const [cursors] = await db
      .select({ n: count() })
      .from(syncCursor)
      .where(eq(syncCursor.sport, 'football'));
    expect(cursors!.n).toBe(62);
    const [fixtures] = await db
      .select({ n: count() })
      .from(syncCursor)
      .where(and(eq(syncCursor.endpoint, '/fixtures'), like(syncCursor.key, 'league=%')));
    expect(fixtures!.n).toBe(8);
    const runs = await db.select().from(jobRun).where(eq(jobRun.job, 'bootstrap:seasons'));
    expect(runs.map((r) => r.status).sort()).toEqual(['ok', 'partial', 'partial']);
    expect(runs.reduce((a, r) => a + r.callsSpent, 0)).toBe(62);

    const again = await planJob(job(), h.deps);
    expect(again.totals).toMatchObject({ network: 0, done: 62 });
  });

  it('bootstrap:details lê as partidas do raw no Postgres e detalha em lotes de 20 (Pro)', async () => {
    clock.t += DAY;
    const h = pg(db, PRO_PLAN);
    const job = detailsJob(
      catalog(),
      h.deps.raw,
      h.deps.cursors,
      h.deps.plan,
      async () => new Set(['121-131']),
    );
    const r = await runJob(job, h.deps);
    // listas 2022–2024 no raw: Série A 36 + Libertadores 24 + Série B 36 = 96 encerradas → 5 lotes
    expect(r).toMatchObject({ status: 'ok', callsSpent: 5 });
    expect(h.api.calls.every((u) => u.searchParams.has('ids'))).toBe(true);
    const [detailed] = await db
      .select({ n: count() })
      .from(syncCursor)
      .where(and(eq(syncCursor.endpoint, '/fixtures'), like(syncCursor.key, 'id=%')));
    expect(detailed!.n).toBe(96);
  });

  it('sync:daily é seguro para reexecutar no mesmo dia', async () => {
    clock.t = Date.parse(NOW) + 5 * DAY; // 26/10: agenda de 25, 26 e 27
    const h = pg(db, FREE_PLAN);
    const job = () =>
      dailyJob(catalog(), h.deps.raw, h.deps.cursors, h.deps.plan, now, async () => new Set());
    const r1 = await runJob(job(), h.deps);
    expect(r1.status).toBe('ok');
    expect(r1.phases[0]!.steps['fixtures-data']!.network).toBe(3);
    expect(r1.phases[1]!.steps.detalhe!.network).toBe(3); // 25/10: Série A, Libertadores, Série B
    expect(r1.phases[2]!.steps.squads!.network).toBe(5); // rodízio do free: 5 por dia
    const r2 = await runJob(job(), h.deps);
    expect(r2.callsSpent).toBe(0);
  });

  it('snapshot: exporta, restaura em outro banco e o ambiente local roda sem chave (zero chamadas)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snapshot-'));
    const file = join(dir, 'raw.ndjson.gz');
    try {
      const [rawCount] = await db.select({ n: count() }).from(apiResponse);
      const [assetCount] = await db.select({ n: count() }).from(asset);
      // o /leagues buscado de novo pelo sync diário veio idêntico: mesmo request_hash + body_hash
      const [distinct] = await db
        .select({
          n: sql<number>`count(distinct (${apiResponse.requestHash}, ${apiResponse.bodyHash}))::int`,
        })
        .from(apiResponse);
      const exported = await exportRawSnapshot(db, file);
      expect(exported).toMatchObject({ raw: rawCount!.n, assets: assetCount!.n });

      const first = await importRawSnapshot(restored, file);
      expect(first).toMatchObject({ raw: rawCount!.n, imported: distinct!.n, assets: assetCount!.n });
      const second = await importRawSnapshot(restored, file);
      expect(second).toMatchObject({ imported: 0, duplicates: rawCount!.n });
      const [restoredRaw] = await restored.select({ n: count() }).from(apiResponse);
      expect(restoredRaw!.n).toBe(distinct!.n);
      const [restoredAssets] = await restored.select({ n: count() }).from(asset);
      expect(restoredAssets!.n).toBe(assetCount!.n);

      // sem APISPORTS_KEY: o catálogo é reprocessado do raw restaurado e as listas saem do cache
      const off = pg(restored, FREE_PLAN, 100, true);
      await runFootballCatalogJob(restored, off.deps.client, fakeCatalogConfig());
      expect((await restored.select().from(competition)).length).toBe(4);
      expect((await restored.select().from(season)).length).toBeGreaterThan(0);
      const r = await runJob(
        seasonsJob(new PgCatalogSource(restored), off.deps.raw, off.deps.plan, now),
        off.deps,
      );
      expect(r.callsSpent).toBe(0);
      expect(r.totals.cache).toBe(62);
      expect(off.api.calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
