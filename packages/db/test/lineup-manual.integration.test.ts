import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  broadcaster,
  changeFeed,
  closeDb,
  createDb,
  createManualLineupItem,
  getPlatformLineup,
  LineupError,
  listLogoUploads,
  planChannel,
  platform,
  platformPlan,
  proposeManualLineupEdit,
  revertCustomLogo,
  runMigrations,
  setCustomLogo,
  setLineupReviewStatus,
  upsertLineupDraft,
  type Database,
  type LineupDraftInput,
} from '../src/index.js';

/*
 * Edição manual da grade no painel (Ajustes → Grades e ofertas): passa pela revisão (fica pendente até
 * aprovar), fica registrada (quem e quando) e a pesquisa seguinte não sobrescreve o campo editado. Contra um
 * Postgres descartável com as migrations reais. Nomes genéricos.
 */

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

const SRC = 'https://operadora.exemplo/planos';
const ADMIN = 'admin@exemplo.test';

/** Pesquisa da "Operadora Exemplo": um plano com dois canais. */
const research = (over: { price?: string; name?: string; access?: 'included' | 'addon' } = {}) =>
  ({
    platform: {
      name: 'Operadora Exemplo',
      kind: 'pay_tv_operator',
      country: 'BR',
      website: 'https://operadora.exemplo',
      sources: [SRC],
    },
    plans: [
      {
        name: 'Plano Exemplo',
        priceText: over.price ?? 'R$ 99,90/mês',
        url: `${SRC}/exemplo`,
        sources: [`${SRC}/exemplo`],
        channels: [
          { channelId: 'canal-exemplo', access: over.access ?? 'included', sources: [`${SRC}/exemplo`] },
          { channelId: 'canal-exemplo-2', access: 'included', sources: [`${SRC}/exemplo`] },
        ],
      },
    ],
    complete: true,
  }) satisfies LineupDraftInput;

let platformId: string;
let planId: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  await db.insert(broadcaster).values(
    ['canal-exemplo', 'canal-exemplo-2', 'canal-exemplo-3'].map((id) => ({
      id,
      name: id,
      kind: 'pay_tv' as const,
      countries: ['BR'],
      markets: {},
    })),
  );
  const r = await upsertLineupDraft(db, research());
  platformId = r.platformId;
  planId = r.planIds['plano-exemplo']!;
  for (const target of [
    { type: 'platform' as const, id: platformId },
    { type: 'plan' as const, id: planId },
    { type: 'plan_channel' as const, planId, channelId: 'canal-exemplo' },
    { type: 'plan_channel' as const, planId, channelId: 'canal-exemplo-2' },
  ])
    await setLineupReviewStatus(db, target, 'approved', 'revisor@exemplo.test');
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const plan = async () => (await db.select().from(platformPlan).where(eq(platformPlan.id, planId)))[0]!;
const link = async (channelId: string) =>
  (
    await db
      .select()
      .from(planChannel)
      .where(and(eq(planChannel.planId, planId), eq(planChannel.channelId, channelId)))
  )[0];

describe('edição manual da grade', () => {
  it('fica pendente até aprovar; aprovar aplica e registra quem editou e quando', async () => {
    const at = new Date('2026-10-25T10:00:00Z');
    const ok = await proposeManualLineupEdit(
      db,
      { type: 'plan', id: planId },
      {
        fields: {
          priceText: 'R$ 119,90/mês',
          priceAmount: 119.9,
          priceCurrency: 'brl',
          name: 'Plano Exemplo',
        },
        sourceUrl: 'https://operadora.exemplo/tabela-de-precos',
        by: ADMIN,
        at,
      },
    );
    expect(ok).toBe(true);
    let p = await plan();
    // o aprovado segue no ar (a API não vê a edição antes da aprovação)
    expect(p.priceText).toBe('R$ 99,90/mês');
    // o nome igual ao atual não entra na mudança
    expect(p.proposedChange).toMatchObject({
      priceText: 'R$ 119,90/mês',
      priceAmount: 119.9,
      priceCurrency: 'BRL',
      manual: { by: ADMIN, at: at.toISOString() },
    });
    expect(p.proposedChange).not.toHaveProperty('name');

    expect(
      await setLineupReviewStatus(db, { type: 'plan', id: planId }, 'approved', 'revisor@exemplo.test'),
    ).toBe(true);
    p = await plan();
    expect(p).toMatchObject({
      priceText: 'R$ 119,90/mês',
      priceAmount: 119.9,
      priceCurrency: 'BRL',
      reviewStatus: 'approved',
      reviewedBy: 'revisor@exemplo.test',
      proposedChange: null,
    });
    expect(p.manualFields).toEqual({
      priceText: { by: ADMIN, at: at.toISOString() },
      priceAmount: { by: ADMIN, at: at.toISOString() },
      priceCurrency: { by: ADMIN, at: at.toISOString() },
    });
    expect(p.sources).toContainEqual(
      expect.objectContaining({ url: 'https://operadora.exemplo/tabela-de-precos', kind: 'editorial' }),
    );
  });

  it('a pesquisa seguinte não sobrescreve o campo editado à mão (nem propõe mudança nele)', async () => {
    const r = await upsertLineupDraft(db, research({ price: 'R$ 89,90/mês' }));
    const p = await plan();
    expect(p.priceText).toBe('R$ 119,90/mês');
    expect(p.proposedChange).toBeNull();
    expect(r.changes.filter((c) => c.target.type === 'plan')).toEqual([]);
  });

  it('a pesquisa ainda propõe mudança nos campos que não foram editados à mão', async () => {
    await upsertLineupDraft(db, research({ access: 'addon' }));
    expect((await link('canal-exemplo'))!.proposedChange).toMatchObject({ access: 'addon' });
    await setLineupReviewStatus(
      db,
      { type: 'plan_channel', planId, channelId: 'canal-exemplo' },
      'approved',
      'revisor@exemplo.test',
    );
    expect((await link('canal-exemplo'))!.access).toBe('addon');
  });

  it('no rascunho, a pesquisa também respeita o campo editado à mão', async () => {
    await setLineupReviewStatus(db, { type: 'plan', id: planId }, 'draft', 'revisor@exemplo.test');
    await upsertLineupDraft(db, research({ price: 'R$ 79,90/mês' }));
    expect((await plan()).priceText).toBe('R$ 119,90/mês');
    await setLineupReviewStatus(db, { type: 'plan', id: planId }, 'approved', 'revisor@exemplo.test');
  });

  it('edição manual pendente não é atropelada pela pesquisa', async () => {
    await proposeManualLineupEdit(
      db,
      { type: 'plan', id: planId },
      { fields: { url: `${SRC}/novo` }, by: ADMIN },
    );
    await upsertLineupDraft(db, research());
    expect((await plan()).proposedChange).toMatchObject({ url: `${SRC}/novo`, manual: { by: ADMIN } });
    await setLineupReviewStatus(db, { type: 'plan', id: planId }, 'approved', 'revisor@exemplo.test');
    expect((await plan()).url).toBe(`${SRC}/novo`);
  });

  it('tirar um canal do plano: sai da leitura pública e a pesquisa não o traz de volta', async () => {
    const target = { type: 'plan_channel' as const, planId, channelId: 'canal-exemplo-2' };
    expect(await proposeManualLineupEdit(db, target, { removed: true, by: ADMIN })).toBe(true);
    await setLineupReviewStatus(db, target, 'approved', 'revisor@exemplo.test');
    const removed = (await link('canal-exemplo-2'))!;
    expect(removed.reviewStatus).toBe('rejected');
    expect(removed.manualFields.removed).toMatchObject({ by: ADMIN });

    await upsertLineupDraft(db, research());
    expect((await link('canal-exemplo-2'))!.reviewStatus).toBe('rejected');
    const published = await getPlatformLineup(db, platformId);
    expect(published!.plans[0]!.channels.map((c) => c.channelId)).toEqual(['canal-exemplo']);
  });

  it('só vínculo sai do plano pela edição manual', async () => {
    await expect(
      proposeManualLineupEdit(db, { type: 'plan', id: planId }, { removed: true, by: ADMIN }),
    ).rejects.toBeInstanceOf(LineupError);
  });

  it('item criado à mão entra como rascunho, marcado, e a pesquisa completa não o marca como "não visto"', async () => {
    const target = await createManualLineupItem(
      db,
      { type: 'plan_channel', planId, refId: 'canal-exemplo-3', access: 'included' },
      { by: ADMIN, sourceUrl: `${SRC}/exemplo` },
    );
    expect(target).toEqual({ type: 'plan_channel', planId, channelId: 'canal-exemplo-3' });
    const created = (await link('canal-exemplo-3'))!;
    expect(created.reviewStatus).toBe('draft');
    expect(Object.keys(created.manualFields).sort()).toEqual(['access', 'created']);

    await upsertLineupDraft(db, research());
    expect((await link('canal-exemplo-3'))!.proposedChange).toBeNull();

    const plan2 = await createManualLineupItem(
      db,
      { type: 'plan', platformId, name: 'Plano Manual', priceAmount: 50, priceCurrency: 'BRL' },
      { by: ADMIN },
    );
    expect(plan2.type).toBe('plan');
    await expect(
      createManualLineupItem(db, { type: 'plan', platformId, name: 'Plano Manual' }, { by: ADMIN }),
    ).rejects.toThrow(/já existe/);
    await expect(
      createManualLineupItem(
        db,
        { type: 'plan', platformId, name: 'Sem moeda', priceAmount: 10 },
        { by: ADMIN },
      ),
    ).rejects.toThrow(/moeda/);
  });
});

describe('logo enviado no painel', () => {
  const file = (sha: string) => ({
    storageKey: `broadcasters/${sha.slice(0, 16)}.svg`,
    sha256: sha,
    contentType: 'image/svg+xml' as const,
    bytes: 120,
    width: 64,
    height: 64,
  });

  it('liga o logo no custom_logo_asset_id, guarda o anterior, publica no change feed e volta', async () => {
    const target = { type: 'broadcaster' as const, id: 'canal-exemplo' };
    const before = await db.select({ id: changeFeed.id }).from(changeFeed);
    const first = await setCustomLogo(db, target, file('a'.repeat(64)), ADMIN);
    expect(first.previousAssetId).toBeNull();
    const second = await setCustomLogo(db, target, file('b'.repeat(64)), ADMIN);
    expect(second.previousAssetId).toBe(first.assetId);

    const [b] = await db.select().from(broadcaster).where(eq(broadcaster.id, 'canal-exemplo'));
    expect(b!.customLogoAssetId).toBe(second.assetId);
    const [a] = await db.select().from(asset).where(eq(asset.id, second.assetId));
    expect(a).toMatchObject({
      kind: 'broadcaster_logo',
      sourceUrl: `painel://broadcaster/canal-exemplo/${'b'.repeat(16)}`,
      storageKey: `broadcasters/${'b'.repeat(16)}.svg`,
    });
    const feed = await db.select().from(changeFeed);
    expect(feed.length).toBeGreaterThan(before.length);
    expect(feed.at(-1)).toMatchObject({ entityType: 'broadcaster', entityId: 'canal-exemplo' });

    expect(await revertCustomLogo(db, target, ADMIN)).toBe(true);
    const [back] = await db.select().from(broadcaster).where(eq(broadcaster.id, 'canal-exemplo'));
    expect(back!.customLogoAssetId).toBe(first.assetId);
    const history = await listLogoUploads(db, target);
    expect(history).toHaveLength(2);
    expect(history[0]!.revertedBy).toBe(ADMIN);
  });

  it('plataforma: liga o logo e o trigger da grade publica a plataforma', async () => {
    const res = await setCustomLogo(db, { type: 'platform', id: platformId }, file('c'.repeat(64)), ADMIN);
    const [p] = await db.select().from(platform).where(eq(platform.id, platformId));
    expect(p!.customLogoAssetId).toBe(res.assetId);
    const feed = await db.select().from(changeFeed).where(eq(changeFeed.entityId, platformId));
    expect(feed.some((f) => f.topic === 'lineup')).toBe(true);
  });

  it('alvo inexistente: erro', async () => {
    await expect(
      setCustomLogo(db, { type: 'broadcaster', id: 'nao-existe' }, file('d'.repeat(64)), ADMIN),
    ).rejects.toBeInstanceOf(LineupError);
  });
});
