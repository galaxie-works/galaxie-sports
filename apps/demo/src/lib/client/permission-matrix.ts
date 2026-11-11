/**
 * A tabela de permissões por cargo da tela Usuários e cargos (#1019), montada no servidor a partir da configuração do
 * tenant. Pura: o navegador recebe só o resultado (o que cada cargo pode e o que dá para mudar), nunca decide.
 */
import {
  canReceive,
  isConfigurable,
  roleAllows,
  TENANT_ACTIONS,
  TENANT_ROLES,
  type RoleOverrides,
  type TenantAction,
  type TenantRole,
} from '@galaxie/engage';

export type PermissionGroup = 'account' | 'moderation' | 'cosmos';

export interface PermissionCell {
  role: TenantRole;
  allowed: boolean;
  /** Dá para mudar esta célula (quem vê tem `permissions.manage`, e a célula é configurável). */
  editable: boolean;
}

export interface PermissionRow {
  action: TenantAction;
  group: PermissionGroup;
  /** Ação fixa: segue a matriz em qualquer tenant. */
  fixed: boolean;
  cells: PermissionCell[];
}

export const groupOf = (action: TenantAction): PermissionGroup =>
  action.startsWith('moderation.') ? 'moderation' : action.startsWith('cosmos.') ? 'cosmos' : 'account';

/** Linhas da tabela, na ordem da matriz, com o efetivo de cada cargo. */
export function permissionMatrix(overrides: RoleOverrides | null, editable: boolean): PermissionRow[] {
  return TENANT_ACTIONS.map((action) => ({
    action,
    group: groupOf(action),
    fixed: !isConfigurable(action),
    cells: TENANT_ROLES.map((role) => ({
      role,
      allowed: roleAllows(role, action, overrides),
      editable: editable && canReceive(role, action),
    })),
  }));
}
