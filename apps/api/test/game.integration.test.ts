import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, event, runMigrations, sport, type Database } from '@galaxie/db';
import { INITIAL_CATALOG, LEVELS } from '@galaxie/game-rules';
import { eq, sql } from 'drizzle-orm';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { eraseFan } from '../src/engage/fans.js';
import { GameScorer } from '../src/game/scorer.js';
import { buildServer } from '../src/server.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const ADMIN_KEY = generateAdminKey();

let pg: postgres.Sql;
let db: Database;
let app: FastifyInstance;
let scorer: GameScorer;
let clock = Date.now();

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  app = buildServer({
    db,
    keyPrefix: `gs-test-${randomBytes(4).toString('hex')}:`,
    usagePersist: false,
    moduleUsage: false,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: new FanTokenSigner({ secret: 's'.repeat(48) }),
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
  });
  await app.ready();
  // o relógio do pontuador anda à mão: a janela de correção conta da última mudança do jogo
  scorer = new GameScorer(db, { now: () => clock, correctionWindowMs: 60_000, throttleMs: 0 });
  await db
    .insert(sport)
    .values([
      { slug: 'football', name: { 'pt-BR': 'Futebol' } },
      { slug: 'mma', name: { 'pt-BR': 'MMA' } },
    ])
    .onConflictDoNothing();
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

async function tenantKey(slug: string, modules: string[]): Promise<{ id: string; key: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/internal/admin/tenants',
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    payload: { slug, name: slug, plan: 'enterprise', modules },
  });
  expect(res.statusCode).toBe(201);
  return { id: res.json().tenant.id, key: res.json().key.key };
}

let n = 0;
const fan = async (key: string, ageBand = '18plus') => {
  n += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fans/tokens',
    headers: { 'x-galaxie-key': key },
    payload: {
      externalAccountId: `acc_${n}`,
      externalProfileId: `prof_${n}`,
      nickname: `Torcedor${n}`,
      ageBand,
      country: 'br',
      locale: 'pt-BR',
      ageAssurance: { method: 'estimated', at: '2026-11-01' },
      // menor no Brasil participa com a autorização e a conta vinculada do responsável (ficha do país)
      ...(ageBand === '13_17' ? { guardian: { status: 'granted', linkedAccount: true } } : {}),
    },
  });
  expect(res.statusCode).toBe(201);
  return { token: res.json().data.token as string, account: `acc_${n}`, profile: `prof_${n}` };
};

const game = async (opts: { sport?: string; startsInMin?: number } = {}) => {
  const [row] = await db
    .insert(event)
    .values({
      sport: opts.sport ?? 'football',
      startsAt: new Date(Date.now() + (opts.startsInMin ?? 60) * 60_000),
      endsAtExpected: new Date(Date.now() + 180 * 60_000),
      status: 'scheduled',
    })
    .returning({ id: event.id });
  return row!.id;
};

const setEvent = (id: string, set: Partial<typeof event.$inferInsert>) =>
  db
    .update(event)
    .set({ ...set, updatedAt: sql`now()` as never })
    .where(eq(event.id, id));

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const put = (token: string, eventId: string, predictions: unknown[]) =>
  app.inject({
    method: 'PUT',
    url: `/v1/predictions/${eventId}`,
    headers: auth(token),
    payload: { predictions },
  });
const open = (token: string, eventId: string) =>
  app.inject({ method: 'GET', url: `/v1/predictions/open?event_id=${eventId}`, headers: auth(token) });

describe('Palpite e Ranking (#942)', () => {
  it('módulo desligado recusa', async () => {
    const t = await tenantKey('game-off', ['core_data', 'live_chat']);
    const f = await fan(t.key);
    expect((await open(f.token, await game())).statusCode).toBe(403);
  });

  it('palpita, recusa abaixo do Piso, pontua no ao vivo e fecha no Ranking', async () => {
    const t = await tenantKey('game-a', ['core_data', 'gamification']);
    const [a, b, c] = [await fan(t.key), await fan(t.key, '13_17'), await fan(t.key)];
    const ev = await game();

    const first = await open(a.token, ev);
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ open: true, floors: { total_score: 1 }, predictions: [] });

    expect(
      (await put(a.token, ev, [{ kind: 'quantity', subject: 'total_score', atLeast: 0 }])).statusCode,
    ).toBe(400);
    expect((await put(a.token, ev, [{ kind: 'quantity', subject: 'corners', atLeast: 3 }])).statusCode).toBe(
      400,
    );

    const saved = await put(a.token, ev, [
      { kind: 'exact_score', home: 2, away: 1 },
      { kind: 'winner', pick: 'home' },
      { kind: 'quantity', subject: 'total_score', atLeast: 3 },
    ]);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.predictions).toHaveLength(3);
    // trocar antes do prazo vale
    expect((await put(a.token, ev, [{ kind: 'winner', pick: 'home' }])).statusCode).toBe(200);
    // 13 a 17 palpita
    expect((await put(b.token, ev, [{ kind: 'winner', pick: 'home' }])).statusCode).toBe(200);
    expect((await put(c.token, ev, [{ kind: 'winner', pick: 'away' }])).statusCode).toBe(200);

    // o jogo começa: o prazo passou, troca recusada
    await setEvent(ev, {
      startsAt: new Date(Date.now() - 60_000),
      status: 'live',
      score: { home: 0, away: 0 },
    });
    expect((await put(a.token, ev, [{ kind: 'winner', pick: 'draw' }])).statusCode).toBe(409);

    // 2 x 1: provisório
    await setEvent(ev, { score: { home: 2, away: 1 } });
    await scorer.reconcile(ev);
    const live = (await open(a.token, ev)).json().data.predictions as {
      kind: string;
      points: number;
      state: string;
    }[];
    expect(live.find((p) => p.kind === 'exact_score')).toMatchObject({ points: 120, state: 'locked' });

    // VAR anula o gol: o provisório cai e o evento de reversão sai
    await setEvent(ev, { score: { home: 1, away: 1 } });
    await scorer.reconcile(ev);
    const after = (await open(a.token, ev)).json().data.predictions as { kind: string; points: number }[];
    expect(after.find((p) => p.kind === 'exact_score')!.points).toBe(0);
    const [rev] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ops.change_feed where topic = 'game.prediction.reverted'`,
    );
    expect(rev!.n).toBeGreaterThan(0);

    // o gol volta e o jogo termina 2 x 1; antes da janela de correção nada fecha
    await setEvent(ev, { score: { home: 2, away: 1 }, status: 'finished' });
    clock = Date.now();
    expect(await scorer.sweep()).toMatchObject({ finalized: 0 });
    clock = Date.now() + 120_000;
    expect((await scorer.sweep()).finalized).toBe(5);
    // outra réplica não fecha de novo
    expect((await scorer.sweep()).finalized).toBe(0);

    const final = (await open(a.token, ev)).json().data.predictions as {
      kind: string;
      points: number;
      state: string;
    }[];
    expect(final.every((p) => p.state === 'final')).toBe(true);
    expect(final.find((p) => p.kind === 'exact_score')).toMatchObject({ points: 120 });

    // Pontos na carteira, uma vez por Palpite
    const [wallet] = await db.execute<{ points: string }>(
      sql`select w.points from fan.wallet w join fan.profile p on p.tenant_id = w.tenant_id and p.id = w.profile_id
           where p.external_profile_id = ${a.profile}`,
    );
    // três Palpites certos (120 + 40 + 120) e os bônus do primeiro Degrau de "Palpiteiro" e de "Na mosca" (20 + 20)
    expect(Number(wallet!.points)).toBe(120 + 40 + 120 + 20 + 20);

    // Conquistas e Cartas: o primeiro Degrau de "Palpiteiro" (3 acertos) e de "Na mosca" (1 placar exato)
    const shelf = await app.inject({
      method: 'GET',
      url: '/v1/fans/me/achievements',
      headers: auth(a.token),
    });
    expect(shelf.statusCode).toBe(200);
    const mine = shelf.json().data.achievements as {
      achievement_id: string;
      season: string;
      count: number;
      steps: number;
    }[];
    expect(mine.find((x) => x.achievement_id === 'predictions.correct' && x.season === 'all')).toMatchObject({
      count: 3,
      steps: 1,
    });
    const cards = await app.inject({ method: 'GET', url: '/v1/fans/me/cards', headers: auth(a.token) });
    const keys = (cards.json().data.cards as { card_key: string; season: string }[])
      .filter((c) => c.season === 'all')
      .map((c) => c.card_key)
      .sort();
    expect(keys).toEqual(['predictions.correct.1', 'predictions.exact_score.1']);
    const [steps] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ops.change_feed where topic = 'game.achievement.step_reached'`,
    );
    expect(steps!.n).toBe(4); // vitalícia e temporada de cada um

    const period = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    })
      .format(new Date(Date.now() - 60_000))
      .slice(0, 7);
    const ranking = await app.inject({
      method: 'GET',
      url: `/v1/rankings/${period}`,
      headers: auth(c.token),
    });
    expect(ranking.statusCode).toBe(200);
    const entries = ranking.json().data.entries as { position: number; nickname: string; points: number }[];
    expect(entries.map((e) => e.points)).toEqual([320, 40]);
    expect(ranking.json().data.program_country).toBe('BR');
    const me = await app.inject({ method: 'GET', url: `/v1/rankings/${period}/me`, headers: auth(b.token) });
    expect(me.json().data).toMatchObject({ position: 2, points: 40 });
    const meC = await app.inject({ method: 'GET', url: `/v1/rankings/${period}/me`, headers: auth(c.token) });
    expect(meC.json().data).toMatchObject({ position: null, points: 0 });

    // outro cliente não vê este Ranking
    const other = await tenantKey('game-b', ['core_data', 'gamification']);
    const o = await fan(other.key);
    const otherRanking = await app.inject({
      method: 'GET',
      url: `/v1/rankings/${period}`,
      headers: auth(o.token),
    });
    expect(otherRanking.json().data.entries).toEqual([]);

    // exclusão do torcedor tira do Ranking
    await eraseFan(db, {
      tenantId: t.id,
      externalAccountId: a.account,
      externalProfileId: a.profile,
      requestedBy: 'test',
    });
    const afterErase = await app.inject({
      method: 'GET',
      url: `/v1/rankings/${period}`,
      headers: auth(c.token),
    });
    expect((afterErase.json().data.entries as unknown[]).length).toBe(1);
  });

  it('o Catálogo da migration é o do @galaxie/game-rules', async () => {
    const rows = await db.execute<{ id: string; active: boolean; steps: number }>(sql`
      select a.id, a.active, (select count(*)::int from game.catalog_step s where s.achievement_id = a.id) as steps
        from game.catalog_achievement a order by a.id`);
    const want = [...INITIAL_CATALOG]
      .map((e) => ({ id: e.id, active: e.active, steps: e.steps.length }))
      .sort((x, y) => x.id.localeCompare(y.id));
    expect([...rows]).toEqual(want);
    const [levels] = await db.execute<{ n: number }>(sql`select count(*)::int as n from game.level_def`);
    expect(levels!.n).toBe(LEVELS.length);
  });

  it('jogo assistido: presença em pelo menos 2/3 do jogo dá Pontos e a Conquista "Fiel"', async () => {
    const t = await tenantKey('game-watch', ['core_data', 'gamification']);
    const [full, half] = [await fan(t.key), await fan(t.key)];
    const start = new Date(Date.now() - 3 * 3_600_000);
    const end = new Date(start.getTime() + 90 * 60_000);
    const [row] = await db
      .insert(event)
      .values({
        sport: 'football',
        startsAt: start,
        endsAtExpected: end,
        status: 'finished',
        score: { home: 1, away: 0 },
      })
      .returning({ id: event.id });
    const ev = row!.id;
    const window = async (externalProfileId: string, minutes: number) => {
      await db.execute(sql`
        insert into fan.presence_window (tenant_id, profile_id, event_id, started_at, last_seen_at, last_interaction_at)
        select p.tenant_id, p.id, ${ev}::uuid, ${start.toISOString()}::timestamptz,
               ${new Date(start.getTime() + minutes * 60_000).toISOString()}::timestamptz, ${start.toISOString()}::timestamptz
          from fan.profile p where p.tenant_id = ${t.id} and p.external_profile_id = ${externalProfileId}`);
    };
    await window(full.profile, 61); // 61 de 90 min: passa de 2/3
    await window(half.profile, 59); // 59 de 90: não passa
    clock = Date.now() + 120_000;
    expect((await scorer.sweep()).watched).toBe(1);
    expect((await scorer.sweep()).watched).toBe(0);
    const shelf = await app.inject({
      method: 'GET',
      url: '/v1/fans/me/achievements',
      headers: auth(full.token),
    });
    expect(
      (shelf.json().data.achievements as { achievement_id: string; season: string; steps: number }[]).find(
        (a) => a.achievement_id === 'loyalty.watched' && a.season === 'all',
      ),
    ).toMatchObject({ steps: 1 });
    const [w] = await db.execute<{ points: string }>(
      sql`select w.points from fan.wallet w join fan.profile p on p.tenant_id = w.tenant_id and p.id = w.profile_id
           where p.external_profile_id = ${full.profile}`,
    );
    expect(Number(w!.points)).toBe(20);
    const halfShelf = await app.inject({
      method: 'GET',
      url: '/v1/fans/me/achievements',
      headers: auth(half.token),
    });
    expect(halfShelf.json().data.achievements).toEqual([]);
  });

  it('jogo cancelado anula os Palpites, sem Pontos', async () => {
    const t = await tenantKey('game-c', ['core_data', 'gamification']);
    const f = await fan(t.key);
    const ev = await game();
    expect((await put(f.token, ev, [{ kind: 'winner', pick: 'home' }])).statusCode).toBe(200);
    await setEvent(ev, { status: 'cancelled', startsAt: new Date(Date.now() - 60_000) });
    expect((await scorer.sweep()).voided).toBe(1);
    const rows = (await open(f.token, ev)).json().data.predictions as { state: string; points: number }[];
    expect(rows).toEqual([expect.objectContaining({ state: 'void', points: 0 })]);
  });

  it('esporte sem Palpite e menor de 13 ficam fora', async () => {
    const t = await tenantKey('game-d', ['core_data', 'gamification']);
    const f = await fan(t.key);
    expect((await open(f.token, await game({ sport: 'mma' }))).statusCode).toBe(404);
    const kid = await app.inject({
      method: 'POST',
      url: '/v1/fans/tokens',
      headers: { 'x-galaxie-key': t.key },
      payload: {
        externalAccountId: 'acc_kid',
        externalProfileId: 'prof_kid',
        nickname: 'Kid',
        ageBand: 'under13',
        country: 'br',
        locale: 'pt-BR',
      },
    });
    if (kid.statusCode === 201) {
      const res = await open(kid.json().data.token, await game());
      expect(res.statusCode).toBe(403);
    } else {
      // a emissão de token já recusa menor de 13
      expect([400, 403]).toContain(kid.statusCode);
    }
  });
});
