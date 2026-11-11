import { setRolePermission, TENANT_ACTIONS, TENANT_ROLES } from '@galaxie/engage';
import { describe, expect, it } from 'vitest';

import { clientDictionary } from '@/lib/i18n/dictionary';
import { LOCALES } from '@/lib/i18n/config';

import { groupOf, permissionMatrix } from './permission-matrix';

const row = (rows: ReturnType<typeof permissionMatrix>, action: string) =>
  rows.find((r) => r.action === action)!;
const cell = (rows: ReturnType<typeof permissionMatrix>, action: string, role: string) =>
  row(rows, action).cells.find((c) => c.role === role)!;

describe('tabela de permissões por cargo', () => {
  it('sem configuração mostra a matriz padrão; quem não é Dono não muda nada', () => {
    const rows = permissionMatrix(null, false);
    expect(rows.map((r) => r.action)).toEqual(TENANT_ACTIONS);
    expect(rows.every((r) => r.cells.every((c) => !c.editable))).toBe(true);
    expect(row(rows, 'cosmos.manage').cells.map((c) => c.allowed)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('para o Dono: a coluna do Dono, as ações fixas e o Voluntário no painel ficam travados', () => {
    const rows = permissionMatrix(null, true);
    for (const r of rows) expect(r.cells[0]).toMatchObject({ role: 'owner', allowed: true, editable: false });
    for (const action of ['legal.export', 'members.manage', 'permissions.manage']) {
      expect(row(rows, action).fixed).toBe(true);
      expect(row(rows, action).cells.some((c) => c.editable)).toBe(false);
    }
    expect(cell(rows, 'cosmos.view', 'volunteer').editable).toBe(false);
    expect(cell(rows, 'cosmos.view', 'moderator').editable).toBe(true);
    expect(cell(rows, 'moderation.ban', 'volunteer').editable).toBe(true);
  });

  it('mostra o efetivo da configuração do tenant', () => {
    const rows = permissionMatrix(setRolePermission(null, 'admin', 'cosmos.manage', true), true);
    expect(row(rows, 'cosmos.manage').cells.map((c) => c.allowed)).toEqual([true, true, false, false, false]);
  });

  it('cada ação tem grupo e nome nos três idiomas', () => {
    expect(groupOf('moderation.ban')).toBe('moderation');
    expect(groupOf('cosmos.view')).toBe('cosmos');
    expect(groupOf('billing.view')).toBe('account');
    for (const locale of LOCALES) {
      const p = clientDictionary(locale).client.members.permissions;
      for (const action of TENANT_ACTIONS) expect(p.labels[action], `${locale} ${action}`).toBeTruthy();
      expect(Object.keys(p.labels).sort()).toEqual([...TENANT_ACTIONS].sort());
    }
    expect(TENANT_ROLES[0]).toBe('owner');
  });
});
