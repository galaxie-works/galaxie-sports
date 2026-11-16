import { loadCatalog } from '@galaxie/billing';
import { createDb, closeDb, runMigrations, type Database } from '@galaxie/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, type AuthTestDb } from './support/auth-db';

/*
 * Cadastro em autoatendimento (F2 c): o provisionamento cria organização, marca, Dono e chaves uma vez só, por mais
 * vezes que rode; quem está em revisão (PL2) não ganha chave até a equipe aprovar; um trial por domínio de e-mail de
 * empresa; o teto por IP conta o IP do aceite dos termos.
 */

vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule);

let auth: AuthTestDb;
let db: Database;
let provision: typeof import('../src/lib/client/provision');
let guards: typeof import('../src/lib/signup/guards');
const catalog = loadCatalog();

const ORIGIN = 'https://remo.platform.example';

async function user(email: string): Promise<string> {
  const { auth: server } = await import('../src/lib/auth/server');
  const created = await server.api.createUser({
    body: { email, name: email.split('@')[0]!, role: 'client' },
  });
  return created.user.id;
}

const count = async (sql: string, params: unknown[] = []) =>
  (await auth.sql.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]!.n;

beforeAll(async () => {
  auth = await createAuthTestDb();
  await runMigrations(process.env.DEMO_DATABASE_URL!);
  db = createDb(process.env.DEMO_DATABASE_URL!, { max: 2 });
  provision = await import('../src/lib/client/provision');
  guards = await import('../src/lib/signup/guards');
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await auth?.drop();
});

function input(
  owner: { userId: string; email: string },
  extra: Partial<import('../src/lib/client/provision').ProvisionInput['organization']> = {},
): import('../src/lib/client/provision').ProvisionInput {
  return {
    organization: {
      slug: 'clube-do-remo',
      name: 'Clube do Remo',
      country: 'BR',
      currency: 'brl',
      billingEntity: 'ltda',
      capacityTier: 'C1',
      reviewStatus: 'none',
      terms: { version: '2026-11-v1', acceptedBy: owner.userId, ip: '203.0.113.9' },
      ...extra,
    },
    brand: { slug: 'clube-do-remo', name: 'Remo', sports: ['football'], color: '#1e90ff' },
    owner: { ...owner, accepted: true },
    catalog,
    trialDays: 30,
    actor: `signup:${owner.userId}`,
    defaultOrigin: ORIGIN,
    source: 'signup',
    declared: {
      usage: { viewsPerMonth: 100, peakConcurrent: 10, chatWriters: 0 },
      tier: 'C1',
      selfService: true,
    },
  };
}

describe('provisionamento idempotente', () => {
  it('cria organização, marca, Dono e as três chaves; rodar de novo não duplica nem reemite', async () => {
    const owner = { userId: await user('dono@remo.test'), email: 'dono@remo.test' };
    const first = await provision.provisionOrganization(db, input(owner));
    expect(first.organizationCreated).toBe(true);
    expect(first.tenantCreated).toBe(true);
    expect(first.keys.live).toMatch(/^gs_live_/);
    expect(first.keys.test).toMatch(/^gs_test_/);
    expect(first.keys.publishable).toMatch(/^gs_pk_live_/);
    expect(first.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(first.themeCreated).toBe(true);

    const again = await provision.provisionOrganization(db, input(owner));
    expect(again.organizationId).toBe(first.organizationId);
    expect(again.tenantId).toBe(first.tenantId);
    expect(again.organizationCreated).toBe(false);
    expect(again.tenantCreated).toBe(false);
    expect(again.keys).toEqual({ live: null, test: null, publishable: null });
    expect(again.themeCreated).toBe(false);

    expect(await count(`billing.organization where slug = 'clube-do-remo'`)).toBe(1);
    expect(await count(`api.tenant where slug = 'clube-do-remo'`)).toBe(1);
    expect(await count(`api.tenant_member where tenant_id = $1`, [first.tenantId])).toBe(1);
    expect(
      await count(`billing.organization_member where organization_id = $1`, [first.organizationId]),
    ).toBe(1);
    expect(await count(`api.api_key where tenant_id = $1`, [first.tenantId])).toBe(2);
    expect(await count(`ops.publishable_key where tenant_id = $1`, [first.tenantId])).toBe(1);
    expect(await count(`ops.widget_theme where tenant_id = $1`, [first.tenantId])).toBe(1);
    const feed = await auth.sql.query(
      `select payload from ops.change_feed where topic = 'tenant.provisioned' and entity_id = $1`,
      [first.tenantId],
    );
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0]!.payload).toMatchObject({ source: 'signup', declared: { tier: 'C1' } });
    expect(await count(`api.api_key_event where tenant_id = $1`, [first.tenantId])).toBe(3);

    const { rows } = await auth.sql.query(
      `select t.plan, t.modules, t.markets, t.capacity_tier, t.catalog_version, t.organization_id,
              o.capacity_tier as org_tier, o.terms_version, o.terms_accepted_ip, o.created_by
         from api.tenant t join billing.organization o on o.id = t.organization_id where t.id = $1`,
      [first.tenantId],
    );
    expect(rows[0]).toMatchObject({
      plan: 'fan_experience',
      modules: ['core_data', 'where_to_watch', 'semantic'],
      markets: ['BR'],
      capacity_tier: null,
      catalog_version: catalog.version,
      org_tier: 'C1',
      terms_version: '2026-11-v1',
      terms_accepted_ip: '203.0.113.9',
      created_by: `signup:${owner.userId}`,
    });
  });

  it('o slug de outra organização não é tomado por quem não é Dono dela', async () => {
    const intruder = { userId: await user('outro@invasor.test'), email: 'outro@invasor.test' };
    await expect(provision.provisionOrganization(db, input(intruder))).rejects.toMatchObject({
      code: 'organizationSlugTaken',
    });
  });

  it('em revisão (e-mail grátis, PL2) nada de produção nasce; aprovar emite as chaves que faltam', async () => {
    const owner = { userId: await user('pessoa@gmail.com'), email: 'pessoa@gmail.com' };
    const pending = await provision.provisionOrganization(db, {
      ...input(owner, { slug: 'pessoal', reviewStatus: 'pending' }),
      brand: { slug: 'pessoal', name: 'Pessoal' },
    });
    expect(pending.reviewStatus).toBe('pending');
    expect(pending.keys).toEqual({ live: null, test: null, publishable: null });
    expect(await count(`api.api_key where tenant_id = $1`, [pending.tenantId])).toBe(0);

    await auth.sql.query(`update billing.organization set review_status = 'approved' where id = $1`, [
      pending.organizationId,
    ]);
    const brands = await provision.listOrganizationBrands(db, pending.organizationId);
    expect(brands.map((b) => b.slug)).toEqual(['pessoal']);
    const keys = await provision.issueMissingKeys(db, {
      tenantId: pending.tenantId,
      actor: 'galaxie:staff',
      defaultOrigin: ORIGIN,
    });
    expect(keys.live).toMatch(/^gs_live_/);
    expect(keys.publishable).toMatch(/^gs_pk_live_/);
    const again = await provision.issueMissingKeys(db, {
      tenantId: pending.tenantId,
      actor: 'galaxie:staff',
      defaultOrigin: ORIGIN,
    });
    expect(again).toEqual({ live: null, test: null, publishable: null });
    expect(await count(`api.api_key where tenant_id = $1`, [pending.tenantId])).toBe(2);
  });

  it('Dono convidado pela equipe nasce com convite pendente e prazo', async () => {
    const owner = { userId: await user('dono@assistido.test'), email: 'dono@assistido.test' };
    const r = await provision.provisionOrganization(db, {
      ...input(owner, { slug: 'assistido', terms: null }),
      brand: { slug: 'assistido', name: 'Assistido' },
      owner: { ...owner, accepted: false },
      actor: 'galaxie:staff',
    });
    const { rows } = await auth.sql.query(
      `select accepted_at, invite_expires_at from api.tenant_member where tenant_id = $1`,
      [r.tenantId],
    );
    expect(rows[0]!.accepted_at).toBeNull();
    expect(rows[0]!.invite_expires_at).not.toBeNull();
    const org = await auth.sql.query(
      `select terms_version, terms_accepted_at from billing.organization where id = $1`,
      [r.organizationId],
    );
    expect(org.rows[0]).toEqual({ terms_version: null, terms_accepted_at: null });
  });
});

describe('travas antiabuso do cadastro', () => {
  it('um trial por domínio de e-mail de empresa; vencido o trial, libera', async () => {
    expect(await guards.findTrialOrganizationForDomain('remo.test')).toMatchObject({ name: 'Clube do Remo' });
    expect(await guards.findTrialOrganizationForDomain('outra.test')).toBeNull();
    await auth.sql.query(
      `update api.tenant set trial_ends_at = now() - interval '1 day' where slug = 'clube-do-remo'`,
    );
    expect(await guards.findTrialOrganizationForDomain('remo.test')).toBeNull();
  });

  it('conta as organizações do IP nas últimas 24 h e sabe quem já tem cargo', async () => {
    expect(await guards.countOrganizationsFromIp('203.0.113.9')).toBe(2);
    expect(await guards.countOrganizationsFromIp('198.51.100.1')).toBe(0);
    const { rows } = await auth.sql.query<{ id: string }>(
      `select id from "user" where email = 'dono@remo.test'`,
    );
    expect(await guards.hasAnyMembership(rows[0]!.id)).toBe(true);
    expect(await guards.hasAnyMembership('ninguem')).toBe(false);
  });
});
