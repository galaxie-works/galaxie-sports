import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionsOf,
  can,
  canAssign,
  check,
  TENANT_ACTIONS,
  TENANT_ROLES,
  type Actor,
  type MemberScope,
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
