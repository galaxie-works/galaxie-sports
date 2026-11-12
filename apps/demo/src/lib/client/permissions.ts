/**
 * O `can()` de `@galaxie/engage` aplicado à sessão do painel (#1019). Módulo puro: serve às páginas, às ações, ao
 * menu e aos testes. O cargo e o tenant vêm sempre da sessão (`readClientContext`), nunca do navegador.
 */
import { check, type ActionTarget, type Actor, type Denial, type TenantAction } from '@galaxie/engage';

/** O pedaço da sessão que decide: quem age e em qual tenant. */
export interface PermissionContext {
  actor: Actor | null;
  tenant: { id: string } | null;
}

/** Pode fazer `action` no tenant em foco (e, se houver, na Comunidade ou Sala do alvo)? */
export function allowed(
  ctx: PermissionContext,
  action: TenantAction,
  target: Omit<ActionTarget, 'tenantId'> = {},
): { ok: true } | { ok: false; reason: Denial | 'no_tenant' } {
  if (!ctx.actor || !ctx.tenant) return { ok: false, reason: 'no_tenant' };
  return check(ctx.actor, action, { ...target, tenantId: ctx.tenant.id });
}

export const can = (
  ctx: PermissionContext,
  action: TenantAction,
  target: Omit<ActionTarget, 'tenantId'> = {},
) => allowed(ctx, action, target).ok;

/**
 * Pode fazer `action` em algum lugar: no tenant inteiro ou em ao menos uma Sala ou Comunidade do escopo. Para as áreas
 * que trabalham por lugar (a fila de moderação): o membro com escopo entra e vê só o que é do lugar dele.
 */
export function canSomewhere(ctx: PermissionContext, action: TenantAction): boolean {
  if (can(ctx, action)) return true;
  const scope = ctx.actor?.kind === 'member' ? ctx.actor.scope : null;
  if (!scope) return false;
  return (
    (scope.rooms ?? []).some((room) => can(ctx, action, { room })) ||
    (scope.communities ?? []).some((community) => can(ctx, action, { community }))
  );
}

/** O lugar de um item (Sala ou Comunidade) como alvo do `can()`. */
export const placeOf = (item: { room: string | null; community: string | null }) => ({
  ...(item.community ? { community: item.community } : {}),
  ...(item.room ? { room: item.room } : {}),
});
