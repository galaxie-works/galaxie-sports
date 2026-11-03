/**
 * Perfil `live` do scheduler (#535) contra o Postgres descartável: duas cópias do scheduler (como duas cópias do serviço
 * `live`) com a agenda de `jobsForProfile('live')`, a trava de verdade e o registro em ops.job_run. O `live-run` de cada
 * cópia roda no processo do teste, com a eleição de verdade (`runLiveLeadership`, trava `live:leader`, época) e o
 * fornecedor falso dos testes do #570 (`liveWorld`); o relógio do jogo é simulado. O `events-clock` roda como processo
 * filho, o CLI compilado de verdade. Por último, o scheduler do perfil conectado como o papel `galaxie_live` (prefixo
 * aleatório): relato ao painel, "rodar agora" e registro das execuções com os GRANTs do papel.
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultPolicy, PgQuotaGovernor, PgRawStore } from '@galaxie/apisports-client';
import { upsertBatch } from '@galaxie/core-writer';
import {
  applyRoles,
  changeFeed,
  closeDb,
  competition,
  createDb,
  jobLockContender,
  jobRequest,
  jobRun,
  roleName,
  runtimeEnv,
  sport,
  syncCursor,
  tryJobLock,
  type Database,
} from '@galaxie/db';
import { createLogger } from '@galaxie/observability';
import { ApiSportsProvider, normalizeFixtures } from '@galaxie/providers';
import {
  closeOrphans,
  jobLockName,
  PgRunRecorder,
  runJob,
  SchedulerService,
  type RunResult,
  type ScheduledJob,
} from '@galaxie/scheduler';
import { LIVE_HANDOFF_KEY, PgLiveHandoffStore } from '../src/live/handoff.js';
import { LIVE_LEADER_LOCK, liveLeaderSessionName, runLiveLeadership } from '../src/live/leader.js';
import { claimLiveLeaderEpoch, LIVE_LEADER_EPOCH_ENDPOINT } from '../src/live/leader-epoch.js';
import { LiveRunner, systemLiveClock } from '../src/live/runner.js';
import { LIVE_STATE_ENDPOINT } from '../src/live/state.js';
import { PgLiveStore } from '../src/live/store.js';
import { jobsForProfile } from '../src/scheduler/schedule.js';
import { apiFixture, liveWorld, wednesdayNight, type WorldMatch } from '../src/testing/live-world.js';
import { disposableDb } from './db.js';

const MIN = 60_000;
const DAY = 86_400_000;
const disposable = disposableDb();
const logger = createLogger({ service: 'test', level: 'silent' });
const ingestorRoot = fileURLToPath(new URL('../', import.meta.url));
let db: Database;
let admin: postgres.Sql;

const teamIds = new Map<string, number>();
const teamId = (name: string) => {
  if (!teamIds.has(name)) teamIds.set(name, 2000 + teamIds.size);
  return teamIds.get(name)!;
};

/** Dois jogos do Brasileirão da noite de teste, em outro dia (cota e IDs próprios). */
function night(dayOffset: number): WorldMatch[] {
  return wednesdayNight()
    .filter((m) => m.leagueId === 71)
    .slice(0, 2)
    .map((m) => ({
      ...m,
      fixtureId: m.fixtureId + dayOffset * 1000,
      kickoff: new Date(m.kickoff.getTime() + dayOffset * DAY),
    }));
}

async function scenario(matches: WorldMatch[], start: Date) {
  const seededAt = new Date(start.getTime() - 3 * 3_600_000);
  await upsertBatch(
    db,
    normalizeFixtures(
      matches.map((m) => apiFixture(m, seededAt, teamId)),
      seededAt,
    ),
  );
  await db.update(competition).set({ tier: 1, livePriority: 'high' });
  await db
    .delete(syncCursor)
    .where(and(eq(syncCursor.endpoint, LIVE_STATE_ENDPOINT), eq(syncCursor.key, LIVE_HANDOFF_KEY)));
  return liveWorld({
    matches,
    plan: 'free',
    start,
    rawStore: new PgRawStore(db),
    governor: (now) => new PgQuotaGovernor(db, () => defaultPolicy(100, 15), now),
  });
}

const waitFor = async (what: string, ok: () => boolean | Promise<boolean>, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > deadline) throw new Error(`esperando ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const result = (job: string, status: RunResult['status'], runId?: string): RunResult => ({
  job,
  runId,
  status,
  exitCode: status === 'ok' ? 0 : null,
  signal: null,
  timedOut: false,
  durationMs: 0,
});

/**
 * Uma cópia do serviço `live`: o scheduler no perfil `live`, com a trava e o registro de verdade. O `live-run` é o
 * mandato do #570 no processo do teste (trava por cópia, linha em ops.job_run com a cópia, eleição, ticks); o resto é
 * o `runJob` de sempre, num processo filho.
 */
function liveCopy(instance: string, world: ReturnType<typeof liveWorld>, until: Date) {
  const recorder = new PgRunRecorder(db);
  const lock = (name: string) => tryJobLock(disposable.url, name);
  const stop = new AbortController();
  let calls = 0;
  const leaderRun = async (job: ScheduledJob): Promise<RunResult> => {
    const held = await lock(jobLockName(job, instance));
    if (!held) return result(job.name, 'skipped');
    const runId = await recorder.start(job.name, { instance });
    const contender = jobLockContender(disposable.url, LIVE_LEADER_LOCK, {
      applicationName: liveLeaderSessionName(instance),
    });
    const provider = new ApiSportsProvider(
      world.client,
      { priority: 'LIVE' },
      () => new Date(world.clock.now()),
    );
    const counted = new Proxy(provider, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver) as unknown;
        if ((prop === 'listLive' || prop === 'getEventDetail') && typeof v === 'function')
          return (...args: unknown[]) => {
            calls += 1;
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        return v;
      },
    });
    try {
      await runLiveLeadership(
        {
          lock: contender,
          instance,
          retryMs: 200,
          clock: systemLiveClock,
          claimEpoch: () => claimLiveLeaderEpoch(db, 'football', instance),
          term: (signal, fence, epoch) => {
            const leaderEpoch = { sport: 'football', epoch };
            return new LiveRunner({
              sport: 'football',
              provider: counted,
              store: new PgLiveStore(db, { leaderEpoch }),
              governor: world.governor,
              clock: world.clock,
              handoff: new PgLiveHandoffStore(db, 'api-sports', leaderEpoch),
              options: { idleExitMs: null, until },
            }).run(signal, fence);
          },
        },
        stop.signal,
      );
      await recorder.finish(runId, 'ok', null, {});
      return result(job.name, 'ok', runId);
    } finally {
      await contender.close();
      await held.release();
    }
  };
  const service = new SchedulerService({
    profile: 'live',
    jobs: jobsForProfile('live', {}),
    // cron do relógio e da reconciliação fora do teste: aqui só o job que fica no ar
    env: { SCHEDULE_LIVE_RECONCILE: 'off', SCHEDULE_EVENTS_CLOCK: 'off' },
    log: logger,
    keepAliveDelayMs: 100,
    keepAliveMaxDelayMs: 400,
    run: (job, { trigger, env }) =>
      job.keepAlive
        ? leaderRun(job)
        : runJob(job, {
            cwd: ingestorRoot,
            env: { ...env, DATABASE_URL: disposable.url, SCHEDULER_PROFILE: 'live', LOG_LEVEL: 'silent' },
            recorder,
            logger,
            trigger,
            lock,
            instance,
          }),
  });
  return {
    instance,
    service,
    calls: () => calls,
    stop: async () => {
      const running = service.stop();
      stop.abort();
      await Promise.allSettled(running);
    },
  };
}

beforeAll(async () => {
  db = await disposable.setup();
  admin = postgres(disposable.url, { max: 1, onnotice: () => {} });
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
}, 60_000);

const rolePrefix = `t${randomBytes(4).toString('hex')}_`;

afterAll(async () => {
  await admin?.end({ timeout: 5 });
  await disposable.teardown();
  // os papéis são do cluster: saem depois do banco descartável (o único onde têm GRANTs)
  const cluster = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const roles = await cluster<
      { rolname: string }[]
    >`select rolname from pg_roles where rolname like ${`${rolePrefix}%`}`;
    for (const r of roles) await cluster.unsafe(`drop role if exists "${r.rolname}"`);
  } finally {
    await cluster.end({ timeout: 5 });
  }
});

describe('perfil live com duas cópias do scheduler', () => {
  it('as duas sobem o live-run (sem a trava por job), uma lidera e tica, e cada gol sai uma vez', async () => {
    const matches = night(11);
    const kick = matches[0]!.kickoff.getTime();
    const world = await scenario(matches, new Date(kick + 5 * MIN));
    const until = new Date(kick + 3 * 60 * MIN);
    const a = liveCopy('copia-a', world, until);
    const b = liveCopy('copia-b', world, until);
    try {
      await a.service.start();
      await b.service.start();
      expect(a.service.keptAlive()).toEqual(['live-run']);
      expect(a.service.activeCrons()).toEqual([]);

      // as duas cópias rodam o live-run ao mesmo tempo: a trava é por cópia (live-run@<cópia>)
      await waitFor('o live-run das duas cópias', async () => {
        const rows = await db
          .select({ instance: sql<string>`${jobRun.stats} ->> 'instance'` })
          .from(jobRun)
          .where(eq(jobRun.job, 'live-run'));
        return new Set(rows.map((r) => r.instance)).size === 2;
      });

      // uma líder por vez: só uma sessão `galaxie-live-leader:` segura a trava
      const leaders = await admin.unsafe<{ application_name: string; lider: boolean }[]>(`
        select a.application_name, l.pid is not null as lider
          from pg_stat_activity a
          left join pg_locks l on l.pid = a.pid and l.locktype = 'advisory' and l.granted
         where a.application_name like 'galaxie-live-leader:%'`);
      expect(leaders.filter((l) => l.lider).length).toBeLessThanOrEqual(1);

      // tica: os jogos andam até o fim, com cada gol e cada encerramento publicados uma vez só
      const ids = new Set(matches.map((m) => String(m.fixtureId)));
      const goalsTotal = matches.reduce((n, m) => n + m.goals.length, 0);
      const feed = async () => {
        const rows = await db
          .select({ payload: changeFeed.payload })
          .from(changeFeed)
          .where(eq(changeFeed.topic, 'live'))
          .orderBy(asc(changeFeed.id));
        const payloads = rows
          .map(
            (r) =>
              r.payload as {
                goal: boolean;
                finished: boolean;
                providerEventId: string;
                score: { home: number; away: number };
              },
          )
          .filter((p) => ids.has(p.providerEventId));
        return {
          goals: payloads
            .filter((p) => p.goal)
            .map((p) => `${p.providerEventId}:${p.score.home}-${p.score.away}`),
          finished: payloads.filter((p) => p.finished).map((p) => p.providerEventId),
        };
      };
      await waitFor(
        'os jogos chegarem ao fim',
        async () => (await feed()).finished.length === matches.length,
        60_000,
      );
      const f = await feed();
      expect(f.goals).toHaveLength(goalsTotal);
      expect(new Set(f.goals).size).toBe(goalsTotal);
      expect(a.calls() + b.calls()).toBe(world.requests.length);
      expect(a.calls() + b.calls()).toBeGreaterThan(0);

      // o mandato está gravado com a cópia que o abriu
      const [epoch] = await db
        .select({ cursor: syncCursor.cursor })
        .from(syncCursor)
        .where(eq(syncCursor.endpoint, LIVE_LEADER_EPOCH_ENDPOINT));
      expect(['copia-a', 'copia-b']).toContain((epoch!.cursor as { instance: string }).instance);
    } finally {
      await a.stop();
      await b.stop();
    }
    // no encerramento o live-run fecha como ok e não volta
    const open = await db
      .select({ id: jobRun.id })
      .from(jobRun)
      .where(and(eq(jobRun.job, 'live-run'), eq(jobRun.status, 'running')));
    expect(open).toHaveLength(0);
  }, 120_000);

  it('o relógio dos eventos, pedido nas duas cópias no mesmo minuto, roda numa só (trava por job)', async () => {
    const world = await scenario(night(12), new Date(Date.now()));
    const until = new Date(world.clock.now());
    const a = liveCopy('copia-a', world, until);
    const b = liveCopy('copia-b', world, until);
    try {
      const [ra, rb] = await Promise.all([
        a.service.execute('events-clock', 'manual'),
        b.service.execute('events-clock', 'manual'),
      ]);
      expect([ra.status, rb.status].sort()).toEqual(['ok', 'skipped']);
    } finally {
      await a.stop();
      await b.stop();
    }
  }, 60_000);

  it('na partida, a execução running de uma cópia que caiu fecha; a de uma cópia viva fica', async () => {
    const bootedAt = new Date();
    const before = new Date(bootedAt.getTime() - 5 * MIN);
    const [dead] = await db
      .insert(jobRun)
      .values({ job: 'live-run', status: 'running', startedAt: before, stats: { instance: 'morta' } })
      .returning();
    const [alive] = await db
      .insert(jobRun)
      .values({ job: 'live-run', status: 'running', startedAt: before, stats: { instance: 'viva' } })
      .returning();
    const held = await tryJobLock(disposable.url, 'live-run@viva');
    try {
      const report = await closeOrphans(db, ['live-run'], {
        bootedAt,
        lock: (name) => tryJobLock(disposable.url, name),
      });
      expect(report).toEqual({ runs: 1, requests: 0, busy: ['live-run'] });
    } finally {
      await held?.release();
    }
    const [d] = await db.select().from(jobRun).where(eq(jobRun.id, dead!.id));
    expect(d).toMatchObject({ status: 'error', stats: { instance: 'morta', interrupted: true } });
    const [v] = await db.select().from(jobRun).where(eq(jobRun.id, alive!.id));
    expect(v?.status).toBe('running');
  });

  it('com o papel galaxie_live, o scheduler do perfil relata ao painel, atende o "rodar agora" e registra as execuções', async () => {
    const password = randomBytes(18).toString('hex');
    await applyRoles(disposable.url, { prefix: rolePrefix, passwords: { live: password } });
    const url = new URL(disposable.url);
    url.username = roleName('live', rolePrefix);
    url.password = password;
    const liveUrl = url.toString();
    const liveDb = createDb(liveUrl, { max: 2, profile: 'live' });
    const ran: string[] = [];
    const service = new SchedulerService({
      profile: 'live',
      jobs: jobsForProfile('live', {}),
      env: { SCHEDULE_LIVE_RUN: 'off' },
      db: liveDb,
      log: logger,
      run: async (job, { trigger }) => {
        ran.push(`${job.name}:${trigger}`);
        // o mesmo caminho do runJob: trava do job e linha em ops.job_run, como o papel
        const held = await tryJobLock(liveUrl, job.name);
        const recorder = new PgRunRecorder(liveDb);
        const runId = await recorder.start(job.name);
        await recorder.finish(runId, 'ok', null, { trigger });
        await held?.release();
        return result(job.name, 'ok', runId);
      },
    });
    try {
      const [req] = await db
        .insert(jobRequest)
        .values({ job: 'events-clock', requestedBy: 'teste' })
        .returning({ id: jobRequest.id });
      await service.start();
      await waitFor('o pedido do painel', async () => {
        const [r] = await db.select().from(jobRequest).where(eq(jobRequest.id, req!.id));
        return r?.status === 'done';
      });
      expect(ran).toContain('events-clock:panel');
      const reported = await db
        .select({ key: runtimeEnv.key })
        .from(runtimeEnv)
        .where(eq(runtimeEnv.service, 'live'));
      expect(reported.map((r) => r.key)).toEqual(
        expect.arrayContaining(['LIVE_FEATURED', 'SCHEDULE_LIVE_RUN']),
      );
      // o mandato do ao vivo também é escrita do papel
      expect(await claimLiveLeaderEpoch(liveDb, 'football', 'copia-papel')).toBeGreaterThan(0);
    } finally {
      await Promise.allSettled(service.stop());
      await closeDb(liveDb);
    }
  }, 60_000);
});
