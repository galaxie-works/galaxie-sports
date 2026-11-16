import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

/*
 * Plataforma comercial, F2 (#1136, migration 0178): a organização acima da marca, seus membros, o domínio comprovado
 * por TXT, o registro das ações da equipe e a migration de dados que cria uma organização por marca existente.
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
let pg: postgres.Sql;

/** Os comandos da migration de dados da 0178, entre os marcadores, na ordem do arquivo. */
const backfillStatements = (() => {
  const sql = readFileSync(new URL('../drizzle/0178_plataforma_organizacao.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('-- galaxie:backfill-0178:start');
  const end = sql.indexOf('-- galaxie:backfill-0178:end');
  if (start === -1 || end === -1) throw new Error('marcadores do backfill da 0178 não encontrados');
  return sql
    .slice(start, end)
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
})();

const runBackfill = async () => {
  for (const statement of backfillStatements) await pg.unsafe(statement);
};

const createTenant = async (slug: string, fields: Record<string, unknown> = {}) => {
  const [row] = (await pg`insert into api.tenant ${pg({
    slug,
    name: `Marca ${slug}`,
    plan: 'enterprise',
    modules: ['core_data'],
    ...fields,
  } as Record<string, postgres.ParameterOrJSON<never>>)} returning id`) as unknown as [{ id: string }];
  return row.id;
};

const count = async (table: string, where = '') => {
  const [{ n }] = (await pg.unsafe(`select count(*)::int as n from ${table} ${where}`)) as unknown as [
    { n: number },
  ];
  return n;
};

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
}, 60_000);

afterAll(async () => {
  await pg?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('migration de dados da 0178: uma organização por marca', () => {
  let brId: string;
  let arId: string;

  it('cria a organização com país, moeda, entidade e faixa da marca, liga o tenant e promove o Dono', async () => {
    // no banco novo as tabelas já existem quando o tenant entra: a migration de dados roda de novo à mão
    brId = await createTenant('galaxie', { markets: ['BR', 'AR'], capacity_tier: 'C2' });
    arId = await createTenant('marca-ar', { markets: ['AR'] });
    await pg`insert into api.tenant_member (tenant_id, user_id, role, invited_by, accepted_at)
      values (${brId}, 'user-dono', 'owner', 'legacy', now()), (${brId}, 'user-admin', 'admin', 'legacy', now()),
        (${arId}, 'user-dono', 'owner', 'legacy', null), (${arId}, 'user-dono-2', 'owner', 'legacy', now())`;
    await runBackfill();

    const orgs =
      await pg`select slug, name, country, currency, billing_entity, capacity_tier, is_galaxie, created_by
      from billing.organization order by slug`;
    expect(orgs).toEqual([
      {
        slug: 'galaxie',
        name: 'Marca galaxie',
        country: 'BR',
        currency: 'brl',
        billing_entity: 'ltda',
        capacity_tier: 'C2',
        is_galaxie: true,
        created_by: 'migration:0178',
      },
      {
        slug: 'marca-ar',
        name: 'Marca marca-ar',
        country: 'AR',
        currency: 'usd',
        billing_entity: 'llc',
        capacity_tier: 'C1',
        is_galaxie: false,
        created_by: 'migration:0178',
      },
    ]);

    const tenants = await pg`select t.slug, o.slug as org from api.tenant t
      join billing.organization o on o.id = t.organization_id order by t.slug`;
    expect(tenants).toEqual([
      { slug: 'galaxie', org: 'galaxie' },
      { slug: 'marca-ar', org: 'marca-ar' },
    ]);

    const members =
      await pg`select o.slug as org, m.user_id, m.role, m.invited_by, m.accepted_at is not null as accepted
      from billing.organization_member m join billing.organization o on o.id = m.organization_id
      order by o.slug, m.user_id`;
    // só o Dono da marca vira Dono da organização; convite pendente entra aceito
    expect(members).toEqual([
      { org: 'galaxie', user_id: 'user-dono', role: 'owner', invited_by: 'migration:0178', accepted: true },
      { org: 'marca-ar', user_id: 'user-dono', role: 'owner', invited_by: 'migration:0178', accepted: true },
      {
        org: 'marca-ar',
        user_id: 'user-dono-2',
        role: 'owner',
        invited_by: 'migration:0178',
        accepted: true,
      },
    ]);
  });

  it('rodar de novo não cria nada a mais', async () => {
    const before = [
      await count('billing.organization'),
      await count('billing.organization_member'),
      await count('api.tenant', 'where organization_id is null'),
    ];
    await runBackfill();
    await runBackfill();
    expect([
      await count('billing.organization'),
      await count('billing.organization_member'),
      await count('api.tenant', 'where organization_id is null'),
    ]).toEqual(before);
    expect(before[2]).toBe(0);
  });

  it('marca sem mercado cai em BR; mercado que não é ISO2 também', async () => {
    await createTenant('sem-mercado');
    await createTenant('mercado-torto', { markets: ['brasil'] });
    await runBackfill();
    const orgs = await pg`select slug, country, currency, billing_entity from billing.organization
      where slug in ('sem-mercado', 'mercado-torto') order by slug`;
    expect(orgs).toEqual([
      { slug: 'mercado-torto', country: 'BR', currency: 'brl', billing_entity: 'ltda' },
      { slug: 'sem-mercado', country: 'BR', currency: 'brl', billing_entity: 'ltda' },
    ]);
  });

  it('o tenant não se apaga com a organização; apagar o tenant não apaga a organização', async () => {
    const [{ id: orgId }] =
      (await pg`select id from billing.organization where slug = 'marca-ar'`) as unknown as [{ id: string }];
    await expect(pg`delete from billing.organization where id = ${orgId}`).rejects.toThrow(
      /tenant_organization_id_organization_id_fk/,
    );
    await pg`delete from api.tenant where id = ${arId}`;
    expect(await count('billing.organization', `where id = '${orgId}'`)).toBe(1);
  });
});

describe('billing.organization e organization_member', () => {
  const insertOrg = (fields: Record<string, unknown>) =>
    pg`insert into billing.organization ${pg({
      slug: `org-${randomBytes(3).toString('hex')}`,
      name: 'Org',
      country: 'BR',
      currency: 'brl',
      billing_entity: 'ltda',
      created_by: 'panel:teste',
      ...fields,
    } as Record<string, postgres.ParameterOrJSON<never>>)} returning id`;

  it('faixa C1 e revisão none por padrão; aceite dos termos entra inteiro', async () => {
    const [row] = (await insertOrg({
      terms_version: '2026-11',
      terms_accepted_at: new Date(),
      terms_accepted_by: 'user-dono',
      terms_accepted_ip: '203.0.113.9',
    })) as unknown as [{ id: string }];
    const [org] = await pg`select capacity_tier, review_status, is_galaxie, locale from billing.organization
      where id = ${row.id}`;
    expect(org).toEqual({ capacity_tier: 'C1', review_status: 'none', is_galaxie: false, locale: null });
  });

  it('o banco recusa país fora do ISO2, moeda, entidade, faixa, revisão e termos pela metade', async () => {
    for (const bad of [
      { country: 'bra' },
      { country: 'br' },
      { currency: 'eur' },
      { billing_entity: 'inc' },
      { capacity_tier: 'C5' },
      { review_status: 'aprovada' },
      { terms_version: '2026-11' },
      { terms_accepted_at: new Date() },
    ])
      await expect(insertOrg(bad), JSON.stringify(bad)).rejects.toThrow(/violates check constraint/);
  });

  it('slug é único e o membro entra uma vez por organização, só como owner ou billing', async () => {
    const [{ id }] = (await insertOrg({ slug: 'holding' })) as unknown as [{ id: string }];
    await expect(insertOrg({ slug: 'holding' })).rejects.toThrow(/organization_slug_unique/);
    const member = (role: string, user = 'user-fin') =>
      pg`insert into billing.organization_member (organization_id, user_id, role, invited_by, expires_at)
        values (${id}, ${user}, ${role}, 'panel:teste', now() + interval '7 days')`;
    await expect(member('billing')).resolves.toBeDefined();
    await expect(member('billing')).rejects.toThrow(/organization_member_user_uq/);
    await expect(member('admin', 'user-x')).rejects.toThrow(/organization_member_role/);
    await pg`delete from billing.organization where id = ${id}`;
    expect(await count('billing.organization_member', `where organization_id = '${id}'`)).toBe(0);
  });
});

describe('billing.domain', () => {
  let aId: string;
  let bId: string;
  const insertDomain = (tenantId: string, host: string, fields: Record<string, unknown> = {}) =>
    pg`insert into billing.domain ${pg({
      tenant_id: tenantId,
      host,
      created_by: 'panel:teste',
      ...fields,
    } as Record<string, postgres.ParameterOrJSON<never>>)} returning txt_token`;

  beforeAll(async () => {
    aId = await createTenant('dominio-a');
    bId = await createTenant('dominio-b');
  });

  it('o mesmo host entra em duas marcas sem verificação, com token gerado e único', async () => {
    const [a] = (await insertDomain(aId, 'torcida.example.com')) as unknown as [{ txt_token: string }];
    const [b] = (await insertDomain(bId, 'torcida.example.com')) as unknown as [{ txt_token: string }];
    expect(a.txt_token).toMatch(/^galaxie-verify=[0-9a-f]{32}$/);
    expect(b.txt_token).not.toBe(a.txt_token);
    await expect(insertDomain(aId, 'torcida.example.com')).rejects.toThrow(/domain_tenant_host_uq/);
  });

  it('um host comprovado só pode ser de uma marca', async () => {
    await pg`update billing.domain set verified_at = now() where tenant_id = ${aId} and host = 'torcida.example.com'`;
    await expect(
      pg`update billing.domain set verified_at = now() where tenant_id = ${bId} and host = 'torcida.example.com'`,
    ).rejects.toThrow(/domain_verified_host_uq/);
  });

  it('o banco recusa host com maiúscula, esquema, porta ou sem ponto', async () => {
    for (const host of [
      'Torcida.example.com',
      'https://torcida.example.com',
      'torcida.example.com:8443',
      'localhost',
    ])
      await expect(insertDomain(bId, host), host).rejects.toThrow(/domain_host_format/);
  });

  it('apagar a marca apaga os domínios', async () => {
    await pg`delete from api.tenant where id = ${bId}`;
    expect(await count('billing.domain', `where tenant_id = '${bId}'`)).toBe(0);
  });
});

describe('billing.staff_action', () => {
  it('exige tenant ou organização e um motivo de pelo menos 5 caracteres', async () => {
    const tenantId = await createTenant('equipe-a');
    const [{ id: orgId }] = (await pg`insert into billing.organization
      (slug, name, country, currency, billing_entity, created_by)
      values ('equipe-org', 'Equipe', 'US', 'usd', 'llc', 'panel:teste') returning id`) as unknown as [
      { id: string },
    ];
    const insert = (fields: Record<string, unknown>) =>
      pg`insert into billing.staff_action ${pg({
        actor: 'user-staff',
        action: 'override.grant',
        reason: 'pedido do cliente no chamado 42',
        ...fields,
      } as Record<string, postgres.ParameterOrJSON<never>>)}`;
    await expect(insert({ tenant_id: tenantId })).resolves.toBeDefined();
    await expect(
      insert({ organization_id: orgId, payload: { before: null, after: { tier: 'C2' } } }),
    ).resolves.toBeDefined();
    await expect(insert({ tenant_id: tenantId, organization_id: orgId })).resolves.toBeDefined();
    await expect(insert({})).rejects.toThrow(/billing_staff_action_target/);
    await expect(insert({ tenant_id: tenantId, reason: 'ok' })).rejects.toThrow(
      /billing_staff_action_reason/,
    );
  });
});

describe('api.tenant_member.invite_expires_at', () => {
  it('aceita null (sem prazo ou já aceito) e uma data', async () => {
    const tenantId = await createTenant('convite-a');
    await expect(
      pg`insert into api.tenant_member (tenant_id, user_id, role, invited_by, accepted_at)
        values (${tenantId}, 'user-aceito', 'developer', 'panel:teste', now())`,
    ).resolves.toBeDefined();
    const [pending] =
      await pg`insert into api.tenant_member (tenant_id, user_id, role, invited_by, invite_expires_at)
      values (${tenantId}, 'user-convidado', 'billing', 'panel:teste', now() + interval '7 days')
      returning invite_expires_at > now() as valid`;
    expect(pending).toEqual({ valid: true });
  });
});
