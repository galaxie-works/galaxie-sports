import { setRolePermission, type Actor, type TenantRole } from '@galaxie/engage';
import { describe, expect, it } from 'vitest';

import { canContractModules } from './permissions';

/*
 * Quem contrata pela loja (F3, decisão 9): Dono, Admin com `settings.manage` e a equipe Galaxie; nunca Desenvolvedor,
 * Financeiro nem moderação, mesmo com `settings.manage` dado pelo Dono a um cargo abaixo do Admin.
 */

const T = '01a16029-0000-7000-8000-000000000001';
const member = (role: TenantRole, overrides?: Actor extends { overrides?: infer O } ? O : never) => ({
  role: 'client',
  memberRole: role,
  tenant: { id: T },
  actor: { kind: 'member', tenantId: T, role, scope: null, ...(overrides ? { overrides } : {}) } as Actor,
});

describe('canContractModules', () => {
  it('Dono e Admin contratam; Desenvolvedor, Financeiro e moderação não', () => {
    expect(canContractModules(member('owner'))).toBe(true);
    expect(canContractModules(member('admin'))).toBe(true);
    for (const role of ['developer', 'billing', 'senior_moderator', 'moderator', 'volunteer'] as const)
      expect(canContractModules(member(role)), role).toBe(false);
  });

  it('settings.manage dado a um moderador não basta; o piso subido para o Dono tira o Admin', () => {
    const lowered = setRolePermission(null, 'moderator', 'settings.manage', true);
    expect(canContractModules(member('moderator', lowered))).toBe(false);
    const raised = setRolePermission(null, 'admin', 'settings.manage', false);
    expect(canContractModules(member('admin', raised))).toBe(false);
    expect(canContractModules(member('owner', raised))).toBe(true);
  });

  it('a equipe Galaxie contrata (o motivo fica com o withStaffAudit); sem tenant em foco, ninguém', () => {
    expect(
      canContractModules({
        role: 'admin',
        memberRole: null,
        tenant: { id: T },
        actor: { kind: 'galaxie_staff' },
      }),
    ).toBe(true);
    expect(
      canContractModules({
        role: 'support',
        memberRole: null,
        tenant: { id: T },
        actor: { kind: 'galaxie_staff' },
      }),
    ).toBe(true);
    expect(canContractModules({ role: 'client', memberRole: 'owner', tenant: null, actor: null })).toBe(
      false,
    );
  });
});
