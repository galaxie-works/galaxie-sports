import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeSanctions,
  applySanction,
  appealJudges,
  blockFan,
  closeCase,
  closeDb,
  createDb,
  decideAppeal,
  eraseModerationContent,
  fileAppeal,
  fileReport,
  galaxieAppealQueue,
  hiddenProfilesFor,
  holdContent,
  listBlocks,
  listQueue,
  purgeModeration,
  readAudit,
  runMigrations,
  sanctionsForFan,
  unblockFan,
  type Database,
  type ModerationClocks,
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
        values (${slug}, ${slug}, 'enterprise', ${['chat']}) returning id`
    )[0]!.id as string;
  tenantId = await tenant('moderacao-a');
  otherTenant = await tenant('moderacao-b');
}, 60_000);

afterAll(async () => {
  await pg?.end();
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

let seq = 0;
async function profile(tenant = tenantId): Promise<{ id: string; accountId: string }> {
  seq += 1;
  const [acc] = await pg`insert into fan.account (tenant_id, external_account_id)
    values (${tenant}, ${`acc_${seq}`}) returning id`;
  const [prof] = await pg`insert into fan.profile
      (tenant_id, account_id, external_profile_id, nickname, age_band, country, locale)
    values (${tenant}, ${acc!.id}, ${`prof_${seq}`}, ${`Torcedor${seq}`}, '18plus', 'BR', 'pt-BR') returning id`;
  return { id: prof!.id as string, accountId: acc!.id as string };
}

const day = 24 * 3600_000;
const clocks = (at = Date.now()): ModerationClocks => ({
  contentPurgeAt: new Date(at + 30 * day),
  decisionPurgeAt: new Date(at + 365 * day),
});
const rules = {
  perHour: 3,
  hideAt: 2,
  hides: true,
  severity: (reasons: string[], reports: number) =>
    (reasons.includes('hate') ? 90 : 30) + Math.min(9, reports - 1),
};
let msg = 0;
const target = (author: string, tenant = tenantId) => {
  msg += 1;
  return {
    tenantId: tenant,
    targetType: 'message',
    targetId: `msg_${msg}`,
    targetProfileId: author,
    module: 'chat',
    room: 'sala-1',
    community: null,
  };
};
const person = (id: string) => ({ id: `user:${id}`, kind: 'person' as const });

describe('fila única da moderação (B8, #953)', () => {
  it('denúncia entra na fila, não repete e oculta com N denunciantes diferentes', async () => {
    const author = await profile();
    const [a, b] = [await profile(), await profile()];
    const t = target(author.id);
    const started = Date.now();
    const r1 = await fileReport(db, {
      ...t,
      reporterProfileId: a.id,
      reason: 'spam',
      note: 'propaganda',
      content: 'compre já',
      clocks: clocks(),
      rules,
    });
    expect(r1).toMatchObject({ ok: true, hidden: false, duplicate: false });
    const queue = await listQueue(db, tenantId, { module: 'chat' });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(queue.find((c) => r1.ok && c.id === r1.caseId)).toMatchObject({
      reportCount: 1,
      content: 'compre já',
    });

    const again = await fileReport(db, {
      ...t,
      reporterProfileId: a.id,
      reason: 'spam',
      note: null,
      content: null,
      clocks: clocks(),
      rules,
    });
    expect(again).toMatchObject({ ok: true, duplicate: true, hidden: false });

    const r2 = await fileReport(db, {
      ...t,
      reporterProfileId: b.id,
      reason: 'hate',
      note: null,
      content: null,
      clocks: clocks(),
      rules,
    });
    expect(r2).toMatchObject({ ok: true, hidden: true, duplicate: false });
    const [c] = (await listQueue(db, tenantId)).filter((x) => r1.ok && x.id === r1.caseId);
    expect(c).toMatchObject({ reportCount: 2, reasons: ['hate', 'spam'], severity: 91 });
    expect(c!.hiddenAt).not.toBeNull();
  });

  it('recusa autodenúncia e denúncia em massa', async () => {
    const author = await profile();
    const rep = await profile();
    expect(
      await fileReport(db, {
        ...target(author.id),
        reporterProfileId: author.id,
        reason: 'spam',
        note: null,
        content: null,
        clocks: clocks(),
        rules,
      }),
    ).toEqual({ ok: false, reason: 'self_report' });
    for (let i = 0; i < 3; i += 1)
      expect(
        (
          await fileReport(db, {
            ...target(author.id),
            reporterProfileId: rep.id,
            reason: 'spam',
            note: null,
            content: null,
            clocks: clocks(),
            rules,
          })
        ).ok,
      ).toBe(true);
    expect(
      await fileReport(db, {
        ...target(author.id),
        reporterProfileId: rep.id,
        reason: 'spam',
        note: null,
        content: null,
        clocks: clocks(),
        rules,
      }),
    ).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('filtro e Cosmos entram na mesma fila, no caso aberto do conteúdo, por gravidade', async () => {
    const author = await profile();
    const t = target(author.id);
    const f = await holdContent(db, {
      ...t,
      source: 'filter',
      reasons: ['betting'],
      severity: 50,
      hide: true,
      content: 'aposte',
      detail: { term: 'aposte' },
      clocks: clocks(),
    });
    const c = await holdContent(db, {
      ...t,
      source: 'cosmos',
      reasons: ['threat'],
      severity: 100,
      hide: false,
      content: 'aposte',
      detail: { score: 0.9 },
      clocks: clocks(),
    });
    expect(c.caseId).toBe(f.caseId);
    const [top] = await listQueue(db, tenantId);
    expect(top).toMatchObject({ id: f.caseId, severity: 100, reasons: ['betting', 'threat'] });
    expect(top!.detail).toMatchObject({ filter: { term: 'aposte' }, cosmos: { score: 0.9 } });
    expect(await listQueue(db, otherTenant)).toEqual([]);
  });

  it('bloqueio vale nos dois sentidos e some ao desbloquear', async () => {
    const [a, b] = [await profile(), await profile()];
    expect(await blockFan(db, { tenantId, blockerProfileId: a.id, blockedProfileId: a.id })).toBe('self');
    expect(await blockFan(db, { tenantId, blockerProfileId: a.id, blockedProfileId: b.id })).toBe('blocked');
    expect(await blockFan(db, { tenantId, blockerProfileId: a.id, blockedProfileId: b.id })).toBe('blocked');
    expect((await listBlocks(db, tenantId, a.id)).map((x) => x.profileId)).toEqual([b.id]);
    expect(await hiddenProfilesFor(db, tenantId, b.id)).toEqual([a.id]);
    const outsider = await profile(otherTenant);
    await expect(
      blockFan(db, { tenantId, blockerProfileId: a.id, blockedProfileId: outsider.id }),
    ).rejects.toThrow();
    expect(await unblockFan(db, { tenantId, blockerProfileId: a.id, blockedProfileId: b.id })).toBe(true);
    expect(await hiddenProfilesFor(db, tenantId, a.id)).toEqual([]);
  });

  it('punição, apelação julgada por outra pessoa e segunda apelação para a Galaxie', async () => {
    const fan = await profile();
    const s = await applySanction(db, {
      tenantId,
      profileId: fan.id,
      accountId: fan.accountId,
      level: 'mute',
      hidden: false,
      scope: 'place',
      scopeId: 'sala-1',
      reason: 'ofensa',
      caseId: null,
      actor: { id: 'cosmos', kind: 'cosmos' },
      endsAt: new Date(Date.now() + day),
      clocks: clocks(),
    });
    expect(
      (await activeSanctions(db, { tenantId, profileId: fan.id, accountId: fan.accountId })).map((x) => x.id),
    ).toEqual([s.id]);
    expect((await sanctionsForFan(db, { tenantId, profileId: fan.id })).map((x) => x.id)).toEqual([s.id]);

    const ap1 = await fileAppeal(db, {
      tenantId,
      profileId: fan.id,
      sanctionId: s.id,
      stage: 1,
      route: 'team',
      statement: 'não fui eu',
      dueAt: new Date(Date.now() + 3 * day),
      clocks: clocks(),
      severity: 40,
    });
    expect(ap1).toMatchObject({ ok: true, route: 'team' });
    expect(
      await fileAppeal(db, {
        tenantId,
        profileId: fan.id,
        sanctionId: s.id,
        stage: 1,
        route: 'team',
        statement: null,
        dueAt: new Date(),
        clocks: clocks(),
        severity: 40,
      }),
    ).toEqual({ ok: false, reason: 'already' });
    const other = await profile();
    expect(
      await fileAppeal(db, {
        tenantId,
        profileId: other.id,
        sanctionId: s.id,
        stage: 1,
        route: 'team',
        statement: null,
        dueAt: new Date(),
        clocks: clocks(),
        severity: 40,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    if (!ap1.ok) throw new Error('apelação');
    expect((await listQueue(db, tenantId, { source: 'appeal' })).map((c) => c.id)).toContain(ap1.caseId);

    // primeira resposta pela Cosmos: mantém
    expect(
      await decideAppeal(db, {
        tenantId,
        appealId: ap1.appealId,
        decision: 'upheld',
        actor: { id: 'cosmos', kind: 'cosmos' },
        note: null,
        clocks: clocks(),
      }),
    ).toBe(true);
    expect(
      await decideAppeal(db, {
        tenantId,
        appealId: ap1.appealId,
        decision: 'overturned',
        actor: person('x'),
        note: null,
        clocks: clocks(),
      }),
    ).toBe(false);

    const ap2 = await fileAppeal(db, {
      tenantId,
      profileId: fan.id,
      sanctionId: s.id,
      stage: 2,
      route: 'galaxie',
      statement: 'revisem',
      dueAt: new Date(Date.now() + 3 * day),
      clocks: clocks(),
      severity: 40,
    });
    if (!ap2.ok) throw new Error('segunda apelação');
    expect((await galaxieAppealQueue(db)).map((a) => a.id)).toContain(ap2.appealId);
    expect((await appealJudges(db, tenantId, s.id)).map((j) => [j.stage, j.decidedBy])).toEqual([
      [1, 'cosmos'],
      [2, null],
    ]);

    expect(
      await decideAppeal(db, {
        tenantId,
        appealId: ap2.appealId,
        decision: 'overturned',
        actor: { id: 'galaxie:ana', kind: 'galaxie' },
        note: 'contexto de brincadeira',
        clocks: clocks(),
      }),
    ).toBe(true);
    expect(await activeSanctions(db, { tenantId, profileId: fan.id, accountId: fan.accountId })).toEqual([]);
    expect((await readAudit(db, tenantId, { subjectProfileId: fan.id })).map((a) => a.action)).toEqual([
      'appeal.decide',
      'appeal',
      'appeal.decide',
      'appeal',
      'sanction',
    ]);
  });

  it('Silêncio oculto não aparece para o torcedor e não aceita apelação', async () => {
    const fan = await profile();
    const s = await applySanction(db, {
      tenantId,
      profileId: fan.id,
      accountId: fan.accountId,
      level: 'mute',
      hidden: true,
      scope: 'place',
      scopeId: 'sala-1',
      reason: 'flood',
      caseId: null,
      actor: person('mod'),
      endsAt: new Date(Date.now() + day),
      clocks: clocks(),
    });
    expect(await sanctionsForFan(db, { tenantId, profileId: fan.id })).toEqual([]);
    expect(await activeSanctions(db, { tenantId, profileId: fan.id, accountId: null })).toHaveLength(1);
    expect(
      await fileAppeal(db, {
        tenantId,
        profileId: fan.id,
        sanctionId: s.id,
        stage: 1,
        route: 'team',
        statement: null,
        dueAt: new Date(),
        clocks: clocks(),
        severity: 40,
      }),
    ).toEqual({ ok: false, reason: 'hidden' });
    // o banco recusa Silêncio oculto decidido pela Cosmos
    await expect(
      applySanction(db, {
        tenantId,
        profileId: fan.id,
        accountId: null,
        level: 'mute',
        hidden: true,
        scope: 'place',
        scopeId: 'sala-1',
        reason: 'x',
        caseId: null,
        actor: { id: 'cosmos', kind: 'cosmos' },
        endsAt: new Date(Date.now() + day),
        clocks: clocks(),
      }),
    ).rejects.toThrow();
  });

  it('auditoria só cresce: UPDATE, DELETE e TRUNCATE fora do expurgo são recusados', async () => {
    const author = await profile();
    await holdContent(db, {
      ...target(author.id),
      source: 'filter',
      reasons: ['hate'],
      severity: 90,
      hide: true,
      content: 'texto',
      detail: null,
      clocks: clocks(),
    });
    const [row] = await readAudit(db, tenantId, { subjectProfileId: author.id });
    await expect(
      pg`update engage.moderation_audit set reason = 'outro' where id = ${row!.id}`,
    ).rejects.toThrow();
    await expect(
      pg`update engage.moderation_audit set content = null where id = ${row!.id}`,
    ).rejects.toThrow();
    await expect(pg`delete from engage.moderation_audit where id = ${row!.id}`).rejects.toThrow();
    await expect(pg`truncate engage.moderation_audit`).rejects.toThrow();
    expect((await readAudit(db, tenantId, { subjectProfileId: author.id }))[0]!.content).toBe('texto');
  });

  it('exclusão do torcedor tira o conteúdo dele na hora, e as decisões ficam', async () => {
    const author = await profile();
    const rep = await profile();
    const t = target(author.id);
    await fileReport(db, {
      ...t,
      reporterProfileId: rep.id,
      reason: 'harassment',
      note: 'me xingou',
      content: 'xingamento',
      clocks: clocks(),
      rules,
    });
    await holdContent(db, {
      ...t,
      source: 'cosmos',
      reasons: ['harassment'],
      severity: 70,
      hide: false,
      content: 'xingamento',
      detail: null,
      clocks: clocks(),
    });
    await blockFan(db, { tenantId, blockerProfileId: rep.id, blockedProfileId: author.id });
    await db.transaction((tx) => eraseModerationContent(tx, tenantId, author.id));
    const [c] = (await listQueue(db, tenantId)).filter((x) => x.targetId === t.targetId);
    expect(c!.content).toBeNull();
    const audit = await readAudit(db, tenantId, { subjectProfileId: author.id });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => a.content === null)).toBe(true);
    expect(await listBlocks(db, tenantId, rep.id)).toEqual([]);
    await db.transaction((tx) => eraseModerationContent(tx, tenantId, rep.id));
    const [note] = await pg`select note from engage.moderation_report where reporter_profile_id = ${rep.id}`;
    expect(note!.note).toBeNull();
  });

  it('expurgo por relógio: conteúdo primeiro, depois a decisão', async () => {
    const author = await profile();
    const at = Date.now() - 400 * day;
    const old = clocks(at);
    const h = await holdContent(db, {
      ...target(author.id),
      source: 'filter',
      reasons: ['spam'],
      severity: 30,
      hide: true,
      content: 'velho',
      detail: null,
      clocks: old,
      now: new Date(at),
    });
    expect(
      await closeCase(db, {
        tenantId,
        caseId: h.caseId,
        status: 'dismissed',
        actor: person('mod'),
        note: null,
        clocks: old,
        now: new Date(at),
      }),
    ).toBe(true);
    const s = await applySanction(db, {
      tenantId,
      profileId: author.id,
      accountId: null,
      level: 'warning',
      hidden: false,
      scope: 'place',
      scopeId: 'sala-1',
      reason: 'spam',
      caseId: h.caseId,
      actor: person('mod'),
      endsAt: null,
      clocks: old,
    });
    await pg`update engage.moderation_sanction set revoked_at = now() where id = ${s.id}`;
    const res = await purgeModeration(db);
    expect(res.cases).toBeGreaterThanOrEqual(1);
    expect(res.sanctions).toBeGreaterThanOrEqual(1);
    expect(res.audit).toBeGreaterThanOrEqual(1);
    expect(await readAudit(db, tenantId, { subjectProfileId: author.id })).toEqual([]);
    expect(await listQueue(db, tenantId, { status: 'dismissed' })).toEqual([]);
  });
});
