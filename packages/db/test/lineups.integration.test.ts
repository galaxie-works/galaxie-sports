import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  availabilityForChannels,
  broadcaster,
  closeDb,
  createDb,
  createLineupReviewRequest,
  dismissLineupChange,
  findOperatorTenantsByEmail,
  getPlatformLineup,
  getTenantOperator,
  LineupError,
  listLineupReviewRequests,
  listPlatforms,
  planChannel,
  platformPlan,
  resolveLineupReviewRequest,
  runMigrations,
  setLineupReviewStatus,
  setTenantOperator,
  tenant,
  upsertLineupDraft,
  type Database,
  type LineupDraftInput,
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
let db: Database;
let tenantId: string;

const SRC = 'https://operadora.exemplo/planos';
const SEEN = new Date('2026-10-20T12:00:00Z');

/** Grade da "Operadora Exemplo": um plano com dois canais e um streaming incluso. */
const draft = (over: Partial<LineupDraftInput> = {}): LineupDraftInput => ({
  platform: {
    name: 'Operadora Exemplo',
    kind: 'pay_tv_operator',
    country: 'BR',
    website: 'https://operadora.exemplo',
    sources: [SRC],
  },
  plans: [
    {
      name: 'Plano Exemplo Esportes',
      priceText: 'R$ 99,90/mês',
      url: `${SRC}/esportes`,
      sources: [`${SRC}/esportes`],
      channels: [
        { channelId: 'canal-exemplo', access: 'included', sources: [`${SRC}/esportes`] },
        { channelId: 'canal-exemplo-2', access: 'addon', sources: [`${SRC}/esportes`] },
        // sem fonte: não entra
        { channelId: 'canal-exemplo-3', sources: [] },
      ],
      services: [{ serviceId: 'streaming-exemplo', sources: [`${SRC}/esportes`] }],
    },
  ],
  seenAt: SEEN,
  ...over,
});

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  const market = {
    name: 'x',
    medium: 'pay_tv' as const,
    accessModel: 'subscription' as const,
    channels: [],
    domains: [],
  };
  await db.insert(broadcaster).values([
    {
      id: 'canal-exemplo',
      name: 'Canal Exemplo',
      kind: 'pay_tv',
      countries: ['BR'],
      markets: { BR: market },
    },
    {
      id: 'canal-exemplo-2',
      name: 'Canal Exemplo 2',
      kind: 'pay_tv',
      countries: ['BR'],
      markets: { BR: market },
    },
    {
      id: 'canal-exemplo-3',
      name: 'Canal Exemplo 3',
      kind: 'pay_tv',
      countries: ['BR'],
      markets: { BR: market },
    },
    {
      id: 'streaming-exemplo',
      name: 'Streaming Exemplo',
      kind: 'streaming',
      countries: ['BR'],
      markets: { BR: { ...market, medium: 'streaming_svod' } },
    },
  ]);
  const [t] = await db
    .insert(tenant)
    .values({
      slug: 'operadora-exemplo',
      name: 'Operadora Exemplo',
      plan: 'fan_experience',
      modules: ['core_data'],
    })
    .returning({ id: tenant.id });
  tenantId = t!.id;
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('grade: pesquisa → rascunho → aprovação', () => {
  let platformId: string;
  let planId: string;

  it('grava como rascunho, só com fonte, e é idempotente', async () => {
    const first = await upsertLineupDraft(db, draft());
    expect(first).toMatchObject({ created: 5, skipped: 1, updated: 0, changes: [] });
    platformId = first.platformId;
    planId = first.planIds['plano-exemplo-esportes']!;

    const again = await upsertLineupDraft(db, draft());
    expect(again).toMatchObject({ platformId, created: 0, updated: 0, unchanged: 5, skipped: 1 });
    expect(again.planIds['plano-exemplo-esportes']).toBe(planId);

    // rascunho não aparece na leitura pública
    expect(await listPlatforms(db, { country: 'BR' })).toEqual([]);
    const drafts = await listPlatforms(db, { country: 'br', minReview: 'draft' });
    expect(drafts.map((p) => [p.slug, p.reviewStatus])).toEqual([['br-operadora-exemplo', 'draft']]);
    expect(drafts[0]!.sources).toEqual([{ url: SRC, seen_at: SEEN.toISOString(), kind: 'research' }]);

    const lineup = await getPlatformLineup(db, platformId, { minReview: 'draft' });
    expect(lineup!.plans).toHaveLength(1);
    expect(lineup!.plans[0]!.channels.map((c) => [c.channelId, c.access])).toEqual([
      ['canal-exemplo', 'included'],
      ['canal-exemplo-2', 'addon'],
    ]);
    expect(lineup!.plans[0]!.services.map((s) => s.serviceId)).toEqual(['streaming-exemplo']);
    expect(await getPlatformLineup(db, platformId)).toBeNull();
  });

  it('plataforma sem fonte não entra', async () => {
    await expect(
      upsertLineupDraft(db, { platform: { ...draft().platform, name: 'Sem Fonte', sources: ['não é url'] } }),
    ).rejects.toThrow(LineupError);
  });

  it('rascunho revisto recebe o dado novo; aprovado vira mudança pendente', async () => {
    const d = draft();
    d.plans![0]!.priceText = 'R$ 89,90/mês';
    const r = await upsertLineupDraft(db, d);
    expect(r.updated).toBe(1);
    const [plan] = await db.select().from(platformPlan).where(eq(platformPlan.id, planId));
    expect(plan).toMatchObject({ priceText: 'R$ 89,90/mês', reviewStatus: 'draft', proposedChange: null });

    for (const t of [
      { type: 'platform' as const, id: platformId },
      { type: 'plan' as const, id: planId },
      { type: 'plan_channel' as const, planId, channelId: 'canal-exemplo' },
      { type: 'plan_service' as const, planId, serviceId: 'streaming-exemplo' },
    ])
      expect(await setLineupReviewStatus(db, t, 'approved', 'wagner')).toBe(true);

    const d2 = draft();
    d2.plans![0]!.priceText = 'R$ 109,90/mês';
    const r2 = await upsertLineupDraft(db, d2);
    expect(r2.changes).toEqual([{ target: { type: 'plan', id: planId }, fields: ['priceText'] }]);
    const [pending] = await db.select().from(platformPlan).where(eq(platformPlan.id, planId));
    expect(pending).toMatchObject({
      priceText: 'R$ 89,90/mês',
      reviewStatus: 'approved',
      proposedChange: { priceText: 'R$ 109,90/mês' },
    });

    // aprovar de novo aplica a mudança pendente
    await setLineupReviewStatus(db, { type: 'plan', id: planId }, 'approved', 'wagner');
    const [applied] = await db.select().from(platformPlan).where(eq(platformPlan.id, planId));
    expect(applied).toMatchObject({
      priceText: 'R$ 109,90/mês',
      reviewStatus: 'approved',
      proposedChange: null,
    });
  });

  it('onde assistir: só o aprovado, com streaming incluso e o próprio streaming', async () => {
    const av = await availabilityForChannels(db, {
      channelIds: ['canal-exemplo-2', 'canal-exemplo', 'streaming-exemplo'],
      country: 'BR',
      at: SEEN,
    });
    expect(av).toHaveLength(1);
    expect(av[0]!.platform.id).toBe(platformId);
    // canal-exemplo-2 ainda é rascunho
    expect(av[0]!.plans[0]).toMatchObject({
      viaChannels: [{ channelId: 'canal-exemplo', access: 'included' }],
      services: [{ serviceId: 'streaming-exemplo', access: 'included' }],
    });

    const withDrafts = await availabilityForChannels(db, {
      channelIds: ['canal-exemplo-2', 'canal-exemplo'],
      country: 'BR',
      minReview: 'draft',
      at: SEEN,
    });
    expect(withDrafts[0]!.plans[0]!.viaChannels.map((v) => v.channelId)).toEqual([
      'canal-exemplo-2',
      'canal-exemplo',
    ]);

    const noStreaming = await availabilityForChannels(db, {
      channelIds: ['streaming-exemplo'],
      country: 'BR',
      includeStreaming: false,
      at: SEEN,
    });
    expect(noStreaming).toEqual([]);

    // a plataforma de streaming que é o próprio serviço
    const s = await upsertLineupDraft(db, {
      platform: {
        name: 'Streaming Exemplo',
        kind: 'streaming',
        country: 'BR',
        broadcasterId: 'streaming-exemplo',
        sources: ['https://streaming.exemplo'],
      },
      plans: [{ name: 'Mensal', priceText: 'R$ 29,90', sources: ['https://streaming.exemplo/planos'] }],
      seenAt: SEEN,
    });
    await setLineupReviewStatus(db, { type: 'platform', id: s.platformId }, 'approved', 'wagner');
    await setLineupReviewStatus(db, { type: 'plan', id: s.planIds.mensal! }, 'approved', 'wagner');
    const both = await availabilityForChannels(db, {
      channelIds: ['streaming-exemplo'],
      country: 'BR',
      at: SEEN,
    });
    expect(both.map((a) => [a.platform.kind, a.plans.map((p) => p.services)])).toEqual([
      ['pay_tv_operator', [[{ serviceId: 'streaming-exemplo', access: 'included' }]]],
      ['streaming', [[{ serviceId: 'streaming-exemplo', access: 'included' }]]],
    ]);

    // cliente operadora que não mostra as outras
    const only = await availabilityForChannels(db, {
      channelIds: ['streaming-exemplo'],
      country: 'BR',
      onlyPlatformId: platformId,
      at: SEEN,
    });
    expect(only.map((a) => a.platform.id)).toEqual([platformId]);
    expect(
      await availabilityForChannels(db, { channelIds: ['canal-exemplo'], country: 'AR', at: SEEN }),
    ).toEqual([]);
  });

  it('plano fora de vigência não aparece', async () => {
    const d = draft();
    d.plans!.push({
      name: 'Plano Antigo',
      validTo: '2025-12-31',
      sources: [`${SRC}/antigo`],
      channels: [{ channelId: 'canal-exemplo', sources: [`${SRC}/antigo`] }],
    });
    const r = await upsertLineupDraft(db, d);
    const oldId = r.planIds['plano-antigo']!;
    await setLineupReviewStatus(db, { type: 'plan', id: oldId }, 'approved', 'wagner');
    await setLineupReviewStatus(
      db,
      { type: 'plan_channel', planId: oldId, channelId: 'canal-exemplo' },
      'approved',
      'w',
    );
    const av = await availabilityForChannels(db, { channelIds: ['canal-exemplo'], country: 'BR', at: SEEN });
    expect(av[0]!.plans.map((p) => p.plan.id)).toEqual([planId]);
  });

  it('revisita completa marca o que sumiu; aprovar a remoção apaga o vínculo', async () => {
    const d = draft({ complete: true });
    d.plans![0]!.priceText = 'R$ 109,90/mês';
    d.plans![0]!.services = [];
    const r = await upsertLineupDraft(db, d);
    expect(r.changes).toContainEqual({
      target: { type: 'plan_service', planId, serviceId: 'streaming-exemplo' },
      fields: ['removed'],
    });
    // o plano antigo (já fora de vigência) não é marcado
    expect(r.changes.filter((c) => c.target.type === 'plan')).toEqual([]);
    const target = { type: 'plan_service' as const, planId, serviceId: 'streaming-exemplo' };
    await setLineupReviewStatus(db, target, 'approved', 'wagner');
    const lineup = await getPlatformLineup(db, platformId);
    expect(lineup!.plans.find((p) => p.plan.id === planId)!.services).toEqual([]);
  });

  it('item rejeitado continua rejeitado; mudança pendente pode ser descartada', async () => {
    const t = { type: 'plan_channel' as const, planId, channelId: 'canal-exemplo-2' };
    await setLineupReviewStatus(db, t, 'rejected', 'wagner');
    await upsertLineupDraft(db, draft());
    const [row] = await db
      .select()
      .from(planChannel)
      .where(and(eq(planChannel.planId, planId), eq(planChannel.channelId, 'canal-exemplo-2')));
    expect(row!.reviewStatus).toBe('rejected');

    const d = draft();
    d.plans![0]!.priceText = 'R$ 109,90/mês';
    d.plans![0]!.channels![0]!.access = 'addon';
    const r = await upsertLineupDraft(db, d);
    expect(r.changes).toEqual([
      { target: { type: 'plan_channel', planId, channelId: 'canal-exemplo' }, fields: ['access'] },
    ]);
    expect(
      await dismissLineupChange(db, { type: 'plan_channel', planId, channelId: 'canal-exemplo' }, 'w'),
    ).toBe(true);
    const [kept] = await db
      .select()
      .from(planChannel)
      .where(and(eq(planChannel.planId, planId), eq(planChannel.channelId, 'canal-exemplo')));
    expect(kept).toMatchObject({ access: 'included', proposedChange: null, reviewStatus: 'approved' });
  });

  it('cliente operadora: liga a plataforma, domínios e pedido de revisão aplicado', async () => {
    await expect(
      createLineupReviewRequest(db, {
        tenantId,
        userId: 'u1',
        target: { type: 'plan', id: planId },
        message: 'O preço mudou',
      }),
    ).rejects.toMatchObject({ code: 'forbidden_target' });

    const op = await setTenantOperator(db, tenantId, {
      platformId,
      showOtherOperators: true,
      emailDomains: ['@Operadora.Exemplo'],
    });
    expect(op).toMatchObject({ platformId, showOtherOperators: true, emailDomains: ['operadora.exemplo'] });
    expect((await getTenantOperator(db, tenantId))!.platform!.id).toBe(platformId);
    expect(await findOperatorTenantsByEmail(db, 'ana@OPERADORA.exemplo')).toEqual([tenantId]);
    expect(await findOperatorTenantsByEmail(db, 'ana@outra.exemplo')).toEqual([]);

    const req = await createLineupReviewRequest(db, {
      tenantId,
      userId: 'u1',
      target: { type: 'plan', id: planId },
      message: '  O preço mudou  ',
      proposed: { priceText: 'R$ 79,90/mês', access: 'addon' },
    });
    expect(req).toMatchObject({ status: 'open', targetType: 'plan', message: 'O preço mudou' });
    expect(req.proposed).toEqual({ priceText: 'R$ 79,90/mês' });

    const add = await createLineupReviewRequest(db, {
      tenantId,
      userId: 'u1',
      target: { type: 'plan_channel', planId, channelId: 'canal-exemplo-3' },
      message: 'Falta este canal',
      proposed: { access: 'included' },
    });
    expect((await listLineupReviewRequests(db, { tenantId, status: 'open' })).map((r) => r.id)).toEqual([
      add.id,
      req.id,
    ]);

    const done = await resolveLineupReviewRequest(db, req.id, {
      status: 'accepted',
      by: 'wagner',
      apply: true,
      note: 'ok',
    });
    expect(done).toMatchObject({ status: 'accepted', resolvedBy: 'wagner', resolutionNote: 'ok' });
    const [plan] = await db.select().from(platformPlan).where(eq(platformPlan.id, planId));
    expect(plan!.priceText).toBe('R$ 79,90/mês');
    expect(plan!.sources[0]).toMatchObject({
      url: null,
      kind: 'operator',
      note: 'informado pela operadora',
      request_id: req.id,
    });

    await resolveLineupReviewRequest(db, add.id, { status: 'accepted', by: 'wagner', apply: true });
    const av = await availabilityForChannels(db, {
      channelIds: ['canal-exemplo-3'],
      country: 'BR',
      at: SEEN,
    });
    expect(av[0]!.plans[0]!.viaChannels).toEqual([{ channelId: 'canal-exemplo-3', access: 'included' }]);

    await expect(
      resolveLineupReviewRequest(db, req.id, { status: 'rejected', by: 'wagner' }),
    ).rejects.toMatchObject({
      code: 'already_resolved',
    });
    expect(await listLineupReviewRequests(db, { status: 'open' })).toEqual([]);

    // desligar a operadora apaga só o vínculo
    expect(await setTenantOperator(db, tenantId, { platformId: null })).toMatchObject({
      platformId: null,
      platform: null,
    });
  });
});
