import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionsOf,
  atLeast,
  can,
  canAssign,
  canReceive,
  check,
  DELEGATION_FLOOR,
  diffOverrides,
  FIXED_ACTIONS,
  isConfigurable,
  normalizeOverrides,
  roleAllows,
  setRolePermission,
  TENANT_ACTIONS,
  TENANT_ROLES,
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

  it('toda ação tem cargo mínimo válido', () => {
    for (const min of Object.values(ACTIONS)) expect(TENANT_ROLES).toContain(min);
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

  it('o voluntário com moderação liberada continua com o teto de 1 hora para silenciar', () => {
    const cfg = setRolePermission(null, 'volunteer', 'moderation.suspend', true);
    expect(can(as('volunteer', cfg), 'moderation.suspend', { tenantId: T })).toBe(true);
    expect(check(as('volunteer', cfg), 'moderation.mute', { tenantId: T, durationSec: 7200 })).toEqual({
      ok: false,
      reason: 'duration',
    });
  });
});
