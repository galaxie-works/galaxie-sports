import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuthTestDb, signInAs, type AuthTestDb } from './support/auth-db';

/*
 * Teste por módulo pela loja (F3, decisão 9) com logins de verdade: só quem contrata (Dono, Admin) ativa; a conta sem
 * acesso não ativa; a mesma organização testa cada módulo uma vez, mesmo com dois cliques ao mesmo tempo; a equipe
 * Galaxie só com motivo. O catálogo do teste é uma cópia de `config/catalog` com o Chat ao vivo `available` (no catálogo
 * real os módulos de engajamento ainda estão `soon`, e módulo de dados não se testa pela loja: vem pelo plano).
 */

vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule);
const request = vi.hoisted(() => ({ cookie: '', jar: {} as Record<string, string | undefined> }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: request.cookie }),
  cookies: async () => ({
    get: (name: string) => (request.jar[name] ? { name, value: request.jar[name] } : undefined),
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/root-params', () => ({ locale: async () => 'pt-BR' }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

let db: AuthTestDb;
let actions: typeof import('../src/app/[locale]/(app)/client/plans/actions');
let staffReason: typeof import('../src/lib/client/staff-reason');
const cookies: Record<string, string> = {};
const ids = { org: '', active: '', expired: '' };

const as = (who: string, tenant?: string) => {
  request.cookie = cookies[who]!;
  request.jar['galaxie-tenant'] = tenant;
  delete request.jar['galaxie-staff-reason'];
};

const count = async (sql: string, params: unknown[] = []) =>
  (await db.sql.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]!.n;

const userId = async (email: string) =>
  (await db.sql.query<{ id: string }>(`select id from "user" where email = $1`, [email])).rows[0]!.id;

/** Cópia do catálogo com `live_chat` vendável pela loja. */
function catalogWithLiveChatAvailable(): string {
  const src = join(process.cwd(), '..', '..', 'config', 'catalog');
  const dir = mkdtempSync(join(tmpdir(), 'galaxie-catalog-'));
  for (const f of ['modules.yaml', 'plans.yaml', 'capacity.yaml', 'addons.yaml']) {
    let text = readFileSync(join(src, f), 'utf8');
    if (f === 'modules.yaml') {
      const before = text;
      text = text.replace(/(\n {2}live_chat:\n(?: {4}.*\n)*? {4}status: )soon/, '$1available');
      if (text === before) throw new Error('não achei o status do live_chat em modules.yaml');
    }
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

beforeAll(async () => {
  process.env.CATALOG_DIR = catalogWithLiveChatAvailable();
  db = await createAuthTestDb();
  const { runMigrations } = await import('@galaxie/db');
  await runMigrations(process.env.DEMO_DATABASE_URL!);
  const org = await db.sql.query<{ id: string }>(
    `insert into billing.organization (slug, name, country, currency, billing_entity, created_by)
     values ('org-loja', 'Organização da loja', 'BR', 'brl', 'ltda', 'test') returning id::text`,
  );
  ids.org = org.rows[0]!.id;
  for (const [key, slug, state] of [
    ['active', 'marca-ativa', 'active'],
    ['expired', 'marca-vencida', 'trial_expired'],
  ] as const) {
    const t = await db.sql.query<{ id: string }>(
      `insert into api.tenant (slug, name, plan, modules, organization_id, state)
       values ($1, $1, 'fan_experience', '{core_data,where_to_watch,semantic}', $2, $3) returning id::text`,
      [slug, ids.org, state],
    );
    ids[key] = t.rows[0]!.id;
  }
  for (const email of ['dono@loja.test', 'dev@loja.test', 'admin-marca@loja.test'])
    cookies[email] = await signInAs(email, 'client');
  cookies['equipe@galaxie.test'] = await signInAs('equipe@galaxie.test', 'admin');
  // o Dono vem da organização (vale nas duas marcas); o Desenvolvedor e o Admin, da marca ativa
  await db.sql.query(
    `insert into billing.organization_member (organization_id, user_id, role, invited_by, accepted_at)
     values ($1, $2, 'owner', 'test', now())`,
    [ids.org, await userId('dono@loja.test')],
  );
  for (const [email, role] of [
    ['dev@loja.test', 'developer'],
    ['admin-marca@loja.test', 'admin'],
  ] as const)
    await db.sql.query(
      `insert into api.tenant_member (tenant_id, user_id, role, invited_by, accepted_at) values ($1, $2, $3, 'test', now())`,
      [ids.active, await userId(email), role],
    );
  actions = await import('../src/app/[locale]/(app)/client/plans/actions');
  staffReason = await import('../src/lib/client/staff-reason');
}, 120_000);

afterAll(async () => {
  await db?.drop();
});

describe('startModuleTrialAction', () => {
  it('o Desenvolvedor não contrata; a conta com o teste vencido não ativa nada', async () => {
    as('dev@loja.test', ids.active);
    expect(await actions.startModuleTrialAction({ module: 'live_chat' })).toEqual({
      ok: false,
      error: 'Seu cargo não permite esta ação.',
    });
    as('dono@loja.test', ids.expired);
    expect(await actions.startModuleTrialAction({ module: 'live_chat' })).toEqual({
      ok: false,
      error: 'A conta está sem acesso no momento: regularize antes de ativar um teste.',
    });
    expect(await count('billing.module_trial')).toBe(0);
    expect(await count('billing.tenant_override')).toBe(0);
  });

  it('o que a loja não oferece não se ativa: módulo de dados (vem pelo plano), sem teste, desconhecido', async () => {
    as('dono@loja.test', ids.active);
    for (const module of ['live_intelligence', 'cosmos_ai', 'communities', 'nope'])
      expect(await actions.startModuleTrialAction({ module }), module).toEqual({
        ok: false,
        error: 'Este módulo não está disponível para teste agora.',
      });
    expect(await count('billing.module_trial')).toBe(0);
  });

  it('dois cliques do Dono ao mesmo tempo: um ativa, o outro recebe "já testado"; nada duplica', async () => {
    as('dono@loja.test', ids.active);
    const [a, b] = await Promise.all([
      actions.startModuleTrialAction({ module: 'live_chat' }),
      actions.startModuleTrialAction({ module: 'live_chat' }),
    ]);
    const results = [a, b].sort((x, y) => Number(y.ok) - Number(x.ok));
    expect(results[0]).toMatchObject({ ok: true, endsAt: expect.any(String) });
    // o segundo clique cai no índice único (se os dois chegaram juntos ao banco) ou, se o primeiro já tinha gravado
    // quando ele leu a loja, na guarda da loja: nos dois casos nada grava
    expect(results[1]!.ok).toBe(false);
    expect([
      'Esta organização já testou este módulo.',
      'Este módulo não está disponível para teste agora.',
    ]).toContain(results[1]!.error);
    expect(await count('billing.module_trial where organization_id = $1', [ids.org])).toBe(1);
    const overrides = await db.sql.query<{ kind: string; key: string; value: number | null; reason: string }>(
      `select kind, key, value, reason from billing.tenant_override where tenant_id = $1 order by kind, key`,
      [ids.active],
    );
    expect(overrides.rows).toEqual([
      { kind: 'module_grant', key: 'live_chat', value: null, reason: 'module_trial' },
      { kind: 'tier', key: 'live_chat.peak_connections', value: 5000, reason: 'module_trial' },
    ]);
    expect(
      await count(`ops.change_feed where topic = 'tenant.module_trial_started' and entity_id = $1`, [
        ids.active,
      ]),
    ).toBe(1);
    // o Admin da marca também contrata, mas o teste já foi usado na organização: a loja não oferece mais
    as('admin-marca@loja.test', ids.active);
    expect(await actions.startModuleTrialAction({ module: 'live_chat' })).toEqual({
      ok: false,
      error: 'Este módulo não está disponível para teste agora.',
    });
  });

  it('a equipe Galaxie só age com motivo, e o registro fica em staff_action', async () => {
    as('equipe@galaxie.test', ids.active);
    expect(await actions.startModuleTrialAction({ module: 'communities' })).toEqual({
      ok: false,
      error: 'Informe o motivo (ticket ou pedido do cliente) no seletor de tenant antes de agir.',
    });
    // a Comunidades ainda está `soon` no catálogo do teste: com motivo, a equipe passa pelo rastro e cai na loja
    request.jar['galaxie-staff-reason'] = staffReason.encodeStaffReason(
      process.env.BETTER_AUTH_SECRET ?? '',
      {
        tenantId: ids.active,
        reason: 'ticket 77',
      },
    );
    expect(await actions.startModuleTrialAction({ module: 'communities' })).toEqual({
      ok: false,
      error: 'Este módulo não está disponível para teste agora.',
    });
    expect(await count(`billing.staff_action where action = 'plans.module_trial'`)).toBe(0);
  });
});
