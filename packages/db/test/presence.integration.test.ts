import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  closeDb,
  createDb,
  erasePresence,
  presenceWindows,
  purgePresence,
  readPresenceLimit,
  recordHeartbeat,
  runMigrations,
  wasPresentAt,
  writePresenceLimit,
  type Database,
  type PresenceVerdict,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let pg: postgres.Sql;
let db: Database;
let tenantId: string;
let otherTenant: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
  const tenant = async (slug: string) =>
    (
      await pg`insert into api.tenant (slug, name, plan, modules)
        values (${slug}, ${slug}, 'enterprise', ${['gamification']}) returning id`
    )[0]!.id as string;
  tenantId = await tenant('presenca-a');
  otherTenant = await tenant('presenca-b');
}, 60_000);

afterAll(async () => {
  await pg?.end();
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

let seq = 0;
async function profile(ageBand: 'under13' | '13_17' | '18plus', tenant = tenantId): Promise<string> {
  seq += 1;
  const [acc] = await pg`insert into fan.account (tenant_id, external_account_id)
    values (${tenant}, ${`acc_${seq}`}) returning id`;
  const [prof] = await pg`insert into fan.profile
      (tenant_id, account_id, external_profile_id, nickname, age_band, country, locale)
    values (${tenant}, ${acc!.id}, ${`prof_${seq}`}, ${`Torcedor${seq}`}, ${ageBand}, 'BR', 'pt-BR') returning id`;
  return prof!.id as string;
}

const min = 60_000;
// as regras de verdade estão em @galaxie/engage; aqui a mesma forma, para o teste não depender do pacote
const verdict = (v: {
  visible: boolean;
  interacted: boolean;
  lastInteractionAt: number | null;
  windowStartedAt: number | null;
  now: number;
}): PresenceVerdict => {
  if (!v.visible) return 'hidden';
  if (v.interacted || v.windowStartedAt === null) return 'counted';
  return v.now - (v.lastInteractionAt ?? v.windowStartedAt) > 15 * min ? 'interaction_needed' : 'counted';
};
const rules = { gapMs: 90_000, maxGames: 2, verdict };
const beat = (profileId: string, eventId: string, over: { visible?: boolean; interacted?: boolean } = {}) =>
  recordHeartbeat(db, {
    tenantId,
    profileId,
    eventId,
    visible: over.visible ?? true,
    interacted: over.interacted ?? false,
    rules,
  });

describe('presença ao vivo (B9, #906)', () => {
  it('abre a janela, estende no próximo sinal e aba oculta não conta', async () => {
    const p = await profile('18plus');
    const ev = randomUUID();
    expect(await beat(p, ev, { visible: false })).toMatchObject({ counted: false, reason: 'hidden' });
    expect(await presenceWindows(db, { tenantId, profileId: p, eventId: ev })).toEqual([]);
    expect(await beat(p, ev)).toMatchObject({ counted: true, opened: true });
    expect(await beat(p, ev)).toMatchObject({ counted: true, opened: false });
    const ws = await presenceWindows(db, { tenantId, profileId: p, eventId: ev });
    expect(ws).toHaveLength(1);
    expect(ws[0]!.heartbeats).toBe(2);
  });

  it('sem toque por mais de 15 minutos o sinal para de contar até interagir', async () => {
    const p = await profile('18plus');
    const ev = randomUUID();
    await beat(p, ev);
    await pg`update fan.presence_window set started_at = now() - interval '20 minutes',
      last_interaction_at = now() - interval '20 minutes' where profile_id = ${p}`;
    expect(await beat(p, ev)).toMatchObject({ counted: false, reason: 'interaction_needed' });
    expect(await beat(p, ev, { interacted: true })).toMatchObject({ counted: true, opened: false });
    expect(await beat(p, ev)).toMatchObject({ counted: true });
  });

  it('limite de jogos ao mesmo tempo, e janela velha não conta', async () => {
    const p = await profile('18plus');
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await beat(p, a);
    await beat(p, b);
    expect(await beat(p, c)).toMatchObject({ counted: false, reason: 'too_many_games' });
    await pg`update fan.presence_window set started_at = now() - interval '10 minutes',
      last_seen_at = now() - interval '5 minutes', last_interaction_at = now() - interval '10 minutes'
      where profile_id = ${p} and event_id = ${a}`;
    expect(await beat(p, c)).toMatchObject({ counted: true, opened: true });
    // voltar ao jogo depois de sair abre outra janela
    expect(await beat(p, a)).toMatchObject({ counted: false, reason: 'too_many_games' });
  });

  it('presença iniciada depois do evento não credita o evento', async () => {
    const p = await profile('18plus');
    const ev = randomUUID();
    await beat(p, ev);
    await pg`update fan.presence_window set started_at = now() - interval '30 minutes',
      last_interaction_at = now() - interval '30 minutes', last_seen_at = now() - interval '10 minutes'
      where profile_id = ${p}`;
    const at = (m: number) => new Date(Date.now() - m * min);
    const ask = (m: number) =>
      wasPresentAt(db, { tenantId, profileId: p, eventId: ev, at: at(m), slackMs: 30_000 });
    expect(await ask(40)).toBe(false);
    expect(await ask(20)).toBe(true);
    expect(await ask(10)).toBe(true);
    expect(await ask(5)).toBe(false);
    expect(
      await wasPresentAt(db, { tenantId: otherTenant, profileId: p, eventId: ev, at: at(20), slackMs: 0 }),
    ).toBe(false);
  });

  it('limite do cliente, exclusão e retenção', async () => {
    expect(await readPresenceLimit(db, tenantId)).toBeNull();
    await writePresenceLimit(db, { tenantId, maxGames: 1, updatedBy: 'panel:u1' });
    await writePresenceLimit(db, { tenantId, maxGames: 2, updatedBy: 'panel:u1' });
    expect(await readPresenceLimit(db, tenantId)).toBe(2);
    await expect(writePresenceLimit(db, { tenantId, maxGames: 11, updatedBy: 'panel:u1' })).rejects.toThrow();
    await writePresenceLimit(db, { tenantId, maxGames: null, updatedBy: 'panel:u1' });
    expect(await readPresenceLimit(db, tenantId)).toBeNull();

    const p = await profile('18plus');
    const ev = randomUUID();
    await beat(p, ev);
    await db.transaction((tx) => erasePresence(tx, tenantId, p));
    expect(await presenceWindows(db, { tenantId, profileId: p, eventId: ev })).toEqual([]);

    const q = await profile('18plus');
    await beat(q, ev);
    await pg`update fan.presence_window set started_at = now() - interval '400 days',
      last_interaction_at = now() - interval '400 days', last_seen_at = now() - interval '399 days'
      where profile_id = ${q}`;
    expect(await purgePresence(db, new Date(Date.now() - 365 * 24 * 60 * min))).toBeGreaterThanOrEqual(1);
    expect(await presenceWindows(db, { tenantId, profileId: q, eventId: ev })).toEqual([]);
  });
});
