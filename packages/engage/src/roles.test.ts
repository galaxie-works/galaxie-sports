import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionsOf,
  ALL_TENANT_ROLES,
  atLeast,
  can,
  canAssign,
  canReceive,
  check,
  CONFIGURABLE_ROLES,
  DELEGATION_FLOOR,
  diffOverrides,
  FIXED_ACTIONS,
  isConfigurable,
  isTenantAction,
  isTenantRole,
  LATERAL_ALLOW,
  LATERAL_ROLES,
  normalizeOverrides,
  roleAllows,
  setRolePermission,
  TENANT_ACTIONS,
  TENANT_ROLES,
  VIEW_OF,
  type Actor,
  type MemberScope,
  type RoleOverrides,
  type TenantRole,
} from './roles.js';

const T = 'tenant-a';
const member = (role: TenantRole, scope: MemberScope | null = null): Actor => ({
  kind: 'member',
  tenantId: T,
  role,
  scope,
});

describe('matriz de cargos (#1019)', () => {
  it('cada cargo abre tudo o que o cargo de baixo abre', () => {
    for (let i = 0; i < TENANT_ROLES.length - 1; i++) {
      const upper = new Set(actionsOf(TENANT_ROLES[i]!));
      for (const a of actionsOf(TENANT_ROLES[i + 1]!))
        expect(upper.has(a), `${TENANT_ROLES[i]} ⊇ ${a}`).toBe(true);
    }
  });

  it('o que cada cargo faz, como descrito na issue', () => {
    expect(can(member('owner'), 'billing.buy_credits', { tenantId: T })).toBe(true);
    expect(can(member('moderator'), 'cosmos.assistant.ask', { tenantId: T })).toBe(true);
    expect(can(member('volunteer'), 'cosmos.assistant.ask', { tenantId: T })).toBe(false);
    expect(can(member('admin'), 'billing.buy_credits', { tenantId: T })).toBe(false);
    expect(can(member('admin'), 'moderation.ban', { tenantId: T })).toBe(true);
    expect(can(member('senior_moderator'), 'moderation.ban', { tenantId: T })).toBe(false);
    expect(can(member('senior_moderator'), 'moderation.expel', { tenantId: T })).toBe(true);
    expect(can(member('senior_moderator'), 'moderation.appeal.second', { tenantId: T })).toBe(true);
    expect(can(member('moderator'), 'moderation.appeal.second', { tenantId: T })).toBe(false);
    expect(can(member('moderator'), 'moderation.suspend', { tenantId: T })).toBe(true);
    expect(can(member('volunteer'), 'moderation.suspend', { tenantId: T })).toBe(false);
    expect(can(member('volunteer'), 'moderation.hide', { tenantId: T })).toBe(true);
    expect(can(member('owner'), 'legal.export', { tenantId: T })).toBe(true);
    expect(can(member('admin'), 'legal.export', { tenantId: T })).toBe(false);
  });

  it('Cosmos AI: Admin vê, só o Dono compra, liga e desliga; Moderador só pergunta', () => {
    const who = (action: 'cosmos.view' | 'cosmos.manage' | 'cosmos.assistant.ask') =>
      TENANT_ROLES.filter((r) => can(member(r), action, { tenantId: T }));
    expect(who('cosmos.view')).toEqual(['owner', 'admin']);
    expect(who('cosmos.manage')).toEqual(['owner']);
    expect(who('cosmos.assistant.ask')).toEqual(['owner', 'admin', 'senior_moderator', 'moderator']);
    expect(check(member('volunteer'), 'cosmos.manage', { tenantId: T })).toEqual({
      ok: false,
      reason: 'role',
    });
    expect(check(member('owner'), 'cosmos.manage', { tenantId: 'tenant-b' })).toEqual({
      ok: false,
      reason: 'other_tenant',
    });
    // escopo restrito (só algumas Comunidades) não abre ação do tenant inteiro
    expect(can(member('owner', { communities: ['c1'] }), 'cosmos.view', { tenantId: T })).toBe(false);
  });

  it('voluntário silencia por até 1 hora; sem duração não silencia', () => {
    expect(check(member('volunteer'), 'moderation.mute', { tenantId: T, durationSec: 3600 })).toEqual({
      ok: true,
    });
    expect(check(member('volunteer'), 'moderation.mute', { tenantId: T, durationSec: 3601 })).toEqual({
      ok: false,
      reason: 'duration',
    });
    expect(check(member('volunteer'), 'moderation.mute', { tenantId: T })).toEqual({
      ok: false,
      reason: 'duration',
    });
    expect(can(member('moderator'), 'moderation.mute', { tenantId: T, durationSec: 86_400 })).toBe(true);
  });

  it('cargo de outro tenant nunca vale (payload forjado com outro tenant)', () => {
    expect(check(member('owner'), 'members.manage', { tenantId: 'tenant-b' })).toEqual({
      ok: false,
      reason: 'other_tenant',
    });
  });

  it('escopo restrito vale só nas Comunidades e Salas listadas', () => {
    const m = member('moderator', { communities: ['c1'], rooms: ['r1'] });
    expect(can(m, 'moderation.hide', { tenantId: T, community: 'c1' })).toBe(true);
    expect(can(m, 'moderation.hide', { tenantId: T, community: 'c2' })).toBe(false);
    expect(can(m, 'moderation.hide', { tenantId: T, room: 'r1' })).toBe(true);
    expect(check(m, 'moderation.hide', { tenantId: T })).toEqual({ ok: false, reason: 'scope' });
  });

  it('a equipe da Galaxie pode tudo em qualquer tenant', () => {
    for (const a of TENANT_ACTIONS) expect(can({ kind: 'galaxie_staff' }, a, { tenantId: 'x' })).toBe(true);
  });

  it('cargos só até abaixo do próprio; Dono só pelo Dono', () => {
    expect(canAssign(member('owner'), T, 'owner')).toBe(true);
    expect(canAssign(member('admin'), T, 'senior_moderator')).toBe(true);
    expect(canAssign(member('admin'), T, 'admin')).toBe(false);
    expect(canAssign(member('admin'), T, 'moderator', 'owner')).toBe(false);
    expect(canAssign(member('admin'), T, null, 'moderator')).toBe(true);
    expect(canAssign(member('senior_moderator'), T, 'volunteer')).toBe(false);
    expect(canAssign({ kind: 'galaxie_staff' }, T, 'owner')).toBe(true);
  });

  it('toda ação tem cargo mínimo válido (na Escada)', () => {
    for (const min of Object.values(ACTIONS)) expect(TENANT_ROLES).toContain(min);
  });

  it('as ações de integração (chaves, webhooks, Builder, domínios) começam no Admin, como settings.manage', () => {
    for (const a of ['keys', 'webhooks', 'builder', 'domains'] as const) {
      expect(ACTIONS[`${a}.view`]).toBe('admin');
      expect(ACTIONS[`${a}.manage`]).toBe('admin');
      expect(VIEW_OF[`${a}.manage`]).toBe(`${a}.view`);
    }
  });
});

describe('cargos laterais: Desenvolvedor e Financeiro (#1136, PL9)', () => {
  it('estão fora da Escada, mas são cargos do tenant', () => {
    expect(LATERAL_ROLES).toEqual(['developer', 'billing']);
    expect(ALL_TENANT_ROLES).toEqual([...TENANT_ROLES, ...LATERAL_ROLES]);
    for (const r of LATERAL_ROLES) {
      expect(isTenantRole(r)).toBe(true);
      expect(TENANT_ROLES as readonly string[]).not.toContain(r);
      expect(CONFIGURABLE_ROLES as readonly string[]).not.toContain(r);
    }
  });

  it('o Desenvolvedor integra e não vê cobrança, moderação nem membros', () => {
    expect(actionsOf('developer')).toEqual([
      'keys.view',
      'keys.manage',
      'webhooks.view',
      'webhooks.manage',
      'builder.view',
      'builder.manage',
      'domains.view',
      'domains.manage',
    ]);
    expect(can(member('developer'), 'keys.manage', { tenantId: T })).toBe(true);
    expect(can(member('developer'), 'builder.manage', { tenantId: T })).toBe(true);
    for (const a of [
      'billing.view',
      'members.view',
      'moderation.queue.view',
      'settings.manage',
      'cosmos.view',
    ] as const)
      expect(check(member('developer'), a, { tenantId: T })).toEqual({ ok: false, reason: 'role' });
  });

  it('o Financeiro vê a cobrança e compra créditos, e nada de produto', () => {
    expect(actionsOf('billing')).toEqual(['billing.view', 'billing.buy_credits']);
    expect(can(member('billing'), 'billing.buy_credits', { tenantId: T })).toBe(true);
    expect(can(member('billing'), 'keys.view', { tenantId: T })).toBe(false);
    expect(can(member('billing'), 'cosmos.manage', { tenantId: T })).toBe(false);
  });

  it('a lista de cada lateral só tem ações da matriz', () => {
    for (const r of LATERAL_ROLES) for (const a of LATERAL_ALLOW[r]) expect(isTenantAction(a)).toBe(true);
  });

  it('a configuração do Dono não alcança os laterais: nem dá, nem tira, nem fica gravada', () => {
    const forged: RoleOverrides = {
      developer: { 'billing.view': true, 'keys.manage': false },
      billing: { 'keys.manage': true },
    };
    expect(roleAllows('developer', 'billing.view', forged)).toBe(false);
    expect(roleAllows('developer', 'keys.manage', forged)).toBe(true);
    expect(roleAllows('billing', 'keys.manage', forged)).toBe(false);
    expect(normalizeOverrides(forged)).toEqual({});
    for (const r of LATERAL_ROLES) for (const a of TENANT_ACTIONS) expect(canReceive(r, a)).toBe(false);
    expect(setRolePermission(null, 'developer', 'billing.view', true)).toEqual({});
    // a Escada continua configurável como antes
    expect(setRolePermission(null, 'admin', 'cosmos.manage', true)).toEqual({
      admin: { 'cosmos.manage': true },
    });
  });

  it('Admin e Dono dão cargo lateral; Moderador sênior, não; um lateral não dá cargo a ninguém', () => {
    for (const r of LATERAL_ROLES) {
      expect(canAssign(member('owner'), T, r)).toBe(true);
      expect(canAssign(member('admin'), T, r)).toBe(true);
      expect(canAssign(member('senior_moderator'), T, r)).toBe(false);
      expect(canAssign(member('admin'), T, null, r)).toBe(true);
      expect(canAssign(member('senior_moderator'), T, 'moderator', r)).toBe(false);
      expect(canAssign(member(r), T, 'volunteer')).toBe(false);
      expect(canAssign(member(r), T, 'moderator')).toBe(false);
      expect(canAssign(member(r), T, null, 'moderator')).toBe(false);
      // Desenvolvedor não vira Admin pela mão de outro Admin
      expect(canAssign(member('admin'), T, 'admin', r)).toBe(false);
    }
    expect(canAssign({ kind: 'galaxie_staff' }, T, 'developer')).toBe(true);
    expect(atLeast('developer', 'moderator')).toBe(false);
    expect(atLeast('developer', 'volunteer')).toBe(false);
  });

  it('escopo e outro tenant valem para os laterais como para a Escada', () => {
    expect(check(member('developer'), 'keys.view', { tenantId: 'tenant-b' })).toEqual({
      ok: false,
      reason: 'other_tenant',
    });
    expect(check(member('developer', { communities: ['c1'] }), 'keys.view', { tenantId: T })).toEqual({
      ok: false,
      reason: 'scope',
    });
  });
});

/**
 * Toda ação que o console usa (`can(ctx, '…')`, `allowed(ctx, '…')`, `canSomewhere(ctx, '…')`, `check(…, '…')` e
 * `action: '…'` do menu) existe na matriz: uma ação digitada errada não vira um "nunca pode" silencioso.
 */
describe('cobertura: toda ação usada no console existe na matriz', () => {
  const DEMO_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'demo', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const CALLS = /\b(?:can|canSomewhere|allowed|check)\([^()]*?'([a-z_]+(?:\.[a-z_]+)+)'/g;
  /** O `action:` de cada área do menu (`CLIENT_NAV`); fora do menu, `action:` é outra coisa (auditoria, fila). */
  const MENU = /\baction:\s*'([a-z_]+(?:\.[a-z_]+)+)'/g;

  it('apps/demo', () => {
    const used = new Map<string, string>();
    for (const file of files(DEMO_SRC)) {
      const code = readFileSync(file, 'utf8');
      const rel = relative(DEMO_SRC, file).replace(/\\/g, '/');
      const patterns = rel.endsWith('components/client/client-nav.tsx') ? [CALLS, MENU] : [CALLS];
      for (const re of patterns) for (const m of code.matchAll(re)) used.set(m[1]!, rel);
    }
    expect(used.size).toBeGreaterThan(10);
    const unknown = [...used].filter(([a]) => !isTenantAction(a)).map(([a, f]) => `${a} (${f})`);
    expect(unknown).toEqual([]);
  });
});

describe('permissões por cargo configuráveis pelo Dono', () => {
  const as = (role: TenantRole, overrides: RoleOverrides): Actor => ({
    kind: 'member',
    tenantId: T,
    role,
    scope: null,
    overrides,
  });

  it('sem configuração (ou vazia), vale a matriz padrão', () => {
    for (const role of TENANT_ROLES)
      for (const action of TENANT_ACTIONS) {
        const expected = can(member(role), action, { tenantId: T, durationSec: 60 });
        expect(roleAllows(role, action)).toBe(atLeast(role, ACTIONS[action]));
        expect(can(as(role, {}), action, { tenantId: T, durationSec: 60 })).toBe(expected);
      }
    expect(normalizeOverrides(null)).toEqual({});
  });

  it('o Dono dá ao Admin o que era só dele, e o can() passa a ler a configuração', () => {
    const cfg = setRolePermission(null, 'admin', 'cosmos.manage', true);
    expect(cfg).toEqual({ admin: { 'cosmos.manage': true } });
    expect(can(as('admin', cfg), 'cosmos.manage', { tenantId: T })).toBe(true);
    expect(can(as('moderator', cfg), 'cosmos.manage', { tenantId: T })).toBe(false);
  });

  it('dar a um cargo dá aos de cima; tirar tira dos de baixo (a Escada vale para as ações)', () => {
    const up = setRolePermission(null, 'moderator', 'moderation.ban', true);
    expect(roleAllows('senior_moderator', 'moderation.ban', up)).toBe(true);
    expect(roleAllows('moderator', 'moderation.ban', up)).toBe(true);
    expect(roleAllows('volunteer', 'moderation.ban', up)).toBe(false);

    const down = setRolePermission(null, 'senior_moderator', 'moderation.hide', false);
    expect(roleAllows('senior_moderator', 'moderation.hide', down)).toBe(false);
    expect(roleAllows('moderator', 'moderation.hide', down)).toBe(false);
    expect(roleAllows('volunteer', 'moderation.hide', down)).toBe(false);
    expect(roleAllows('admin', 'moderation.hide', down)).toBe(true);

    // com qualquer configuração, cada cargo abre tudo o que o de baixo abre
    for (const cfg of [up, down, setRolePermission(down, 'volunteer', 'moderation.hide', true)])
      for (let i = 0; i < TENANT_ROLES.length - 1; i++) {
        const upper = new Set(actionsOf(TENANT_ROLES[i]!, cfg));
        for (const a of actionsOf(TENANT_ROLES[i + 1]!, cfg)) expect(upper.has(a)).toBe(true);
      }
  });

  it('configuração gravada fora da Escada não abre nada a mais para o cargo de baixo', () => {
    const forged: RoleOverrides = {
      admin: { 'moderation.hide': false },
      moderator: { 'moderation.ban': true },
    };
    expect(roleAllows('volunteer', 'moderation.hide', forged)).toBe(false);
    expect(roleAllows('moderator', 'moderation.ban', forged)).toBe(false);
  });

  it('o Dono não se tranca fora: nenhuma configuração tira nada dele', () => {
    const forged = { owner: Object.fromEntries(TENANT_ACTIONS.map((a) => [a, false])) } as RoleOverrides;
    for (const a of TENANT_ACTIONS) expect(roleAllows('owner', a, forged)).toBe(true);
    expect(setRolePermission(null, 'owner', 'cosmos.view', false)).toEqual({});
    expect(normalizeOverrides(forged)).toEqual({});
  });

  it('Exportação judicial, cuidar dos cargos e mudar permissões ficam fixas', () => {
    expect(FIXED_ACTIONS).toEqual(['legal.export', 'members.manage', 'permissions.manage']);
    for (const a of FIXED_ACTIONS) {
      expect(isConfigurable(a)).toBe(false);
      expect(setRolePermission(null, 'admin', a, a !== 'members.manage')).toEqual({});
    }
    const forged = {
      admin: { 'legal.export': true, 'permissions.manage': true },
      senior_moderator: { 'members.manage': true },
    } as RoleOverrides;
    expect(roleAllows('admin', 'legal.export', forged)).toBe(false);
    expect(roleAllows('admin', 'permissions.manage', forged)).toBe(false);
    expect(roleAllows('senior_moderator', 'members.manage', forged)).toBe(false);
    expect(roleAllows('admin', 'members.manage', { admin: { 'members.manage': false } })).toBe(true);
  });

  it('a Escada de cargos não muda: ninguém dá cargo acima do próprio, com qualquer configuração', () => {
    const cfg = setRolePermission(null, 'moderator', 'settings.manage', true);
    const admin = as('admin', cfg);
    const mod = as('moderator', cfg);
    expect(canAssign(admin, T, 'admin')).toBe(false);
    expect(canAssign(admin, T, 'owner')).toBe(false);
    expect(canAssign(mod, T, 'volunteer')).toBe(false);
    expect(canAssign(as('owner', cfg), T, 'owner')).toBe(true);
  });

  it('ações do painel não descem ao Voluntário (Perfil de torcedor); moderação desce', () => {
    for (const a of TENANT_ACTIONS.filter((x) => isConfigurable(x) && !x.startsWith('moderation.')))
      expect(canReceive('volunteer', a)).toBe(false);
    expect(setRolePermission(null, 'volunteer', 'cosmos.view', true)).toEqual({});
    expect(roleAllows('volunteer', 'cosmos.view', { volunteer: { 'cosmos.view': true } })).toBe(false);
    expect(canReceive('volunteer', 'moderation.pin')).toBe(true);
    // a matriz padrão respeita o piso
    for (const a of TENANT_ACTIONS) {
      const floor = DELEGATION_FLOOR[a];
      if (floor) expect(atLeast(ACTIONS[a], floor)).toBe(true);
    }
  });

  it('tirar só desce: o de cima continua com o que ganhou; voltar ao padrão limpa a configuração', () => {
    const cfg = setRolePermission(null, 'moderator', 'moderation.ban', true);
    const back = setRolePermission(cfg, 'moderator', 'moderation.ban', false);
    expect(back).toEqual({ senior_moderator: { 'moderation.ban': true } });
    expect(setRolePermission(back, 'senior_moderator', 'moderation.ban', false)).toEqual({});
  });

  it('diffOverrides: o que muda no efetivo, cargo a cargo', () => {
    const cfg = setRolePermission(null, 'moderator', 'moderation.ban', true);
    expect(diffOverrides(null, cfg)).toEqual([
      { role: 'senior_moderator', action: 'moderation.ban', allowed: true },
      { role: 'moderator', action: 'moderation.ban', allowed: true },
    ]);
    expect(diffOverrides(cfg, null)).toEqual([
      { role: 'senior_moderator', action: 'moderation.ban', allowed: false },
      { role: 'moderator', action: 'moderation.ban', allowed: false },
    ]);
  });

  it('quem gerencia também vê: Moderador com cosmos.manage dado pelo Dono passa a ver', () => {
    const cfg = setRolePermission(null, 'moderator', 'cosmos.manage', true);
    for (const role of ['admin', 'senior_moderator', 'moderator'] as const) {
      expect(can(as(role, cfg), 'cosmos.manage', { tenantId: T })).toBe(true);
      expect(can(as(role, cfg), 'cosmos.view', { tenantId: T })).toBe(true);
    }
    expect(diffOverrides(null, cfg)).toEqual(
      expect.arrayContaining([
        { role: 'moderator', action: 'cosmos.view', allowed: true },
        { role: 'moderator', action: 'cosmos.manage', allowed: true },
      ]),
    );
    // o mesmo para a cobrança
    const billing = setRolePermission(null, 'admin', 'billing.buy_credits', true);
    expect(roleAllows('admin', 'billing.view', billing)).toBe(true);
  });

  it('tirar cosmos.view tira o cosmos.manage (na gravação e na leitura)', () => {
    const cfg = setRolePermission(null, 'admin', 'cosmos.manage', true);
    const off = setRolePermission(cfg, 'admin', 'cosmos.view', false);
    expect(roleAllows('admin', 'cosmos.view', off)).toBe(false);
    expect(roleAllows('admin', 'cosmos.manage', off)).toBe(false);
    expect(off).toEqual({ admin: { 'cosmos.view': false } });
    // configuração gravada à mão com manage sem view: o manage não vale
    const forged: RoleOverrides = { admin: { 'cosmos.view': false, 'cosmos.manage': true } };
    expect(can(as('admin', forged), 'cosmos.manage', { tenantId: T })).toBe(false);
    expect(normalizeOverrides(forged)).toEqual({ admin: { 'cosmos.view': false } });
    // com qualquer configuração, manage implica view
    for (const c of [cfg, off, forged, setRolePermission(null, 'moderator', 'cosmos.manage', true)])
      for (const role of TENANT_ROLES)
        for (const [manage, view] of Object.entries(VIEW_OF))
          if (roleAllows(role, manage as never, c)) expect(roleAllows(role, view, c)).toBe(true);
  });

  it('members.view coerente com members.manage (fixa): travado para quem cuida dos cargos', () => {
    expect(canReceive('admin', 'members.view')).toBe(false);
    expect(canReceive('senior_moderator', 'members.view')).toBe(true);
    expect(setRolePermission(null, 'admin', 'members.view', false)).toEqual({});
    const forged: RoleOverrides = { admin: { 'members.view': false } };
    expect(roleAllows('admin', 'members.view', forged)).toBe(true);
    expect(roleAllows('admin', 'members.manage', forged)).toBe(true);
    // dar a visão a quem não cuida dos cargos não dá o cuidar
    const cfg = setRolePermission(null, 'moderator', 'members.view', true);
    expect(roleAllows('moderator', 'members.view', cfg)).toBe(true);
    expect(roleAllows('moderator', 'members.manage', cfg)).toBe(false);
  });

  it('o voluntário com moderação liberada continua com o teto de 1 hora para silenciar', () => {
    const cfg = setRolePermission(null, 'volunteer', 'moderation.suspend', true);
    expect(can(as('volunteer', cfg), 'moderation.suspend', { tenantId: T })).toBe(true);
    expect(check(as('volunteer', cfg), 'moderation.mute', { tenantId: T, durationSec: 7200 })).toEqual({
      ok: false,
      reason: 'duration',
    });
  });
});
