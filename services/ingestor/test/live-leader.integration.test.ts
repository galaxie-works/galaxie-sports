/**
 * Líder e reserva do ao vivo (#536) contra o Postgres descartável: duas cópias do runner com a trava real
 * (`live:leader`), Governor, raw e core no Postgres e um fornecedor falso. O relógio do jogo é simulado (os ticks
 * correm em milissegundos); a eleição usa o tempo real, porque é ele que o critério "assume em menos de 2 s" mede.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultPolicy, PgQuotaGovernor, PgRawStore } from '@galaxie/apisports-client';
import {
  changeFeed,
  competition,
  jobLockContender,
  jobRun,
  sport,
  syncCursor,
  type Database,
} from '@galaxie/db';
import { ApiSportsProvider, normalizeFixtures, type ProviderResult } from '@galaxie/providers';
import { PgJobRunStore } from '../src/jobs/runtime/job-run-store.js';
import { LIVE_HANDOFF_KEY, PgLiveHandoffStore } from '../src/live/handoff.js';
import { LIVE_LEADER_LOCK, liveLeaderSessionName, runLiveLeadership } from '../src/live/leader.js';
import {
  LiveRunner,
  systemLiveClock,
  type LiveRunnerOptions,
  type LiveRunSummary,
} from '../src/live/runner.js';
import { LIVE_STATE_ENDPOINT } from '../src/live/state.js';
import { PgLiveStore } from '../src/live/store.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';
import { apiFixture, liveWorld, wednesdayNight, type WorldMatch } from '../src/testing/live-world.js';
import { disposableDb } from './db.js';

const MIN = 60_000;
const DAY = 86_400_000;
const RETRY_MS = 1_000;
const disposable = disposableDb();
let db: Database;
let admin: postgres.Sql;

/** A noite do Brasileirão em outro dia e com outros IDs, para cada cenário ter os próprios jogos e cota. */
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

const teamIds = new Map<string, number>();
const teamId = (name: string) => {
  if (!teamIds.has(name)) teamIds.set(name, 1000 + teamIds.size);
  return teamIds.get(name)!;
};

class CountingProvider extends ApiSportsProvider {
  calls = 0;
  firstCallAt: number | null = null;
  beforeCall: ((n: number) => Promise<void>) | undefined;

  private async count(): Promise<void> {
    this.calls += 1;
    this.firstCallAt ??= Date.now();
    await this.beforeCall?.(this.calls);
  }

  override async listLive(...args: Parameters<ApiSportsProvider['listLive']>): Promise<ProviderResult> {
    await this.count();
    return super.listLive(...args);
  }

  override async getEventDetail(
    ...args: Parameters<ApiSportsProvider['getEventDetail']>
  ): Promise<ProviderResult> {
    await this.count();
    return super.getEventDetail(...args);
  }
}

type World = ReturnType<typeof liveWorld>;

/** Uma cópia do `live-run`: a própria conexão de trava, o próprio runner, o mesmo banco. */
function copy(name: string, world: World, options: Partial<LiveRunnerOptions>) {
  const lock = jobLockContender(disposable.url, LIVE_LEADER_LOCK, {
    applicationName: liveLeaderSessionName(name),
  });
  const provider = new CountingProvider(
    world.client,
    { priority: 'LIVE' },
    () => new Date(world.clock.now()),
  );
  const controller = new AbortController();
  const terms: LiveRunSummary[] = [];
  const state = { acquiredAt: null as number | null, releasedAt: null as number | null, lost: false };
  const done = runLiveLeadership(
    {
      lock: {
        tryAcquire: async (o) => {
          const held = await lock.tryAcquire({
            onLost: () => {
              state.lost = true;
              o?.onLost?.();
            },
          });
          if (!held) return null;
          state.acquiredAt = Date.now();
          return {
            release: async () => {
              await held.release();
              state.releasedAt = Date.now();
            },
          };
        },
      },
      instance: name,
      retryMs: RETRY_MS,
      clock: systemLiveClock,
      term: async (signal, fence) => {
        const summary = await new LiveRunner({
          sport: 'football',
          provider,
          store: new PgLiveStore(db),
          governor: world.governor,
          clock: world.clock,
          handoff: new PgLiveHandoffStore(db),
          options: { idleExitMs: null, ...options },
        }).run(signal, fence);
        terms.push(summary);
        return summary;
      },
    },
    controller.signal,
  ).finally(() => lock.close());
  return { name, provider, controller, terms, state, done };
}

const waitFor = async (what: string, ok: () => boolean, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`esperando ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Mundo sobre o Postgres de teste, a partir de `start`, com o core semeado como o sync diário deixaria. */
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
  // o handoff do cenário anterior é de outro dia: cada cenário começa sem bastão
  await db
    .delete(syncCursor)
    .where(and(eq(syncCursor.endpoint, LIVE_STATE_ENDPOINT), eq(syncCursor.key, LIVE_HANDOFF_KEY)));
  const world = liveWorld({
    matches,
    plan: 'free',
    start,
    rawStore: new PgRawStore(db),
    governor: (now) => new PgQuotaGovernor(db, () => defaultPolicy(100, 15), now),
  });
  for (const [name, id] of teamIds)
    if (world.teamIds(name) !== id) throw new Error('ids de time divergentes');
  return world;
}

/** Gols e encerramentos publicados no change feed, por jogo e placar: repetido aparece com contagem > 1. */
async function feedOf(matches: WorldMatch[]) {
  const ids = new Set(matches.map((m) => String(m.fixtureId)));
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
  const key = (p: (typeof payloads)[number]) => `${p.providerEventId}:${p.score.home}-${p.score.away}`;
  return {
    goals: payloads.filter((p) => p.goal).map(key),
    finished: payloads.filter((p) => p.finished).map((p) => p.providerEventId),
  };
}

function expectNoRepeat(world: World, matches: WorldMatch[], feed: Awaited<ReturnType<typeof feedOf>>): void {
  // cada gol publicado uma única vez, atravessando a troca
  expect(new Set(feed.goals).size).toBe(feed.goals.length);
  expect(feed.goals).toHaveLength(matches.reduce((n, m) => n + m.goals.length, 0));
  expect([...feed.finished].sort()).toEqual(matches.map((m) => String(m.fixtureId)).sort());
  // nenhuma chamada do live a menos de 15 s da anterior, inclusive na passagem de bastão
  const live = world.requests.filter((r) => r.params.live).map((r) => r.at.getTime());
  for (const [i, at] of live.entries()) if (i > 0) expect(at - live[i - 1]!).toBeGreaterThanOrEqual(15_000);
}

beforeAll(async () => {
  db = await disposable.setup();
  admin = postgres(disposable.url, { max: 1, onnotice: () => {} });
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
}, 60_000);

afterAll(async () => {
  await admin?.end({ timeout: 5 });
  await disposable.teardown();
});

describe('trava live:leader (conexão fixa da disputa)', () => {
  const leadersQuery = `
    select a.application_name, l.pid is not null as lider
      from pg_stat_activity a
      left join pg_locks l on l.pid = a.pid and l.locktype = 'advisory' and l.granted
     where a.application_name like 'galaxie-live-leader:%'
     order by 1`;

  it('uma só líder; a consulta do README mostra quem é; soltar passa a vez sem abrir conexão nova', async () => {
    const a = jobLockContender(disposable.url, LIVE_LEADER_LOCK, {
      applicationName: liveLeaderSessionName('a'),
    });
    const b = jobLockContender(disposable.url, LIVE_LEADER_LOCK, {
      applicationName: liveLeaderSessionName('b'),
    });
    try {
      const held = await a.tryAcquire();
      expect(held).not.toBeNull();
      expect(await b.tryAcquire()).toBeNull();
      expect(await admin.unsafe(leadersQuery)).toEqual([
        { application_name: 'galaxie-live-leader:a', lider: true },
        { application_name: 'galaxie-live-leader:b', lider: false },
      ]);
      const pidsBefore = await admin.unsafe(
        `select pid from pg_stat_activity where application_name like 'galaxie-live-leader:%' order by pid`,
      );
      await held!.release();
      const next = await b.tryAcquire();
      expect(next).not.toBeNull();
      const pidsAfter = await admin.unsafe(
        `select pid from pg_stat_activity where application_name like 'galaxie-live-leader:%' order by pid`,
      );
      expect(pidsAfter).toEqual(pidsBefore);
      await next!.release();
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('conexão caiu com a trava: avisa uma vez; em espera: reconecta sem avisar ninguém', async () => {
    const a = jobLockContender(disposable.url, LIVE_LEADER_LOCK, {
      applicationName: liveLeaderSessionName('a'),
    });
    const b = jobLockContender(disposable.url, LIVE_LEADER_LOCK, {
      applicationName: liveLeaderSessionName('b'),
    });
    try {
      let lost = 0;
      const held = await a.tryAcquire({ onLost: () => (lost += 1) });
      expect(await b.tryAcquire()).toBeNull();
      const terminate = (name: string) =>
        admin.unsafe(
          `select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${liveLeaderSessionName(name)}'`,
        );

      // a reserva perde a conexão: nada de "perdeu a trava", e a tentativa seguinte reconecta (a que pegar a queda
      // no meio falha, e o laço da eleição só tenta de novo)
      await terminate('b');
      const retried = async () => {
        for (;;) {
          try {
            return await b.tryAcquire();
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
      };
      expect(await retried()).toBeNull();
      expect(lost).toBe(0);

      await terminate('a');
      await waitFor('o aviso de perda', () => lost === 1);
      const next = await retried();
      expect(next).not.toBeNull();
      await next!.release();
      await held!.release(); // perdida: soltar não faz nada e não lança
      expect(lost).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe('líder e reserva no Postgres', () => {
  it('SIGTERM na líder: tick terminado, trava solta, reserva assume em < 2 s sem chamada repetida', async () => {
    const matches = night(1);
    const kick = matches[0]!.kickoff.getTime();
    const world = await scenario(matches, new Date(kick + 5 * MIN));
    const end = new Date(kick + 3 * 60 * MIN);

    const a = copy('a', world, { until: end });
    await waitFor('a primeira líder', () => a.provider.calls >= 1);
    const b = copy('b', world, { until: end });

    let reserveCallsWhileLeader = -1;
    a.provider.beforeCall = async (n) => {
      // no meio de um tick, com a reserva já disputando a trava: o SIGTERM não corta esse tick
      if (n === 4) {
        reserveCallsWhileLeader = b.provider.calls;
        a.controller.abort();
      }
    };

    const summaryA = await a.done;
    expect(summaryA).toMatchObject({ stoppedBy: 'aborted' });
    expect(reserveCallsWhileLeader).toBe(0);
    // o tick em que o sinal chegou contou
    expect(a.terms[0]!.ticks).toBe(a.provider.calls);

    await waitFor('a reserva assumir', () => b.provider.firstCallAt !== null);
    expect(b.state.acquiredAt! - a.state.releasedAt!).toBeLessThan(2_000);
    expect(b.provider.firstCallAt! - a.state.releasedAt!).toBeLessThan(2_000);

    const summaryB = await b.done;
    expect(summaryB).toMatchObject({ stoppedBy: 'until' });
    // sem tick perdido: o primeiro da nova líder vem no intervalo normal depois do último da antiga, e não antes
    const [plan] = [...summaryB!.plans.values()];
    const firstGap = summaryB!.gaps[0]!;
    expect(firstGap).toBeGreaterThanOrEqual(15_000);
    expect(firstGap).toBeLessThanOrEqual(plan!.baseIntervalMs * 1.1);

    // toda chamada no fornecedor foi feita por uma das duas, uma vez só
    expect(world.requests).toHaveLength(a.provider.calls + b.provider.calls);
    expectNoRepeat(world, matches, await feedOf(matches));
  }, 90_000);

  it('líder morta sem aviso (conexão da trava cai): reserva assume em < 2 s e o diff não repete evento', async () => {
    const matches = night(2);
    const kick = matches[0]!.kickoff.getTime();
    const world = await scenario(matches, new Date(kick + 5 * MIN));
    const end = new Date(kick + 3 * 60 * MIN);

    const a = copy('a', world, { until: end });
    await waitFor('a primeira líder', () => a.provider.calls >= 1);
    const b = copy('b', world, { until: end });

    let killedAt = 0;
    a.provider.beforeCall = async (n) => {
      if (n !== 4) return;
      // o processo morreu com a chamada saindo: o Postgres fecha a sessão e a resposta nunca chega
      killedAt = Date.now();
      a.controller.abort();
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${liveLeaderSessionName('a')}'`,
      );
      await waitFor('a queda da trava', () => a.state.lost);
      throw new Error('processo morto');
    };

    await waitFor('a reserva assumir', () => b.provider.firstCallAt !== null);
    expect(b.provider.firstCallAt! - killedAt).toBeLessThan(2_000);

    const summaryA = await a.done;
    expect(summaryA).toMatchObject({ stoppedBy: 'lost' });
    // a chamada que estava no ar não contou tick nem gravou nada
    expect(a.terms[0]!.ticks).toBe(3);

    const summaryB = await b.done;
    expect(summaryB).toMatchObject({ stoppedBy: 'until' });
    expect(summaryB!.gaps[0]).toBeGreaterThanOrEqual(15_000);
    expect(world.requests).toHaveLength(a.provider.calls - 1 + b.provider.calls);
    expectNoRepeat(world, matches, await feedOf(matches));
  }, 90_000);

  it('execução aberta por uma líder que morreu é fechada pela seguinte; as outras ficam como estão', async () => {
    const runs = new PgJobRunStore(db);
    const orphan = await runs.start('live:run');
    const other = await runs.start('outro:job');
    expect(await runs.closeInterrupted('live:run', 'interrompido')).toBe(1);
    const rows = await db
      .select()
      .from(jobRun)
      .where(inArray(jobRun.id, [orphan, other]));
    expect(rows.find((r) => r.id === orphan)).toMatchObject({ status: 'error', error: 'interrompido' });
    expect(rows.find((r) => r.id === other)).toMatchObject({ status: 'running' });
    await runs.finish(other, { status: 'ok', callsSpent: 0, stats: {} });
  });

  it('o plano do dia e o ticksLeft vêm do Postgres: a reserva enxerga o orçamento gasto pela líder', async () => {
    const matches = night(3);
    const kick = matches[0]!.kickoff.getTime();
    const world = await scenario(matches, new Date(kick + 5 * MIN));
    const runner = () =>
      new LiveRunner({
        sport: 'football',
        provider: new ApiSportsProvider(
          world.client,
          { priority: 'LIVE' },
          () => new Date(world.clock.now()),
        ),
        store: new PgLiveStore(db),
        governor: world.governor,
        clock: world.clock,
        handoff: new PgLiveHandoffStore(db),
        options: { idleExitMs: null, maxTicks: 3 },
      });

    const now = new Date(world.clock.now());
    const before = (await runner().plan(now)).plan.budget;
    expect(before.liveUsed).toBe(0);
    await runner().run();
    const later = new Date(world.clock.now());
    const [leader, reserve] = await Promise.all([runner().plan(later), runner().plan(later)]);
    expect(reserve.plan.budget).toEqual(leader.plan.budget);
    expect(reserve.plan.budget.liveUsed).toBe(3);
    expect(reserve.plan.budget.ticksLeft).toBeLessThan(before.ticksLeft);
  });
});
