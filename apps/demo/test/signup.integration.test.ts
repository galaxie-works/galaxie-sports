import { loadCatalog } from '@galaxie/billing';
import { createDb, closeDb, runMigrations, type Database } from '@galaxie/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, fakeSmtp, sentMails, signInAs, type AuthTestDb } from './support/auth-db';

/*
 * Cadastro em autoatendimento (F2 c): o provisionamento cria organização, marca, Dono e chaves uma vez só, por mais
 * vezes que rode; as três chaves nascem juntas ou nenhuma; quem está em revisão (PL2) não ganha chave até a equipe
 * aprovar (e a aprovação que falhou no meio emite ao repetir); um trial por domínio de e-mail de empresa, conferido
 * de novo na hora de provisionar; o teto por IP conta o IP do aceite dos termos.
 */

vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule);
const request = vi.hoisted(() => ({ cookie: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: request.cookie }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/root-params', () => ({ locale: async () => 'pt-BR' }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

let auth: AuthTestDb;
let db: Database;
let provision: typeof import('../src/lib/client/provision');
let guards: typeof import('../src/lib/signup/guards');
let staff: typeof import('../src/app/[locale]/(app)/settings/organizations/actions');
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
  staff = await import('../src/app/[locale]/(app)/settings/organizations/actions');
  request.cookie = await signInAs('admin@galaxie.test', 'admin');
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await auth?.drop();
});

type Input = import('../src/lib/client/provision').ProvisionInput;

function input(owner: { userId: string; email: string }, extra: Partial<Input['organization']> = {}): Input {
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

/** Organização em revisão para os testes de aprovação: nasce sem chave. */
async function pendingOrganization(slug: string, email: string) {
  const owner = { userId: await user(email), email };
  const r = await provision.provisionOrganization(db, {
    ...input(owner, { slug, reviewStatus: 'pending' }),
    brand: { slug, name: slug },
  });
  expect(r.keys).toEqual({ live: null, test: null, publishable: null });
  expect(await count(`api.api_key where tenant_id = $1`, [r.tenantId])).toBe(0);
  return r;
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
    // F3: o widget de exemplo segue o tema da marca, e as boas-vindas saem para o Dono, no idioma da organização
    expect(first.sampleWidgetCreated).toBe(true);
    expect(first.welcomeSent).toBe(true);
    const welcome = sentMails.filter((m) => m.to.includes('dono@remo.test'));
    expect(welcome).toHaveLength(1);
    expect(welcome[0]!.subject).toBe('Bem-vindo(a) à Galaxie Sports: Remo está pronta');
    expect(welcome[0]!.text).toContain('Primeira chamada');

    const again = await provision.provisionOrganization(db, input(owner));
    expect(again.organizationId).toBe(first.organizationId);
    expect(again.tenantId).toBe(first.tenantId);
    expect(again.organizationCreated).toBe(false);
    expect(again.tenantCreated).toBe(false);
    expect(again.keys).toEqual({ live: null, test: null, publishable: null });
    expect(again.themeCreated).toBe(false);
    expect(again.sampleWidgetCreated).toBe(false);
    expect(again.welcomeSent).toBe(false);
    expect(sentMails.filter((m) => m.to.includes('dono@remo.test'))).toHaveLength(1);

    expect(await count(`billing.organization where slug = 'clube-do-remo'`)).toBe(1);
    expect(await count(`api.tenant where slug = 'clube-do-remo'`)).toBe(1);
    expect(await count(`api.tenant_member where tenant_id = $1`, [first.tenantId])).toBe(1);
    expect(
      await count(`billing.organization_member where organization_id = $1`, [first.organizationId]),
    ).toBe(1);
    expect(await count(`api.api_key where tenant_id = $1`, [first.tenantId])).toBe(2);
    expect(await count(`ops.publishable_key where tenant_id = $1`, [first.tenantId])).toBe(1);
    expect(await count(`api.api_key_event where tenant_id = $1`, [first.tenantId])).toBe(3);
    expect(await count(`ops.widget_theme where tenant_id = $1`, [first.tenantId])).toBe(1);
    const widgets = await auth.sql.query<{
      kind: string;
      name: string;
      config: { brandThemeId?: string; locale: string; market: string };
    }>(`select kind, name, config from ops.widget where tenant_id = $1 and archived_at is null`, [
      first.tenantId,
    ]);
    expect(widgets.rows).toHaveLength(1);
    expect(widgets.rows[0]).toMatchObject({ kind: 'live_list', name: 'Placar do dia' });
    expect(widgets.rows[0]!.config).toMatchObject({ locale: 'pt-BR', market: 'BR' });
    expect(widgets.rows[0]!.config.brandThemeId).toMatch(/^[0-9a-f-]{36}$/);
    const notified = await auth.sql.query<{ kind: string; recipients: string[]; sent_at: Date | null }>(
      `select kind, recipients, sent_at from billing.tenant_notification where tenant_id = $1`,
      [first.tenantId],
    );
    expect(notified.rows).toEqual([
      { kind: 'welcome', recipients: ['dono@remo.test'], sent_at: expect.any(Date) },
    ]);
    const feed = await auth.sql.query(
      `select payload from ops.change_feed where topic = 'tenant.provisioned' and entity_id = $1`,
      [first.tenantId],
    );
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0]!.payload).toMatchObject({ source: 'signup', declared: { tier: 'C1' } });

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

  it('um trial por domínio de empresa, conferido na hora de provisionar: a segunda pessoa do domínio não passa', async () => {
    const colleague = { userId: await user('colega@remo.test'), email: 'colega@remo.test' };
    await expect(
      provision.provisionOrganization(db, {
        ...input(colleague, { slug: 'remo-dois' }),
        brand: { slug: 'remo-dois', name: 'Remo 2' },
      }),
    ).rejects.toMatchObject({ code: 'domainInTrial', organizationName: 'Clube do Remo' });
    expect(await count(`billing.organization where slug = 'remo-dois'`)).toBe(0);
    // e-mail grátis não entra na regra; a criação pela equipe também não
    const free = { userId: await user('alguem@gmail.com'), email: 'alguem@gmail.com' };
    const r = await provision.provisionOrganization(db, {
      ...input(free, { slug: 'livre', reviewStatus: 'pending' }),
      brand: { slug: 'livre', name: 'Livre' },
    });
    expect(r.organizationCreated).toBe(true);
    const assisted = { userId: await user('outro@remo.test'), email: 'outro@remo.test' };
    const s = await provision.provisionOrganization(db, {
      ...input(assisted, { slug: 'remo-assistido' }),
      brand: { slug: 'remo-assistido', name: 'Remo assistido' },
      owner: { ...assisted, accepted: false },
      actor: 'galaxie:staff',
      source: 'staff',
    });
    expect(s.organizationCreated).toBe(true);
  });

  it('o slug de outra organização não é tomado por quem não é Dono dela', async () => {
    const intruder = { userId: await user('outro@invasor.test'), email: 'outro@invasor.test' };
    await expect(provision.provisionOrganization(db, input(intruder))).rejects.toMatchObject({
      code: 'organizationSlugTaken',
    });
  });

  it('as três chaves nascem juntas ou nenhuma: falhou a publicável, as secretas não ficam gravadas', async () => {
    const r = await pendingOrganization('atomico', 'dono@atomico.test');
    await expect(
      provision.issueMissingKeys(db, {
        tenantId: r.tenantId,
        actor: 'galaxie:staff',
        defaultOrigin: 'nao e origem',
      }),
    ).rejects.toThrow(/Origem padrão inválida/);
    expect(await count(`api.api_key where tenant_id = $1`, [r.tenantId])).toBe(0);
    expect(await count(`api.api_key_event where tenant_id = $1`, [r.tenantId])).toBe(0);
    // a repetição emite as três, com o texto de todas
    const keys = await provision.issueMissingKeys(db, {
      tenantId: r.tenantId,
      actor: 'galaxie:staff',
      defaultOrigin: ORIGIN,
    });
    expect(keys.live).toMatch(/^gs_live_/);
    expect(keys.test).toMatch(/^gs_test_/);
    expect(keys.publishable).toMatch(/^gs_pk_live_/);
    expect(await count(`api.api_key where tenant_id = $1`, [r.tenantId])).toBe(2);
    expect(await count(`ops.publishable_key where tenant_id = $1`, [r.tenantId])).toBe(1);
  });

  it('em revisão (e-mail grátis, PL2) nada de produção nasce; aprovar em Ajustes emite as chaves que faltam', async () => {
    const pending = await pendingOrganization('pessoal', 'pessoa@gmail.com');
    const brands = await provision.listOrganizationBrands(db, pending.organizationId);
    expect(brands.map((b) => b.slug)).toEqual(['pessoal']);
    const r = await staff.updateOrganizationAction({
      id: pending.organizationId,
      reviewStatus: 'approved',
      reason: 'cadastro conferido no ticket 123',
    });
    expect(r.ok).toBe(true);
    expect(r.issued).toHaveLength(1);
    expect(r.issued![0]!.keys.live).toMatch(/^gs_live_/);
    expect(r.issued![0]!.keys.publishable).toMatch(/^gs_pk_live_/);
    expect(await count(`api.api_key where tenant_id = $1`, [pending.tenantId])).toBe(2);
    expect(
      await count(`billing.staff_action where organization_id = $1 and action = 'organization.issue_keys'`, [
        pending.organizationId,
      ]),
    ).toBe(1);
    // F3: a marca entrou em trial agora, e as boas-vindas saem na aprovação (não saíram no provisionamento em revisão)
    expect(sentMails.filter((m) => m.to.includes('pessoa@gmail.com'))).toHaveLength(1);
    expect(
      await count(
        `billing.tenant_notification where tenant_id = $1 and kind = 'welcome' and sent_at is not null`,
        [pending.tenantId],
      ),
    ).toBe(1);
    // aprovar de novo: nada mudou e nada a emitir
    const again = await staff.updateOrganizationAction({
      id: pending.organizationId,
      reviewStatus: 'approved',
      reason: 'repetindo a aprovação',
    });
    expect(again.ok).toBe(false);
  });

  it('aprovação gravada numa tentativa em que a emissão falhou: repetir emite mesmo sem mudança', async () => {
    const pending = await pendingOrganization('recupera', 'dono@gmail.com');
    await auth.sql.query(`update billing.organization set review_status = 'approved' where id = $1`, [
      pending.organizationId,
    ]);
    const r = await staff.updateOrganizationAction({
      id: pending.organizationId,
      reviewStatus: 'approved',
      reason: 'emissão falhou na primeira vez',
    });
    expect(r.ok).toBe(true);
    expect(r.issued).toHaveLength(1);
    expect(r.issued![0]!.keys.test).toMatch(/^gs_test_/);
    expect(await count(`api.api_key where tenant_id = $1`, [pending.tenantId])).toBe(2);
  });

  it('sem SMTP as boas-vindas não ficam registradas: o relógio do worker tenta nos dias seguintes', async () => {
    const owner = { userId: await user('dono@semsmtp.test'), email: 'dono@semsmtp.test' };
    fakeSmtp.configured = false;
    try {
      const r = await provision.provisionOrganization(db, {
        ...input(owner, { slug: 'sem-smtp' }),
        brand: { slug: 'sem-smtp', name: 'Sem SMTP' },
      });
      expect(r.welcomeSent).toBe(false);
      expect(await count(`billing.tenant_notification where tenant_id = $1`, [r.tenantId])).toBe(0);
    } finally {
      fakeSmtp.configured = true;
    }
  });

  it('aprovar a revisão manda as boas-vindas uma vez para cada marca irmã que entrou em trial', async () => {
    const owner = { userId: await user('duas@gmail.com'), email: 'duas@gmail.com' };
    const first = await provision.provisionOrganization(db, {
      ...input(owner, { slug: 'duas-marcas', reviewStatus: 'pending' }),
      brand: { slug: 'duas-marcas', name: 'Marca Um' },
    });
    const second = await provision.provisionOrganization(db, {
      ...input(owner, { slug: 'duas-marcas', reviewStatus: 'pending' }),
      brand: { slug: 'duas-marcas-dois', name: 'Marca Dois' },
    });
    expect(second.organizationId).toBe(first.organizationId);
    expect(sentMails.filter((m) => m.to.includes('duas@gmail.com'))).toHaveLength(0);
    const r = await staff.updateOrganizationAction({
      id: first.organizationId,
      reviewStatus: 'approved',
      reason: 'cadastro conferido no ticket 456',
    });
    expect(r.ok).toBe(true);
    const welcome = sentMails.filter((m) => m.to.includes('duas@gmail.com'));
    expect(welcome.map((m) => m.subject).sort()).toEqual([
      'Bem-vindo(a) à Galaxie Sports: Marca Dois está pronta',
      'Bem-vindo(a) à Galaxie Sports: Marca Um está pronta',
    ]);
    // aprovar de novo não manda de novo
    await staff.updateOrganizationAction({
      id: first.organizationId,
      reviewStatus: 'approved',
      reason: 'cadastro conferido no ticket 456',
    });
    expect(sentMails.filter((m) => m.to.includes('duas@gmail.com'))).toHaveLength(2);
    expect(
      await count(`billing.tenant_notification where tenant_id in ($1, $2) and kind = 'welcome'`, [
        first.tenantId,
        second.tenantId,
      ]),
    ).toBe(2);
  });

  it('Dono convidado pela equipe nasce com convite pendente e prazo', async () => {
    const owner = { userId: await user('dono@assistido.test'), email: 'dono@assistido.test' };
    const r = await provision.provisionOrganization(db, {
      ...input(owner, { slug: 'assistido', terms: null }),
      brand: { slug: 'assistido', name: 'Assistido' },
      owner: { ...owner, accepted: false },
      actor: 'galaxie:staff',
      source: 'staff',
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
    await auth.sql
      .query(`update api.tenant set trial_ends_at = now() - interval '1 day' where organization_id in
      (select id from billing.organization where slug in ('clube-do-remo', 'remo-assistido'))`);
    expect(await guards.findTrialOrganizationForDomain('remo.test')).toBeNull();
  });

  it('conta as organizações do IP nas últimas 24 h e sabe quem já tem cargo', async () => {
    expect(await guards.countOrganizationsFromIp('203.0.113.9')).toBeGreaterThanOrEqual(2);
    expect(await guards.countOrganizationsFromIp('198.51.100.1')).toBe(0);
    const { rows } = await auth.sql.query<{ id: string }>(
      `select id from "user" where email = 'dono@remo.test'`,
    );
    expect(await guards.hasAnyMembership(rows[0]!.id)).toBe(true);
    expect(await guards.hasAnyMembership('ninguem')).toBe(false);
  });
});
