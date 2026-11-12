import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  event,
  eventIncident,
  participant,
  person,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import { eq } from 'drizzle-orm';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { buildServer } from '../src/server.js';
import { openSse, type SseClient, type SseMessage } from './sse-client.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-test-${randomBytes(4).toString('hex')}:`;
const ADMIN_KEY = generateAdminKey();

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
/** Duas instâncias: as duas recebem a mudança, só uma grava e publica. */
let appA: FastifyInstance;
let appB: FastifyInstance;
let baseB: string;
const clients: SseClient[] = [];
let home: string;
let away: string;
let scorer: string;

const server = () =>
  buildServer({
    db,
    redis,
    keyPrefix,
    usagePersist: false,
    moduleUsage: false,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: new FanTokenSigner({ secret: 's'.repeat(48) }),
    realtime: { pollIntervalMs: 200 },
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
    chat: { stream: { heartbeatMs: 1_000 } },
  });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 10 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras' },
      { sport: 'football', kind: 'club', name: 'Botafogo' },
    ])
    .returning({ id: participant.id });
  home = teams[0]!.id;
  away = teams[1]!.id;
  scorer = (await db.insert(person).values({ name: 'Estêvão' }).returning({ id: person.id }))[0]!.id;
  appA = server();
  appB = server();
  await appA.listen({ host: '127.0.0.1', port: 0 });
  await appB.listen({ host: '127.0.0.1', port: 0 });
  baseB = `http://127.0.0.1:${(appB.server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.close();
  await appA?.close();
  await appB?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

async function tenantKey(slug: string, eventKinds?: string[]): Promise<string> {
  const res = await appA.inject({
    method: 'POST',
    url: '/internal/admin/tenants',
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    payload: { slug, name: slug, plan: 'enterprise', modules: ['core_data', 'live_chat'] },
  });
  expect(res.statusCode).toBe(201);
  const key = res.json().key.key as string;
  if (eventKinds) {
    const cfg = await appA.inject({
      method: 'PUT',
      url: '/v1/chat/config',
      headers: { 'x-galaxie-key': key },
      payload: { eventKinds },
    });
    expect(cfg.json().data.event_kinds).toEqual(eventKinds);
  }
  return key;
}

async function game(): Promise<string> {
  const now = Date.now();
  const [row] = await db
    .insert(event)
    .values({
      sport: 'football',
      startsAt: new Date(now - 20 * 60_000),
      endsAtExpected: new Date(now + 95 * 60_000),
      status: 'live',
      score: { home: 0, away: 0 },
    })
    .returning({ id: event.id });
  return row!.id;
}

let seq = 0;
const incident = (
  eventId: string,
  type: string,
  detail: string,
  participantId = home,
  personId: string | null = scorer,
) =>
  db
    .insert(eventIncident)
    .values({ eventId, type, detail, participantId, personId, minute: 23, sequence: ++seq });

async function stream(key: string, fixture: string) {
  const c = await openSse(`${baseB}/v1/chat/rooms/${fixture}/stream`, { 'x-galaxie-key': key });
  clients.push(c);
  await c.waitFor((m) => m.event === 'ready');
  return c;
}
type Game = {
  id: string;
  kind: string;
  cancelled: boolean;
  text: Record<string, string>;
  team: { name: string } | null;
};
const games = (c: SseClient) =>
  c.messages
    .filter((m) => m.event === 'chat.game')
    .flatMap((m) => (JSON.parse(m.data) as { messages: Game[] }).messages);
const live = (m: SseMessage) =>
  m.event === 'chat.game' && !(JSON.parse(m.data) as { snapshot?: boolean }).snapshot;

describe('Chat ao vivo: o jogo dentro do chat (#965)', () => {
  it('gol aparece em até 2 s, com time, autor e placar; VAR anula sem apagar', async () => {
    const key = await tenantKey('jogo-a');
    const fixture = await game();
    const reader = await stream(key, fixture);

    await db
      .update(event)
      .set({ score: { home: 1, away: 0 } })
      .where(eq(event.id, fixture));
    const at = Date.now();
    await incident(fixture, 'Goal', 'Normal Goal');
    const got = await reader.waitFor(live, 4_000);
    expect(got.receivedAt - at).toBeLessThanOrEqual(2_000);
    const [goal] = games(reader);
    expect(goal).toMatchObject({ kind: 'goal', cancelled: false, team: { name: 'Palmeiras' } });
    expect(goal!.text['pt-BR']).toBe("23' ⚽ Gol do Palmeiras (Estêvão). 1-0");
    // duas instâncias receberam a mudança: uma mensagem só
    await new Promise((r) => setTimeout(r, 1_500));
    expect(games(reader).filter((g) => g.kind === 'goal')).toHaveLength(1);

    await incident(fixture, 'Var', 'Goal cancelled', home, null);
    await reader.waitFor(() => games(reader).some((g) => g.kind === 'goal' && g.cancelled), 4_000);
    const fixed = games(reader)
      .filter((g) => g.id === goal!.id)
      .at(-1)!;
    expect(fixed.text['pt-BR']).toMatch(/Anulado pelo VAR/);
    expect(games(reader).some((g) => g.kind === 'var')).toBe(true);

    // o GET traz o jogo dentro do chat (o gol continua, anulado)
    const room = await appA.inject({
      method: 'GET',
      url: `/v1/chat/rooms/${fixture}`,
      headers: { 'x-galaxie-key': key },
    });
    const list = room.json().data.game_messages as Game[];
    expect(list.map((g) => g.kind)).toEqual(['goal', 'var']);
    expect(list[0]!.cancelled).toBe(true);

    // quem entra depois recebe a lista inteira na abertura
    const late = await stream(key, fixture);
    expect(games(late).map((g) => g.kind)).toEqual(['goal', 'var']);
  });

  it('cliente que desliga cartões não recebe cartão; amarelo nunca vira mensagem', async () => {
    const noCards = await tenantKey('jogo-sem-cartao', ['goal', 'var', 'kickoff', 'half_time', 'full_time']);
    const all = await tenantKey('jogo-com-cartao');
    const fixture = await game();
    const quiet = await stream(noCards, fixture);
    const loud = await stream(all, fixture);

    await incident(fixture, 'Card', 'Yellow Card', away);
    await incident(fixture, 'Card', 'Red Card', away);
    await loud.waitFor(live, 4_000);
    expect(games(loud).map((g) => g.kind)).toEqual(['red_card']);

    await db.update(event).set({ status: 'finished' }).where(eq(event.id, fixture));
    await quiet.waitFor(live, 4_000);
    expect(games(quiet).map((g) => g.kind)).toEqual(['full_time']);
  });
});
