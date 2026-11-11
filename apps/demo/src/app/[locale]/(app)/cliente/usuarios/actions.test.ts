/**
 * Permissões por cargo no servidor: só o Dono (e a equipe Galaxie) muda; Dono, ação fixa e cargo abaixo do piso
 * não mudam nem com o pedido forjado; a recusa volta como texto, nada chega ao banco.
 */
import type { TenantRole } from '@galaxie/engage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readClientContext = vi.fn();
const saveRolePermission = vi.fn();
const resetRolePermissions = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/client/session', () => ({ readClientContext: () => readClientContext() }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('@/lib/auth/db', () => ({ pool: {} }));
vi.mock('@/lib/auth/invite', () => ({ sendInvite: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ auth: {} }));
vi.mock('@/lib/client/role-permissions', () => ({
  saveRolePermission: (...a: unknown[]) => saveRolePermission(...a),
  resetRolePermissions: (...a: unknown[]) => resetRolePermissions(...a),
}));

const { changeRolePermission, resetPermissions } = await import('./actions');

const TENANT = { id: '01a16029-0000-7000-8000-000000000001', name: 'Operadora Exemplo', markets: ['BR'] };
const as = (role: TenantRole) => ({
  userId: 'u-cliente',
  email: 'cliente.exemplo@galaxie.test',
  role: 'client',
  tenant: TENANT,
  tenants: [],
  memberRole: role,
  actor: { kind: 'member', tenantId: TENANT.id, role, scope: null },
});

beforeEach(() => {
  readClientContext.mockReset();
  saveRolePermission.mockReset().mockResolvedValue([]);
  resetRolePermissions.mockReset().mockResolvedValue([]);
});

describe('mudar permissões por cargo', () => {
  it('o Dono muda e a gravação leva o tenant e quem fez da sessão', async () => {
    readClientContext.mockResolvedValue(as('owner'));
    expect(await changeRolePermission({ role: 'admin', action: 'cosmos.manage', allowed: true })).toEqual({
      ok: true,
    });
    expect(saveRolePermission).toHaveBeenCalledWith({
      tenantId: TENANT.id,
      role: 'admin',
      action: 'cosmos.manage',
      allowed: true,
      actor: 'panel:u-cliente',
    });
    expect((await resetPermissions()).ok).toBe(true);
    expect(resetRolePermissions).toHaveBeenCalledWith({ tenantId: TENANT.id, actor: 'panel:u-cliente' });
  });

  it('Admin não muda (nem se dar o que é do Dono) e não volta ao padrão', async () => {
    readClientContext.mockResolvedValue(as('admin'));
    const res = await changeRolePermission({ role: 'admin', action: 'cosmos.manage', allowed: true });
    expect(res).toEqual({ ok: false, error: 'Só o Dono muda as permissões por cargo.' });
    expect((await resetPermissions()).ok).toBe(false);
    readClientContext.mockResolvedValue(as('moderator'));
    expect((await changeRolePermission({ role: 'moderator', action: 'cosmos.view', allowed: true })).ok).toBe(
      false,
    );
    expect(saveRolePermission).not.toHaveBeenCalled();
    expect(resetRolePermissions).not.toHaveBeenCalled();
  });

  it('Dono, ação fixa, piso do Voluntário e valores forjados são recusados', async () => {
    readClientContext.mockResolvedValue(as('owner'));
    for (const input of [
      { role: 'owner', action: 'cosmos.view', allowed: false },
      { role: 'admin', action: 'legal.export', allowed: true },
      { role: 'admin', action: 'members.manage', allowed: false },
      { role: 'admin', action: 'permissions.manage', allowed: true },
      { role: 'volunteer', action: 'cosmos.manage', allowed: true },
      { role: 'chefe', action: 'cosmos.view', allowed: true },
      { role: 'admin', action: 'cosmos.tudo', allowed: true },
    ])
      expect(await changeRolePermission(input)).toEqual({
        ok: false,
        error: 'Esta permissão não muda para este cargo.',
      });
    expect(saveRolePermission).not.toHaveBeenCalled();
  });

  it('a equipe Galaxie passa por cima; sem sessão ou sem tenant, nada', async () => {
    readClientContext.mockResolvedValue({
      ...as('owner'),
      role: 'admin',
      memberRole: null,
      actor: { kind: 'galaxie_staff' },
    });
    expect(
      (await changeRolePermission({ role: 'moderator', action: 'moderation.ban', allowed: true })).ok,
    ).toBe(true);
    expect(saveRolePermission).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: 'galaxie:u-cliente' }),
    );
    readClientContext.mockResolvedValue(null);
    expect((await resetPermissions()).ok).toBe(false);
    readClientContext.mockResolvedValue({ ...as('owner'), tenant: null, actor: null });
    expect((await resetPermissions()).ok).toBe(false);
    expect(resetRolePermissions).not.toHaveBeenCalled();
  });

  it('o can() lê a configuração do tenant: Admin com cosmos.manage liberado pelo Dono passa no servidor', async () => {
    const { cosmosAccessError } = await import('@/lib/cosmos/config');
    const admin = as('admin');
    expect(cosmosAccessError(admin as never, 'cosmos.manage')).toBe('role');
    const withConfig = {
      ...admin,
      actor: { ...admin.actor, overrides: { admin: { 'cosmos.manage': true } } },
    };
    expect(cosmosAccessError(withConfig as never, 'cosmos.manage')).toBeNull();
  });
});
