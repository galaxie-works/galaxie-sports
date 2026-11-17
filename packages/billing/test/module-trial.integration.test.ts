import { changeFeed, moduleTrial, organization, tenant, tenantOverride, type Database } from '@galaxie/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  entitlements,
  loadCatalog,
  MODULE_TRIAL_REASON,
  MODULE_TRIAL_STARTED_TOPIC,
  ModuleTrialError,
  startModuleTrial,
  storeView,
} from '../src/index.js';
import { createTempDb, type TempDb } from './test-db.js';

/*
 * F3, decisão 9: o teste por módulo grava `billing.module_trial`, o `module_grant` e um `tier` por faixa com o mínimo
 * numa transação; é uma vez por organização e módulo (duas ativações ao mesmo tempo: uma passa, a outra recebe
 * `already_used`, e o override nunca duplica); publica `tenant.module_trial_started`; os direitos passam a mostrar o
 * módulo em teste com o prazo, e a loja distingue o módulo em teste do incluído.
 */

let temp: TempDb;
let db: Database;
const catalog = loadCatalog();
const now = new Date('2026-11-16T12:00:00Z');

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});
afterAll(async () => {
  await temp?.close();
});

async function newOrganization(slug: string) {
  const [o] = await db
    .insert(organization)
    .values({ slug, name: slug, country: 'BR', currency: 'brl', billingEntity: 'ltda', createdBy: 'test' })
    .returning({ id: organization.id });
  return o!.id;
}

async function newTenant(slug: string, organizationId: string, state: 'active' | 'trial' = 'active') {
  const [t] = await db
    .insert(tenant)
    .values({
      slug,
      name: slug,
      plan: 'fan_experience',
      modules: ['core_data', 'where_to_watch', 'semantic'],
      organizationId,
      state,
      trialEndsAt: state === 'trial' ? new Date('2026-12-16T12:00:00Z') : null,
    })
    .returning({ id: tenant.id });
  return t!.id;
}

const overridesOf = (tenantId: string) =>
  db
    .select({
      kind: tenantOverride.kind,
      key: tenantOverride.key,
      value: tenantOverride.value,
      reason: tenantOverride.reason,
      validUntil: tenantOverride.validUntil,
      grantedBy: tenantOverride.grantedBy,
    })
    .from(tenantOverride)
    .where(eq(tenantOverride.tenantId, tenantId))
    .orderBy(tenantOverride.kind, tenantOverride.key);

describe('startModuleTrial', () => {
  it('grava o registro, o module_grant e as faixas mínimas numa transação e publica o evento', async () => {
    const org = await newOrganization('org-teste-a');
    const id = await newTenant('teste-a', org);
    const started = await startModuleTrial(db, catalog, {
      tenantId: id,
      organizationId: org,
      module: 'live_chat',
      actor: 'panel:u1',
      now,
    });
    const endsAt = new Date('2026-11-30T12:00:00Z');
    expect(started).toMatchObject({ module: 'live_chat', trialDays: 14, startedAt: now, endsAt });
    expect(started.overrideIds).toHaveLength(2);

    expect(await overridesOf(id)).toEqual([
      {
        kind: 'module_grant',
        key: 'live_chat',
        value: null,
        reason: MODULE_TRIAL_REASON,
        validUntil: endsAt,
        grantedBy: 'panel:u1',
      },
      {
        kind: 'tier',
        key: 'live_chat.peak_connections',
        value: catalog.modules.live_chat.tiers['live_chat.peak_connections']!.min,
        reason: MODULE_TRIAL_REASON,
        validUntil: endsAt,
        grantedBy: 'panel:u1',
      },
    ]);
    const rows = await db
      .select({ module: moduleTrial.module, startedBy: moduleTrial.startedBy, endsAt: moduleTrial.endsAt })
      .from(moduleTrial)
      .where(eq(moduleTrial.organizationId, org));
    expect(rows).toEqual([{ module: 'live_chat', startedBy: 'panel:u1', endsAt }]);
    const published = await db
      .select({ topic: changeFeed.topic, payload: changeFeed.payload })
      .from(changeFeed)
      .where(sql`${changeFeed.entityType} = 'tenant' and ${changeFeed.entityId} = ${id}`);
    expect(published).toEqual([
      {
        topic: MODULE_TRIAL_STARTED_TOPIC,
        payload: expect.objectContaining({ module: 'live_chat', ends_at: endsAt.toISOString() }),
      },
    ]);

    // direitos: o módulo entra em teste, com a faixa mínima e o prazo; a loja mostra o prazo
    const ent = (await entitlements({ db, catalog, now: () => now }, id))!;
    expect(ent.modules).toContain('live_chat');
    expect(ent.tiers['live_chat.peak_connections']).toBe(5000);
    expect(ent.moduleTrials).toEqual({ live_chat: endsAt.toISOString() });
    const card = storeView(catalog, ent).find((i) => i.module === 'live_chat');
    expect(card).toMatchObject({ state: 'trial', trialEndsAt: endsAt.toISOString() });
    // depois do prazo, o módulo sai sozinho (sem job): o override e o registro vencem juntos
    const after = (await entitlements({ db, catalog, now: () => new Date('2026-12-01T00:00:00Z') }, id))!;
    expect(after.modules).not.toContain('live_chat');
    expect(after.moduleTrials).toEqual({});
  });

  it('uma vez por organização e módulo: duas ativações ao mesmo tempo, uma passa e a outra recebe already_used', async () => {
    const org = await newOrganization('org-teste-b');
    const a = await newTenant('teste-b1', org);
    const b = await newTenant('teste-b2', org);
    const input = (tenantId: string) => ({
      tenantId,
      organizationId: org,
      module: 'communities' as const,
      actor: 'panel:u2',
      now,
    });
    const results = await Promise.allSettled([
      startModuleTrial(db, catalog, input(a)),
      startModuleTrial(db, catalog, input(b)),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const err = (failed[0] as PromiseRejectedResult).reason as ModuleTrialError;
    expect(err).toBeInstanceOf(ModuleTrialError);
    expect(err.code).toBe('already_used');

    // um registro só, e os overrides só da marca que passou: nada duplicado, nada órfão
    const rows = await db
      .select({ tenantId: moduleTrial.tenantId })
      .from(moduleTrial)
      .where(eq(moduleTrial.organizationId, org));
    expect(rows).toHaveLength(1);
    const winner = rows[0]!.tenantId;
    const loser = winner === a ? b : a;
    expect(await overridesOf(winner)).toHaveLength(2);
    expect(await overridesOf(loser)).toHaveLength(0);

    // repetir depois, em qualquer marca da organização, recebe o mesmo erro
    await expect(startModuleTrial(db, catalog, input(loser))).rejects.toMatchObject({ code: 'already_used' });
    await expect(startModuleTrial(db, catalog, input(winner))).rejects.toMatchObject({
      code: 'already_used',
    });
  });

  it('módulo sem teste no catálogo ou desconhecido: erro antes de tocar no banco', async () => {
    const org = await newOrganization('org-teste-c');
    const id = await newTenant('teste-c', org);
    await expect(
      startModuleTrial(db, catalog, {
        tenantId: id,
        organizationId: org,
        module: 'cosmos_ai',
        actor: 'panel:u3',
      }),
    ).rejects.toMatchObject({ code: 'no_trial' });
    await expect(
      startModuleTrial(db, catalog, { tenantId: id, organizationId: org, module: 'nope', actor: 'panel:u3' }),
    ).rejects.toMatchObject({ code: 'unknown_module' });
    expect(await overridesOf(id)).toHaveLength(0);
  });
});
