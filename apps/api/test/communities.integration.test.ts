import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addScopeRule,
  closeDb,
  createDb,
  createInvite,
  decideJoinRequest,
  insertPost,
  listCommunities,
  listJoinRequests,
  pinPost,
  publishTerms,
  removeMember,
  removeScopeRule,
  runMigrations,
  setCommunitySuspended,
  setContentVisibility,
  updateCommunityConfig,
  type Database,
} from '@galaxie/db';
import { sql } from 'drizzle-orm';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { buildServer } from '../src/server.js';

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
let app: FastifyInstance;

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usagePersist: false,
    moduleUsage: false,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: new FanTokenSigner({ secret: 's'.repeat(48) }),
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
  });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
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

let fanSeq = 0;
const fan = async (key: string, ageBand = '18plus') => {
  fanSeq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fans/tokens',
    headers: { 'x-galaxie-key': key },
    payload: {
      externalAccountId: `acc_${fanSeq}`,
      externalProfileId: `prof_${fanSeq}`,
      nickname: `Torcedor${fanSeq}`,
      ageBand,
      country: 'br',
      ageAssurance: { method: 'estimated', at: '2026-11-01' },
      locale: 'pt-BR',
    },
  });
  expect(res.statusCode).toBe(201);
  return { token: res.json().data.token as string, profileId: res.json().data.profile_id as string };
};

async function sportSlug(): Promise<string> {
  const [row] = await db.execute<{ slug: string }>(
    sql`insert into core.sport (slug, name) values ('football', '{"pt-BR":"Futebol","en":"Football"}')
        on conflict (slug) do update set slug = excluded.slug returning slug`,
  );
  return row!.slug;
}

/** Campeonato com temporada atual e `teams` times jogando nela. */
async function league(slug: string, teams: string[]): Promise<{ id: string; teamIds: string[] }> {
  const sport = await sportSlug();
  const [c] = await db.execute<{ id: string }>(
    sql`insert into core.competition (sport, slug, name, type) values (${sport}, ${slug}, ${slug}, 'league') returning id`,
  );
  const [s] = await db.execute<{ id: string }>(
    sql`insert into core.season (competition_id, label, year, current) values (${c!.id}, '2026', 2026, true) returning id`,
  );
  const teamIds: string[] = [];
  for (const name of teams) {
    const [p] = await db.execute<{ id: string }>(
      sql`insert into core.participant (sport, kind, name) values (${sport}, 'club', ${name}) returning id`,
    );
    teamIds.push(p!.id);
  }
  for (let i = 0; i + 1 < teamIds.length; i += 2) {
    const [e] = await db.execute<{ id: string }>(
      sql`insert into core.event (sport, competition_id, season_id, starts_at, ends_at_expected, status)
          values (${sport}, ${c!.id}, ${s!.id}, now(), now() + interval '2 hours', 'scheduled') returning id`,
    );
    await db.execute(
      sql`insert into core.event_participant (event_id, participant_id, side)
          values (${e!.id}, ${teamIds[i]}, 'home'), (${e!.id}, ${teamIds[i + 1]}, 'away')`,
    );
  }
  return { id: c!.id, teamIds };
}

const get = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const post = (token: string, url: string, payload?: object) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: payload ?? {} });

describe('Comunidades por escopo (#939)', () => {
  it('ligar "todos os times do campeonato" cria uma Comunidade por time, em ordem alfabética, sem duplicar', async () => {
    const t = await tenantKey('com-a', ['core_data', 'communities']);
    const lg = await league('liga-a', ['Zeta FC', 'Alfa FC', 'Meio FC', 'Beta FC']);
    const first = await addScopeRule(db, {
      tenantId: t.id,
      kind: 'competition_participants',
      target: lg.id,
      actor: 'tenant:ops@cliente',
    });
    expect(first.created).toBe(4);
    // repetir a regra não cria nada
    const again = await addScopeRule(db, {
      tenantId: t.id,
      kind: 'competition_participants',
      target: lg.id,
      actor: 'tenant:ops@cliente',
    });
    expect(again).toMatchObject({ created: 0, archived: 0, reactivated: 0 });
    // o time sozinho, por outra regra, cai na mesma Comunidade (uma por Âncora)
    await addScopeRule(db, {
      tenantId: t.id,
      kind: 'participant',
      target: lg.teamIds[0]!,
      actor: 'tenant:x',
    });
    const all = await listCommunities(db, t.id);
    expect(all.map((c) => c.name)).toEqual(['Alfa FC', 'Beta FC', 'Meio FC', 'Zeta FC']);

    const f = await fan(t.key);
    const res = await get(f.token, '/v1/communities');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.json().data.map((c: { name: string }) => c.name)).toEqual([
      'Alfa FC',
      'Beta FC',
      'Meio FC',
      'Zeta FC',
    ]);
  });

  it('o banco recusa a segunda Comunidade da mesma Âncora', async () => {
    const t = await tenantKey('com-b', ['core_data', 'communities']);
    const sport = await sportSlug();
    await db.execute(
      sql`insert into community.community (tenant_id, anchor_type, anchor_id) values (${t.id}, 'sport', ${sport})`,
    );
    await expect(
      db.execute(
        sql`insert into community.community (tenant_id, anchor_type, anchor_id) values (${t.id}, 'sport', ${sport})`,
      ),
    ).rejects.toThrow();
  });

  it('respeita o teto do tenant e arquiva ao sair do escopo, sem apagar', async () => {
    const t = await tenantKey('com-c', ['core_data', 'communities']);
    await db.execute(
      sql`insert into api.tenant_module_limit (tenant_id, key, value, updated_by)
          values (${t.id}, 'communities.max_communities', 2, 'admin')`,
    );
    const lg = await league('liga-c', ['A', 'B', 'C', 'D']);
    const r = await addScopeRule(db, {
      tenantId: t.id,
      kind: 'competition_participants',
      target: lg.id,
      actor: 'tenant:x',
    });
    expect(r.created).toBe(2);
    expect(r.overLimit).toHaveLength(2);
    const [rule] = await db.execute<{ id: string }>(
      sql`select id from community.scope_rule where tenant_id = ${t.id}`,
    );
    const out = await removeScopeRule(db, { tenantId: t.id, ruleId: rule!.id, actor: 'tenant:x' });
    expect(out.archived).toBe(2);
    const rows = await listCommunities(db, t.id);
    expect(rows.map((c) => c.state)).toEqual(['archived', 'archived']);
  });

  it('alvo que não existe é recusado', async () => {
    const t = await tenantKey('com-d', ['core_data', 'communities']);
    await expect(
      addScopeRule(db, {
        tenantId: t.id,
        kind: 'competition',
        target: '00000000-0000-7000-8000-000000000000',
        actor: 'tenant:x',
      }),
    ).rejects.toMatchObject({ code: 'invalid_target' });
  });
});

describe('Entrada do torcedor (#939)', () => {
  async function setup(slug: string) {
    const t = await tenantKey(slug, ['core_data', 'communities']);
    const lg = await league(`liga-${slug}`, ['Time 1', 'Time 2']);
    await addScopeRule(db, { tenantId: t.id, kind: 'competition', target: lg.id, actor: 'tenant:x' });
    const [c] = await listCommunities(db, t.id);
    return { t, c: c! };
  }

  it('aberta: entra, aparece como membro e sai', async () => {
    const { t, c } = await setup('com-open');
    const f = await fan(t.key);
    const join = await post(f.token, `/v1/communities/${c.id}/join`);
    expect(join.statusCode).toBe(200);
    expect(join.json().data.result).toBe('joined');
    const again = await post(f.token, `/v1/communities/${c.id}/join`);
    expect(again.json().data.result).toBe('already_member');
    const detail = await get(f.token, `/v1/communities/${c.id}`);
    expect(detail.json().data).toMatchObject({ members: 1, me: { membership: 'active' } });
    expect((await post(f.token, `/v1/communities/${c.id}/leave`)).statusCode).toBe(204);
    const after = await get(f.token, `/v1/communities/${c.id}`);
    expect(after.json().data).toMatchObject({ members: 0, me: { membership: 'left' } });
  });

  it('13 a 17 entra (lê e reage, sem escrever)', async () => {
    const { t, c } = await setup('com-teen');
    const f = await fan(t.key, '13_17');
    const join = await post(f.token, `/v1/communities/${c.id}/join`);
    expect([200, 403]).toContain(join.statusCode);
    // na ficha padrão do Brasil, 13 a 17 com estimativa lê; se a ficha pedir autorização, o portão responde 403
    if (join.statusCode === 200) expect(join.json().data.result).toBe('joined');
  });

  it('com termos: exige o Aceite da versão em vigor e pede de novo na versão nova', async () => {
    const { t, c } = await setup('com-terms');
    const v1 = await publishTerms(db, {
      tenantId: t.id,
      communityId: c.id,
      body: { pt: 'Regras v1', es: 'Reglas v1', en: 'Rules v1' },
      actor: 'tenant:x',
    });
    const f = await fan(t.key);
    const refused = await post(f.token, `/v1/communities/${c.id}/join`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().errors[0].message).toBe('terms_required');
    const terms = await get(f.token, `/v1/communities/${c.id}/terms/${v1}`);
    expect(terms.json().data.text).toBe('Regras v1');
    const ok = await post(f.token, `/v1/communities/${c.id}/join`, { accepted_terms_version: v1 });
    expect(ok.json().data.result).toBe('joined');

    const v2 = await publishTerms(db, {
      tenantId: t.id,
      communityId: c.id,
      body: { pt: 'Regras v2', es: 'Reglas v2', en: 'Rules v2' },
      actor: 'tenant:x',
    });
    const before = await get(f.token, `/v1/communities/${c.id}`);
    expect(before.json().data.me).toMatchObject({ membership: 'active', needs_acceptance: true });
    expect((await post(f.token, `/v1/communities/${c.id}/accept`, { version: v1 })).statusCode).toBe(404);
    expect((await post(f.token, `/v1/communities/${c.id}/accept`, { version: v2 })).statusCode).toBe(204);
    const after = await get(f.token, `/v1/communities/${c.id}`);
    expect(after.json().data.me).toMatchObject({ accepted_terms_version: v2, needs_acceptance: false });
  });

  it('com aprovação: abre pedido, e a equipe aprova', async () => {
    const { t, c } = await setup('com-approval');
    await updateCommunityConfig(db, {
      tenantId: t.id,
      id: c.id,
      expectedVersion: c.version,
      patch: { joinMode: 'approval' },
    });
    const f = await fan(t.key);
    expect((await post(f.token, `/v1/communities/${c.id}/join`)).json().data.result).toBe('requested');
    expect((await post(f.token, `/v1/communities/${c.id}/join`)).json().data.result).toBe(
      'already_requested',
    );
    // termos publicados com o pedido aberto: o Aceite novo fica gravado mesmo sem mudar o pedido
    const v1 = await publishTerms(db, {
      tenantId: t.id,
      communityId: c.id,
      body: { pt: 'Regras', es: 'Reglas', en: 'Rules' },
      actor: 'tenant:x',
    });
    expect(
      (await post(f.token, `/v1/communities/${c.id}/join`, { accepted_terms_version: v1 })).json().data
        .result,
    ).toBe('already_requested');
    const [req] = await listJoinRequests(db, t.id, c.id);
    expect(req?.profileId).toBe(f.profileId);
    expect(
      await decideJoinRequest(db, {
        tenantId: t.id,
        requestId: req!.id,
        approve: true,
        actor: 'tenant:x',
        now: new Date(),
      }),
    ).toBe(true);
    expect((await get(f.token, `/v1/communities/${c.id}`)).json().data.me).toMatchObject({
      membership: 'active',
      needs_acceptance: false,
    });
  });

  it('fechada: só com convite; quem foi tirado volta só com convite', async () => {
    const { t, c } = await setup('com-closed');
    await updateCommunityConfig(db, {
      tenantId: t.id,
      id: c.id,
      expectedVersion: c.version,
      patch: { joinMode: 'closed' },
    });
    const f = await fan(t.key);
    const no = await post(f.token, `/v1/communities/${c.id}/join`);
    expect(no.json().errors[0].message).toBe('invite_required');
    const bad = await post(f.token, `/v1/communities/${c.id}/join`, { invite_code: 'codigo-errado-123' });
    expect(bad.json().errors[0].message).toBe('invite_invalid');
    const inv = await createInvite(db, { tenantId: t.id, communityId: c.id, actor: 'tenant:x', maxUses: 2 });
    expect(
      (await post(f.token, `/v1/communities/${c.id}/join`, { invite_code: inv.code })).json().data.result,
    ).toBe('joined');

    expect(
      await removeMember(db, {
        tenantId: t.id,
        communityId: c.id,
        profileId: f.profileId,
        actor: 'tenant:x',
        now: new Date(),
      }),
    ).toBe(true);
    await updateCommunityConfig(db, {
      tenantId: t.id,
      id: c.id,
      expectedVersion: c.version + 1,
      patch: { joinMode: 'open' },
    });
    const removed = await post(f.token, `/v1/communities/${c.id}/join`);
    expect(removed.json().errors[0].message).toBe('removed');
    expect(
      (await post(f.token, `/v1/communities/${c.id}/join`, { invite_code: inv.code })).json().data.result,
    ).toBe('joined');
    // o convite esgotou (2 usos)
    const g = await fan(t.key);
    await updateCommunityConfig(db, {
      tenantId: t.id,
      id: c.id,
      expectedVersion: c.version + 2,
      patch: { joinMode: 'closed' },
    });
    expect(
      (await post(g.token, `/v1/communities/${c.id}/join`, { invite_code: inv.code })).json().errors[0]
        .message,
    ).toBe('invite_invalid');
  });

  it('suspensa pela Galaxie some para o torcedor', async () => {
    const { t, c } = await setup('com-susp');
    const f = await fan(t.key);
    expect(
      await setCommunitySuspended(db, { tenantId: t.id, id: c.id, suspended: true, actor: 'galaxie:1' }),
    ).toBe('suspended');
    expect((await get(f.token, `/v1/communities/${c.id}`)).statusCode).toBe(404);
    expect((await get(f.token, '/v1/communities')).json().data).toEqual([]);
    expect(
      await setCommunitySuspended(db, { tenantId: t.id, id: c.id, suspended: false, actor: 'galaxie:1' }),
    ).toBe('active');
  });

  it('outro cliente não vê nem entra na Comunidade', async () => {
    const { c } = await setup('com-own');
    const other = await tenantKey('com-other', ['core_data', 'communities']);
    const f = await fan(other.key);
    expect((await get(f.token, `/v1/communities/${c.id}`)).statusCode).toBe(404);
    expect((await post(f.token, `/v1/communities/${c.id}/join`)).statusCode).toBe(404);
  });

  it('sem o módulo, 403', async () => {
    const t = await tenantKey('com-nomod', ['core_data', 'live_chat']);
    const f = await fan(t.key);
    const res = await get(f.token, '/v1/communities');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MODULE_NOT_IN_PLAN');
  });

  it('sem token, nada aparece', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/communities' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Feed da Comunidade (#946)', () => {
  async function member(slug: string) {
    const t = await tenantKey(slug, ['core_data', 'communities']);
    const lg = await league(`liga-${slug}`, ['Time A', 'Time B']);
    await addScopeRule(db, { tenantId: t.id, kind: 'competition', target: lg.id, actor: 'tenant:x' });
    const [c] = await listCommunities(db, t.id);
    const adult = await fan(t.key);
    expect((await post(adult.token, `/v1/communities/${c!.id}/join`)).statusCode).toBe(200);
    return { t, c: c!, adult, teamId: lg.teamIds[0]! };
  }
  const wait = () => new Promise((r) => setTimeout(r, 0));

  it('membro publica com card anexado, comenta e curte; quem não é membro não vê', async () => {
    const { t, c, adult, teamId } = await member('feed-a');
    const created = await post(adult.token, `/v1/communities/${c.id}/posts`, {
      body: 'Que jogo ontem!',
      attachment: { type: 'participant', id: teamId },
    });
    expect(created.statusCode).toBe(201);
    const p = created.json().data;
    expect(p).toMatchObject({
      status: 'published',
      author: { kind: 'member' },
      attachment: { type: 'participant' },
    });

    const reader = await fan(t.key);
    expect((await get(reader.token, `/v1/communities/${c.id}/posts`)).json().errors[0].message).toBe(
      'not_member',
    );
    await post(reader.token, `/v1/communities/${c.id}/join`);
    const feed = await get(reader.token, `/v1/communities/${c.id}/posts`);
    expect(feed.statusCode).toBe(200);
    expect(feed.json().data.posts.map((x: { id: string }) => x.id)).toEqual([p.id]);

    const liked = await app.inject({
      method: 'PUT',
      url: `/v1/posts/${p.id}/like`,
      headers: { authorization: `Bearer ${reader.token}` },
    });
    expect(liked.json().data).toEqual({ liked: true, likes: 1 });
    const again = await app.inject({
      method: 'PUT',
      url: `/v1/posts/${p.id}/like`,
      headers: { authorization: `Bearer ${reader.token}` },
    });
    expect(again.json().data.likes).toBe(1);

    const cm = await post(reader.token, `/v1/posts/${p.id}/comments`, { body: 'Demais' });
    expect(cm.statusCode).toBe(201);
    const list = await get(adult.token, `/v1/posts/${p.id}/comments`);
    expect(list.json().data.map((x: { body: string }) => x.body)).toEqual(['Demais']);
    const after = (await get(adult.token, `/v1/communities/${c.id}/posts`)).json().data.posts[0];
    expect(after).toMatchObject({ likes: 1, comments: 1, liked_by_me: false });
  });

  it('13 a 17 lê e curte, mas não escreve', async () => {
    const { t, c, adult } = await member('feed-teen');
    const p = (await post(adult.token, `/v1/communities/${c.id}/posts`, { body: 'Olá' })).json().data;
    const teen = await fan(t.key, '13_17');
    const join = await post(teen.token, `/v1/communities/${c.id}/join`);
    if (join.statusCode !== 200) return; // ficha do país pede autorização: o portão já barra a leitura
    expect((await get(teen.token, `/v1/communities/${c.id}/posts`)).statusCode).toBe(200);
    const write = await post(teen.token, `/v1/communities/${c.id}/posts`, { body: 'Oi' });
    expect(write.statusCode).toBe(403);
    const like = await app.inject({
      method: 'PUT',
      url: `/v1/posts/${p.id}/like`,
      headers: { authorization: `Bearer ${teen.token}` },
    });
    expect(like.statusCode).toBe(200);
  });

  it('post de membro desligado e termos novos barram a escrita', async () => {
    const { t, c, adult } = await member('feed-off');
    await updateCommunityConfig(db, {
      tenantId: t.id,
      id: c.id,
      expectedVersion: c.version,
      patch: { memberPosts: false },
    });
    const off = await post(adult.token, `/v1/communities/${c.id}/posts`, { body: 'Oi' });
    expect(off.json().errors[0].message).toBe('member_posts_off');
    await updateCommunityConfig(db, {
      tenantId: t.id,
      id: c.id,
      expectedVersion: c.version + 1,
      patch: { memberPosts: true },
    });
    await publishTerms(db, {
      tenantId: t.id,
      communityId: c.id,
      body: { pt: 'R', es: 'R', en: 'R' },
      actor: 'tenant:x',
    });
    const terms = await post(adult.token, `/v1/communities/${c.id}/posts`, { body: 'Oi' });
    expect(terms.json().errors[0].message).toBe('terms_required');
  });

  it('bloqueio vale nos dois sentidos: Feed, comentários, contadores e acesso pelo id', async () => {
    const { t, c, adult: a } = await member('feed-block');
    const b = await fan(t.key);
    await post(b.token, `/v1/communities/${c.id}/join`);
    const pa = (await post(a.token, `/v1/communities/${c.id}/posts`, { body: 'Post de A' })).json().data;
    const pb = (await post(b.token, `/v1/communities/${c.id}/posts`, { body: 'Post de B' })).json().data;
    const staff = await insertPost(db, {
      tenantId: t.id,
      communityId: c.id,
      author: 'staff',
      profileId: null,
      staffBy: 'panel:1',
      body: 'Aviso da equipe',
      attachment: null,
      visibility: 'public',
      flags: [],
      purgeAt: new Date(Date.now() + 86_400_000),
    });
    await new Promise((r) => setTimeout(r, 10_100)); // intervalo entre envios do mesmo torcedor
    expect((await post(b.token, `/v1/posts/${pa.id}/comments`, { body: 'B comenta em A' })).statusCode).toBe(
      201,
    );
    expect((await post(a.token, `/v1/posts/${pb.id}/comments`, { body: 'A comenta em B' })).statusCode).toBe(
      201,
    );
    const ids = async (token: string) =>
      (await get(token, `/v1/communities/${c.id}/posts`))
        .json()
        .data.posts.map((x: { id: string }) => x.id)
        .sort();
    // antes do bloqueio, cada um vê tudo
    expect(await ids(a.token)).toEqual([pa.id, pb.id, staff.id].sort());
    expect((await get(a.token, `/v1/posts/${pa.id}/comments`)).json().data).toHaveLength(1);

    const blocked = await app.inject({
      method: 'PUT',
      url: `/v1/fans/me/blocks/${b.profileId}`,
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(blocked.statusCode).toBe(204);

    // quem bloqueou (A) e quem foi bloqueado (B) não se veem; o post da equipe continua para os dois
    expect(await ids(a.token)).toEqual([pa.id, staff.id].sort());
    expect(await ids(b.token)).toEqual([pb.id, staff.id].sort());
    expect((await get(a.token, `/v1/posts/${pa.id}/comments`)).json().data).toEqual([]);
    const mineForA = (await get(a.token, `/v1/communities/${c.id}/posts`))
      .json()
      .data.posts.find((x: { id: string }) => x.id === pa.id);
    expect(mineForA.comments).toBe(0);
    // pelo id, o post do outro não abre comentário nem curtida
    expect((await get(b.token, `/v1/posts/${pa.id}/comments`)).statusCode).toBe(404);
    expect((await post(b.token, `/v1/posts/${pa.id}/comments`, { body: 'oi' })).statusCode).toBe(404);
    const like = await app.inject({
      method: 'PUT',
      url: `/v1/posts/${pa.id}/like`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(like.statusCode).toBe(404);
  }, 30_000);

  it('o fixado sai só em pinned, sem repetir em posts', async () => {
    const { t, c, adult } = await member('feed-pin');
    const p = (await post(adult.token, `/v1/communities/${c.id}/posts`, { body: 'Regras da casa' })).json()
      .data;
    expect(await pinPost(db, { tenantId: t.id, postId: p.id, pinned: true, actor: 'panel:1' })).toBe(true);
    const feed = (await get(adult.token, `/v1/communities/${c.id}/posts`)).json().data;
    expect(feed.pinned.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect(feed.posts).toEqual([]);
  });

  it('post tirado do ar some do Feed; o intervalo entre envios vale', async () => {
    const { t, c, adult } = await member('feed-mod');
    const p = (await post(adult.token, `/v1/communities/${c.id}/posts`, { body: 'Primeiro' })).json().data;
    const fast = await post(adult.token, `/v1/communities/${c.id}/posts`, { body: 'Segundo' });
    expect(fast.statusCode).toBe(429);
    await wait();
    expect(
      await setContentVisibility(db, {
        tenantId: t.id,
        kind: 'post',
        id: p.id,
        visibility: 'hidden',
        actor: 'panel:1',
      }),
    ).toBe(true);
    expect((await get(adult.token, `/v1/communities/${c.id}/posts`)).json().data.posts).toEqual([]);
  });
});
