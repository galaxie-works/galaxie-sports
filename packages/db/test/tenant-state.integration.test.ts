import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

/*
 * Plataforma comercial, F3 (migration 0185): `api.tenant.state` com CHECK, `state_since`, `billing.tenant_state_event`
 * e a migration de dados que deriva o estado inicial de `status`, `trial_ends_at` e `review_status`, idempotente.
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

/** Os comandos da migration de dados da 0185, entre os marcadores, na ordem do arquivo. */
const backfillStatements = (() => {
  const sql = readFileSync(new URL('../drizzle/0185_tenant_state.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('-- galaxie:backfill-0185:start');
  const end = sql.indexOf('-- galaxie:backfill-0185:end');
  if (start === -1 || end === -1) throw new Error('marcadores do backfill da 0185 não encontrados');
  return sql
    .slice(start, end)
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
})();

const runBackfill = async () => {
  for (const statement of backfillStatements) await pg.unsafe(statement);
};

const createOrganization = async (slug: string, reviewStatus: string) => {
  const [row] =
    (await pg`insert into billing.organization (slug, name, country, currency, billing_entity, review_status, created_by)
    values (${slug}, ${slug}, 'BR', 'brl', 'ltda', ${reviewStatus}, 'test') returning id`) as unknown as [
      { id: string },
    ];
  return row.id;
};

const createTenant = async (slug: string, fields: Record<string, unknown> = {}) => {
  const [row] = (await pg`insert into api.tenant ${pg({
    slug,
    name: `Marca ${slug}`,
    plan: 'fan_experience',
    modules: ['core_data'],
    ...fields,
  } as Record<string, postgres.ParameterOrJSON<never>>)} returning id`) as unknown as [{ id: string }];
  return row.id;
};

const stateOf = async (slug: string) => {
  const [row] = (await pg`select state, state_since, status::text as status, trial_ends_at, created_at
    from api.tenant where slug = ${slug}`) as unknown as [
    { state: string; state_since: Date; status: string; trial_ends_at: Date | null; created_at: Date },
  ];
  return row;
};

const eventsOf = async (slug: string) =>
  (await pg`select e.from_state, e.to_state, e.cause, e.actor, e.payload
     from billing.tenant_state_event e join api.tenant t on t.id = e.tenant_id
    where t.slug = ${slug} order by e.created_at, e.id`) as unknown as {
    from_state: string | null;
    to_state: string;
    cause: string;
    actor: string;
    payload: Record<string, unknown> | null;
  }[];

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

describe('migration 0185: estado do tenant', () => {
  it('a coluna nasce active, com state_since, e o CHECK recusa estado fora da lista', async () => {
    await createTenant('coluna');
    expect(await stateOf('coluna')).toMatchObject({ state: 'active', status: 'active' });
    await expect(pg`update api.tenant set state = 'ativo' where slug = 'coluna'`).rejects.toThrow(
      /tenant_state/,
    );
    await expect(
      pg`insert into billing.tenant_state_event (tenant_id, to_state, cause, actor)
         select id, 'trial', 'telepatia', 'x' from api.tenant where slug = 'coluna'`,
    ).rejects.toThrow(/tenant_state_event_cause/);
  });

  it('backfill: suspenso, revisão pendente ou recusada, trial vencido, trial em curso, plano trial e o resto', async () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 10 * 86_400_000);
    const pending = await createOrganization('org-pendente', 'pending');
    const rejected = await createOrganization('org-recusada', 'rejected');
    const approved = await createOrganization('org-aprovada', 'approved');
    await createTenant('suspenso', { status: 'suspended', trial_ends_at: future });
    await createTenant('em-revisao', { organization_id: pending, trial_ends_at: future });
    await createTenant('recusado', { organization_id: rejected, trial_ends_at: future });
    await createTenant('trial-vencido', { trial_ends_at: past });
    await createTenant('trial-em-curso', { organization_id: approved, trial_ends_at: future });
    await createTenant('plano-trial', { plan: 'trial' });
    await createTenant('ativo', { plan: 'enterprise' });
    await runBackfill();

    expect((await stateOf('suspenso')).state).toBe('suspended');
    expect((await stateOf('em-revisao')).state).toBe('pending_review');
    expect((await stateOf('recusado')).state).toBe('rejected');
    const vencido = await stateOf('trial-vencido');
    expect(vencido.state).toBe('trial_expired');
    expect(vencido.state_since.getTime()).toBe(vencido.trial_ends_at!.getTime());
    const emCurso = await stateOf('trial-em-curso');
    expect(emCurso.state).toBe('trial');
    expect(emCurso.state_since.getTime()).toBe(emCurso.created_at.getTime());
    expect((await stateOf('plano-trial')).state).toBe('trial');
    expect((await stateOf('ativo')).state).toBe('active');
    // o tenant do primeiro teste também entra: estava sem evento
    expect((await stateOf('coluna')).state).toBe('active');

    expect(await eventsOf('suspenso')).toEqual([
      {
        from_state: null,
        to_state: 'suspended',
        cause: 'migration',
        actor: 'migration:0185',
        payload: { status: 'suspended', trial_ends_at: expect.any(String), review_status: null },
      },
    ]);
    expect((await eventsOf('em-revisao'))[0]!.payload).toMatchObject({ review_status: 'pending' });
  });

  it('rodar de novo não grava nada: só tenants sem evento entram, e um estado já gravado fica', async () => {
    await pg`update api.tenant set state = 'cancelled', state_since = now() where slug = 'ativo'`;
    const [{ n: before }] =
      (await pg`select count(*)::int as n from billing.tenant_state_event`) as unknown as [{ n: number }];
    await runBackfill();
    const [{ n: after }] =
      (await pg`select count(*)::int as n from billing.tenant_state_event`) as unknown as [{ n: number }];
    expect(after).toBe(before);
    expect((await stateOf('ativo')).state).toBe('cancelled');
    expect((await stateOf('suspenso')).state).toBe('suspended');
  });
});
